import assert from 'node:assert/strict';
import test from 'node:test';
import { emitClaudeSession } from '../src/emitters/claude-session.mjs';
import { claudeToolResult, claudeToolUse } from '../src/emitters/claude-tools.mjs';
import { parseClaudeSession } from '../src/parsers/claude-session.mjs';
import { parseCodexSession } from '../src/parsers/codex-session.mjs';
import { sandbox, writeClaudeSession, writeCodexSession } from './fixtures.mjs';

const records = (plan) => plan.actions[0].content.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.uuid);
const part = (name, input, output = 'ok', isError = false) => ({ kind: 'tool', name, summary: '', input, output, isError });

test('shell-like tools map to Bash; everything else keeps its name with the source prefix', () => {
  const cases = [
    [part('exec_command', { cmd: 'npm test', workdir: '/w' }), 'Bash', { command: 'npm test', description: 'exec_command from codex' }],
    [part('shell', { command: ['bash', '-lc', 'echo hi && ls'] }), 'Bash', { command: 'echo hi && ls', description: 'shell from codex' }],
    [part('shell', { command: ['rg', 'a b', 'src'] }), 'Bash', { command: 'rg "a b" src', description: 'shell from codex' }],
    [part('shell', { type: 'exec', command: ['/bin/zsh', '-c', 'pwd'] }), 'Bash', { command: 'pwd', description: 'shell from codex' }],
    [part('container.exec', { command: ['ls'] }), 'Bash', { command: 'ls', description: 'container.exec from codex' }],
    [part('unified_exec', { cmd: 'git status' }), 'Bash', { command: 'git status', description: 'unified_exec from codex' }],
    [part('exec_command', { yield_time_ms: 5 }), 'codex_exec_command', { yield_time_ms: 5 }],
    [part('exec', 'const hits = tools.filter(Boolean);'), 'codex_exec', { input: 'const hits = tools.filter(Boolean);' }],
    [part('apply_patch', '*** Begin Patch'), 'codex_apply_patch', { input: '*** Begin Patch' }],
    [part('wait', { cell_id: '1' }), 'codex_wait', { cell_id: '1' }],
    [part('web_search', null), 'codex_web_search', { input: '' }],
    [part('docs.search', { q: 'x' }), 'codex_docs_search', { q: 'x' }],
  ];
  for (const [p, name, input] of cases) assert.deepEqual(claudeToolUse(p, 'codex'), { name, input }, p.name);
  assert.deepEqual(claudeToolUse(part('Read', { file_path: '/a' }), 'claude'), { name: 'Read', input: { file_path: '/a' } });
});

test('tool results always have content, trimmed per --tool-output', () => {
  assert.equal(claudeToolResult(part('shell', {}, 'x'.repeat(400)), 'none'), '(output not carried over)');
  assert.equal(claudeToolResult(part('shell', {}, 'x'.repeat(400)), 'short'), `${'x'.repeat(300)}...`);
  assert.equal(claudeToolResult(part('shell', {}, ''), 'full'), '(no output)');
  assert.equal(claudeToolResult(part('shell', {}, null), 'full'), '(no result recorded)');
});

test('native rendering pairs every tool_use with one following tool_result in the Claude Code record shape', (t) => {
  const { root, cwd } = sandbox(t);
  const recs = records(emitClaudeSession(parseCodexSession(writeCodexSession(root, cwd)), { toolOutput: 'short', desktop: 'off' }));
  const kinds = recs.map((r) => `${r.type}/${typeof r.message.content === 'string' ? 'text' : r.message.content[0].type}`);
  assert.deepEqual(kinds, ['user/text', 'assistant/tool_use', 'user/tool_result', 'assistant/tool_use', 'user/tool_result', 'assistant/tool_use', 'user/tool_result', 'assistant/text']);
  recs.forEach((r, i) => assert.equal(r.parentUuid, i ? recs[i - 1].uuid : null));
  assert.match(recs[0].message.content, /reasoning and images did not carry over/);

  const uses = recs.filter((r) => r.message.content[0]?.type === 'tool_use');
  for (const use of uses) {
    const block = use.message.content[0];
    assert.match(block.id, /^toolu_[0-9a-f]{24}$/);
    assert.equal(use.message.stop_reason, 'tool_use');
    const results = recs.filter((r) => r.type === 'user' && Array.isArray(r.message.content) && r.message.content.some((c) => c.tool_use_id === block.id));
    assert.equal(results.length, 1);
    assert.equal(recs.indexOf(results[0]), recs.indexOf(use) + 1);
    assert.equal(results[0].sourceToolAssistantUUID, use.uuid);
  }
  assert.deepEqual(uses.map((u) => u.message.content[0].name), ['Bash', 'codex_apply_patch', 'codex_update_plan']);
  assert.deepEqual(uses[0].message.content[0].input, { command: 'rg health', description: 'shell from codex' });
  const bashResult = recs[2];
  assert.deepEqual(bashResult.message.content[0], { type: 'tool_result', tool_use_id: uses[0].message.content[0].id, content: 'Exit code: 1\nno matches', is_error: true });
  assert.equal(bashResult.toolUseResult.stdout, 'Exit code: 1\nno matches');
  assert.equal(recs.at(-1).message.stop_reason, 'end_turn');
  assert.equal(new Set(recs.filter((r) => r.type === 'assistant').map((r) => r.message.id)).size, 4);
});

test('prose before a tool call shares its message id; claude sources keep their own tool names', (t) => {
  const { root, cwd } = sandbox(t);
  const recs = records(emitClaudeSession(parseClaudeSession(writeClaudeSession(root, cwd)), { desktop: 'off' }));
  const [text, read] = recs.filter((r) => r.type === 'assistant');
  assert.equal(text.message.content[0].text, 'Looking at auth.js');
  assert.equal(read.message.content[0].name, 'Read');
  assert.equal(text.message.id, read.message.id);
  assert.equal(text.message.stop_reason, 'tool_use');
  assert.equal(recs.find((r) => r.message.content[0]?.name === 'Edit').message.content[0].input.new_string, 'b');
});

test('hidden rendering drops tool calls and leaves one line per run', (t) => {
  const { root, cwd } = sandbox(t);
  const recs = records(emitClaudeSession(parseCodexSession(writeCodexSession(root, cwd)), { toolRender: 'hidden', desktop: 'off' }));
  assert.deepEqual(recs.map((r) => r.type), ['user', 'assistant']);
  assert.equal(recs[1].message.content[0].text, '_(3 tool calls not shown)_\n\nAdded src/health.js');
  assert.ok(!JSON.stringify(recs).includes('tool_use'));
});