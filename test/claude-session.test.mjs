import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { applyPlan } from '../src/cli/apply.mjs';
import { emitClaudeSession } from '../src/emitters/claude-session.mjs';
import { claudeProjectDir } from '../src/homes.mjs';
import { textOf } from '../src/ir/session.mjs';
import { findClaudeSession, listClaudeSessions, parseClaudeSession } from '../src/parsers/claude-session.mjs';
import { CLAUDE_ID, sandbox, writeClaudeSession } from './fixtures.mjs';

test('project folder name replaces every non-alphanumeric character', (t) => {
  sandbox(t);
  assert.ok(claudeProjectDir('C:\\Users\\me\\my_app').endsWith('C--Users-me-my-app'));
  assert.ok(claudeProjectDir('/home/me/my.app').endsWith('-home-me-my-app'));
  assert.throws(() => claudeProjectDir(`/${'x'.repeat(250)}`), /too long/);
});

test('Claude transcript parses into the IR along the live branch', (t) => {
  const { root, cwd } = sandbox(t);
  const file = writeClaudeSession(root, cwd);
  const ir = parseClaudeSession(file);

  assert.equal(ir.ir, 1);
  assert.equal(ir.sourceTool, 'claude');
  assert.equal(ir.sourceId, CLAUDE_ID);
  assert.equal(ir.cwd, cwd);
  assert.equal(ir.sourceVersion, '2.1.281');
  assert.equal(ir.gitBranch, 'main');
  assert.equal(ir.title, 'Login bug');
  assert.deepEqual(ir.turns.map((turn) => turn.role), ['user', 'assistant', 'user', 'assistant']);

  const [ask, work, followUp, done] = ir.turns;
  assert.equal(textOf(ask), 'Fix the login bug');
  assert.deepEqual(work.parts.map((p) => p.kind), ['text', 'tool', 'tool', 'text']);
  const [, read, edit] = work.parts;
  assert.equal(read.name, 'Read');
  assert.equal(read.summary, '/repo/auth.js');
  assert.equal(read.output, 'line1');
  assert.equal(read.isError, false);
  assert.equal(edit.output, '1 failing');
  assert.equal(edit.isError, true);
  assert.equal(textOf(followUp), 'see screenshot');
  assert.equal(textOf(done), 'Got it');

  const all = JSON.stringify(ir.turns);
  assert.ok(!all.includes('abandoned prompt'), 'abandoned branch excluded');
  assert.ok(!all.includes('sidechain task'), 'sidechain excluded');
  assert.ok(!all.includes('secret reasoning'), 'thinking excluded');
  assert.ok(!all.includes('injected skill body'), 'meta message excluded');
  assert.deepEqual(
    { thinking: ir.dropped.thinking, images: ir.dropped.images, attachments: ir.dropped.attachments, meta: ir.dropped.metaMessages, bad: ir.dropped.badLines },
    { thinking: 1, images: 1, attachments: 1, meta: 1, bad: 1 },
  );
  assert.deepEqual(ir.dropped.unknownRecordTypes, ['future-thing']);
});

test('list and find locate sessions by id prefix', (t) => {
  const { root, cwd } = sandbox(t);
  writeClaudeSession(root, cwd);
  const [listed] = listClaudeSessions();
  assert.equal(listed.id, CLAUDE_ID);
  assert.equal(listed.title, 'Login bug');
  assert.equal(listed.cwd, cwd);
  assert.equal(listClaudeSessions({ cwd }).length, 1);
  assert.ok(findClaudeSession('11111111').endsWith(`${CLAUDE_ID}.jsonl`));
  assert.throws(() => findClaudeSession('ffff'), /no Claude session/);
});

test('Claude emitter writes a resumable uuid chain', (t) => {
  const { root, cwd } = sandbox(t);
  const ir = parseClaudeSession(writeClaudeSession(root, cwd));
  const { sessionId, actions } = emitClaudeSession(ir);
  const [write, resume] = actions;

  assert.equal(write.type, 'write');
  assert.equal(write.path, join(claudeProjectDir(cwd), `${sessionId}.jsonl`));
  assert.match(resume.command, new RegExp(`claude --resume ${sessionId}`));

  const records = write.content.trim().split('\n').map((l) => JSON.parse(l));
  const messages = records.filter((r) => r.type === 'user' || r.type === 'assistant');
  assert.equal(new Set(messages.map((r) => r.uuid)).size, messages.length);
  messages.forEach((r, i) => {
    assert.equal(r.parentUuid, i === 0 ? null : messages[i - 1].uuid);
    assert.equal(r.sessionId, sessionId);
    assert.equal(r.cwd, cwd);
    assert.equal(r.isSidechain, false);
    assert.equal(r.type, i % 2 === 0 ? 'user' : 'assistant', 'roles alternate');
    assert.ok(!Number.isNaN(Date.parse(r.timestamp)));
  });
  for (const a of messages.filter((r) => r.type === 'assistant')) {
    assert.equal(a.message.role, 'assistant');
    assert.ok(a.message.content.every((b) => b.type === 'text'), 'tool calls rendered as text blocks');
  }
  assert.match(messages[1].message.content[0].text, /\[tool Edit, failed\] \/repo\/auth\.js\n {2}-> 1 failing/);
  assert.ok(records.some((r) => r.type === 'ai-title' && r.sessionId === sessionId));
});

test('claude -> IR -> claude keeps every text turn', (t) => {
  const { root, cwd } = sandbox(t);
  const original = parseClaudeSession(writeClaudeSession(root, cwd));
  const { actions } = emitClaudeSession(original);
  const [result] = applyPlan(actions);
  assert.ok(result.ok, result.error);

  const again = parseClaudeSession(result.path);
  assert.equal(again.turns.length, original.turns.length);
  original.turns.forEach((turn, i) => {
    assert.equal(again.turns[i].role, turn.role);
    for (const part of turn.parts.filter((p) => p.kind === 'text')) assert.ok(textOf(again.turns[i]).includes(part.text));
  });
  assert.deepEqual(again.dropped.unknownRecordTypes, []);
});

test('a session that starts with an assistant turn gets a user preamble', (t) => {
  const { cwd } = sandbox(t);
  const ir = { sourceTool: 'codex', sourceId: 'abc', cwd, gitBranch: null, title: null, turns: [{ role: 'assistant', at: null, parts: [{ kind: 'text', text: 'hi' }] }] };
  const records = emitClaudeSession(ir).actions[0].content.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(records.map((r) => r.type), ['user', 'assistant']);
  assert.match(records[0].message.content, /Transferred from codex session abc/);
});