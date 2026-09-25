import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { emitClaudeSession } from '../src/emitters/claude-session.mjs';
import { emitCodexSession } from '../src/emitters/codex-session.mjs';
import { buildBrief, emitHandoff } from '../src/emitters/handoff.mjs';
import { textOf, trimSession } from '../src/ir/session.mjs';
import { parseClaudeSession } from '../src/parsers/claude-session.mjs';
import { findCodexSession, listCodexSessions, parseCodexSession } from '../src/parsers/codex-session.mjs';
import { CODEX_ID, sandbox, writeClaudeSession, writeCodexSession } from './fixtures.mjs';

test('Codex rollout parses into the IR with tool calls and outputs paired', (t) => {
  const { root, cwd } = sandbox(t);
  const ir = parseCodexSession(writeCodexSession(root, cwd));

  assert.equal(ir.sourceTool, 'codex');
  assert.equal(ir.sourceId, CODEX_ID);
  assert.equal(ir.cwd, cwd);
  assert.equal(ir.sourceVersion, '0.154.0');
  assert.equal(ir.title, 'Health endpoint');
  assert.deepEqual(ir.turns.map((turn) => turn.role), ['user', 'assistant']);
  assert.equal(textOf(ir.turns[0]), 'Add a health endpoint\n\n[message from /root to /root/helper]\nuse port 8080');

  const [shell, patch, plan, final] = ir.turns[1].parts;
  assert.equal(shell.name, 'shell');
  assert.equal(shell.summary, 'rg health');
  assert.equal(shell.isError, true);
  assert.match(shell.output, /no matches/);
  assert.equal(patch.name, 'apply_patch');
  assert.equal(patch.summary, 'patch src/health.js');
  assert.equal(patch.output, 'Done');
  assert.equal(patch.isError, false);
  assert.equal(plan.name, 'update_plan');
  assert.equal(final.text, 'Added src/health.js');

  assert.equal(ir.dropped.thinking, 1);
  assert.equal(ir.dropped.images, 1);
  assert.equal(ir.dropped.injectedContext, 3);
  assert.equal(ir.dropped.encryptedParts, 1);
  assert.deepEqual(ir.dropped.unknownRecordTypes, ['mystery_record', 'response_item/new_item_kind']);
});

test('Codex list reads identity from the head and titles from the index', (t) => {
  const { root, cwd } = sandbox(t);
  writeCodexSession(root, cwd);
  const [s] = listCodexSessions();
  assert.deepEqual({ id: s.id, title: s.title, cwd: s.cwd, version: s.version, historyMode: s.historyMode }, { id: CODEX_ID, title: 'Health endpoint', cwd, version: '0.154.0', historyMode: 'paginated' });
  assert.equal(listCodexSessions({ cwd: join(root, 'elsewhere') }).length, 0);
  assert.ok(findCodexSession('019f0000').endsWith('.jsonl'));
  assert.throws(() => findCodexSession('deadbeef'), /no rollout file/);
});

test('codex -> claude with --tool-render text keeps the compact text list', (t) => {
  const { root, cwd } = sandbox(t);
  const ir = parseCodexSession(writeCodexSession(root, cwd));
  const records = emitClaudeSession(ir, { toolRender: 'text' }).actions[0].content.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.uuid);
  assert.deepEqual(records.map((r) => r.type), ['user', 'assistant']);
  assert.equal(records[1].parentUuid, records[0].uuid);
  assert.equal(records[1].message.content[0].text, '- `shell`: rg health (failed)\n- `apply_patch`: patch src/health.js\n- `update_plan`: {"plan":[{"step":"write tests","status":"pending"},{"step":"add endpoint","status":"completed"}]}\n\nAdded src/health.js');
});

test('handoff brief carries goal, open todos, files and recent turns', (t) => {
  const { root, cwd } = sandbox(t);
  const brief = buildBrief(parseCodexSession(writeCodexSession(root, cwd)));
  assert.match(brief, /## Goal \(first request\)\n\nAdd a health endpoint/);
  const todos = brief.split('## Open todos')[1].split('## Files touched')[0];
  assert.match(todos, /- \[pending\] write tests/);
  assert.ok(!todos.includes('add endpoint'), 'completed plan items are not open todos');
  assert.match(brief, /- src\/health\.js/);
  assert.match(brief, /Added src\/health\.js/);
  assert.match(brief, /- `shell`: rg health \(failed\)\n/);
  assert.ok(!brief.includes('no matches'), 'recent turns omit tool output by default');
  assert.match(buildBrief(parseCodexSession(writeCodexSession(root, cwd)), { toolOutput: 'short' }), /no matches/);
  assert.match(brief, /thinking 1/);
});

test('claude -> codex emits a handoff, never a native Codex thread, and points to /import', (t) => {
  const { root, cwd } = sandbox(t);
  const ir = parseClaudeSession(writeClaudeSession(root, cwd));
  const plan = emitCodexSession(ir, {});
  const writes = plan.actions.filter((a) => a.type === 'write');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, join(root, '.agent-transfer', 'handoffs', `claude-${ir.sourceId}.md`));
  assert.match(writes[0].content, /\/repo\/auth\.js/);
  assert.ok(plan.actions.some((a) => a.type === 'run' && /codex "(Continue "[^"]+"\. )?Read the handoff brief at/.test(a.command) && a.command.startsWith(`cd "${cwd}" && codex`)));
  assert.ok(plan.actions.some((a) => a.type === 'run' && a.command.includes('codex exec')));
  assert.match(plan.notes[0], /\/import/);
  assert.ok(!existsSync(join(root, '.codex')), 'emitting a plan writes nothing');
  assert.match(emitHandoff(ir, { target: 'claude' }).actions[1].command, /claude "(Continue "[^"]+"\. )?Read the handoff brief/);
});

test('an unnamed Codex thread is titled by its first request and the title reaches both targets', (t) => {
  const { root, cwd } = sandbox(t);
  const file = writeCodexSession(root, cwd);
  assert.equal(parseCodexSession(file).title, 'Health endpoint');
  rmSync(join(root, '.codex', 'session_index.jsonl'));
  const ir = parseCodexSession(file);
  assert.match(ir.title, /^Add a health endpoint/);
  const records = emitClaudeSession(ir).actions[0].content.trim().split('\n').map((l) => JSON.parse(l));
  const custom = records.find((r) => r.type === 'custom-title');
  assert.equal(custom.customTitle, `${ir.title} (from codex)`);
  assert.ok(records.some((r) => r.type === 'ai-title' && r.aiTitle === custom.customTitle));
  const seed = emitHandoff(ir, { target: 'codex' }).actions.find((a) => a.type === 'run').command;
  assert.ok(seed.includes(`Continue "${ir.title}". Read the handoff brief at`));
});

test('trimming keeps the newest turns within the turn and byte caps', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', at: null, parts: [{ kind: 'text', text: `turn ${i} ${'x'.repeat(100)}` }] }));
  const session = { turns: [...turns], dropped: { trimmedTurns: 0 } };
  trimSession(session, { lastTurns: 4 });
  assert.deepEqual(session.turns.map((turn) => turn.parts[0].text.split(' ')[1]), ['6', '7', '8', '9']);
  trimSession(session, { maxBytes: 400 });
  assert.equal(session.turns.length, 2);
  assert.equal(session.dropped.trimmedTurns, 8);
  trimSession(session, { maxBytes: 1 });
  assert.equal(session.turns.length, 1, 'the newest turn always survives');
});