import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const HOME_VARS = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CLAUDE_DESKTOP_DIR'];

// Every test gets a throwaway home so nothing touches the real ~/.claude, ~/.codex or Claude desktop app data.
export function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-transfer-'));
  const saved = Object.fromEntries(HOME_VARS.map((k) => [k, process.env[k]]));
  const env = { HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: join(root, '.claude'), CODEX_HOME: join(root, '.codex'), CLAUDE_DESKTOP_DIR: join(root, 'desktop', 'Claude') };
  Object.assign(process.env, env);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
  });
  const cwd = join(root, 'work', 'my_app');
  mkdirSync(cwd, { recursive: true });
  return { root, cwd, env: { ...process.env, ...env } };
}

export function put(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

export const jsonl = (records) => `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;

export const CLAUDE_ID = '11111111-2222-4333-8444-555555555555';

export function claudeSessionFixture(cwd) {
  const base = { isSidechain: false, userType: 'external', cwd, sessionId: CLAUDE_ID, version: '2.1.281', gitBranch: 'main' };
  const at = (n) => `2026-09-01T10:00:${String(n).padStart(2, '0')}.000Z`;
  const assistant = (uuid, parentUuid, block, n) => ({ ...base, parentUuid, uuid, type: 'assistant', timestamp: at(n), message: { id: `msg_${n}`, role: 'assistant', content: [block] } });
  const user = (uuid, parentUuid, content, n, extra = {}) => ({ ...base, parentUuid, uuid, type: 'user', timestamp: at(n), message: { role: 'user', content }, ...extra });
  return [
    { type: 'file-history-snapshot', messageId: 'x', snapshot: {} },
    user('u1', null, 'Fix the login bug', 1),
    user('m1', 'u1', [{ type: 'text', text: 'injected skill body' }], 2, { isMeta: true }),
    assistant('a1', 'm1', { type: 'thinking', thinking: 'secret reasoning', signature: 'sig' }, 3),
    assistant('a2', 'a1', { type: 'text', text: 'Looking at auth.js' }, 4),
    user('x1', 'a2', 'abandoned prompt', 5),
    assistant('a3', 'a2', { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/auth.js' } }, 6),
    user('r1', 'a3', [{ type: 'tool_result', tool_use_id: 't1', content: 'line1' }], 7),
    assistant('a4', 'r1', { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/auth.js', old_string: 'a', new_string: 'b' } }, 8),
    user('r2', 'a4', [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: '1 failing' }] }], 9),
    { ...base, parentUuid: 'r2', uuid: 'att', type: 'attachment', timestamp: at(10), attachment: { type: 'hook' } },
    assistant('a5', 'att', { type: 'text', text: 'Fixed; tests pass. api_key=sk-ant-abcdefghijklmnop123' }, 11),
    user('u2', 'a5', [{ type: 'text', text: 'see screenshot' }, { type: 'image', source: { type: 'base64', data: 'AAAA' } }], 12),
    assistant('a6', 'u2', { type: 'text', text: 'Got it' }, 13),
    { ...base, isSidechain: true, parentUuid: 'a6', uuid: 's1', type: 'user', timestamp: at(14), message: { role: 'user', content: 'sidechain task' } },
    { type: 'ai-title', aiTitle: 'Login bug', sessionId: CLAUDE_ID },
    { type: 'future-thing', sessionId: CLAUDE_ID },
    '{"truncated": ',
  ];
}

export const CODEX_ID = '019f0000-aaaa-7bbb-8ccc-dddddddddddd';

export function codexRolloutFixture(cwd) {
  const at = '2026-09-02T09:00:00.000Z';
  const item = (payload) => ({ timestamp: at, type: 'response_item', payload });
  return [
    { timestamp: at, ordinal: 0, type: 'session_meta', payload: { id: CODEX_ID, cwd, cli_version: '0.154.0', timestamp: at, history_mode: 'paginated', base_instructions: { text: 'base' } } },
    { timestamp: at, type: 'turn_context', payload: { cwd } },
    item({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>x</permissions instructions>' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n  <cwd>${cwd}</cwd>\n</environment_context>` }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for x\n\nbe nice' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add a health endpoint' }, { type: 'input_image', image_url: 'data:' }] }),
    item({ type: 'agent_message', author: '/root', recipient: '/root/helper', content: [{ type: 'input_text', text: 'use port 8080' }, { type: 'encrypted_content', encrypted_content: 'enc' }] }),
    item({ type: 'reasoning', summary: [], encrypted_content: 'enc' }),
    item({ type: 'function_call', name: 'shell', arguments: '{"command":["rg","health"]}', call_id: 'c1' }),
    item({ type: 'function_call_output', call_id: 'c1', output: 'Exit code: 1\nno matches' }),
    item({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: src/health.js\n+export {}\n*** End Patch', call_id: 'c2' }),
    item({ type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text: 'Done' }] }),
    item({ type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'write tests', status: 'pending' }, { step: 'add endpoint', status: 'completed' }] }), call_id: 'c3' }),
    item({ type: 'function_call_output', call_id: 'c3', output: 'Plan updated' }),
    item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added src/health.js' }] }),
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count' } },
    { timestamp: at, type: 'mystery_record', payload: {} },
    item({ type: 'new_item_kind' }),
  ];
}

export function writeCodexSession(root, cwd) {
  const file = join(root, '.codex', 'sessions', '2026', '09', '02', `rollout-2026-09-02T09-00-00-${CODEX_ID}.jsonl`);
  put(file, jsonl(codexRolloutFixture(cwd)));
  put(join(root, '.codex', 'session_index.jsonl'), jsonl([{ id: CODEX_ID, thread_name: 'Health endpoint', updated_at: '2026-09-02T09:05:00Z' }]));
  return file;
}

export function writeClaudeSession(root, cwd) {
  const file = join(root, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${CLAUDE_ID}.jsonl`);
  put(file, jsonl(claudeSessionFixture(cwd)));
  return file;
}