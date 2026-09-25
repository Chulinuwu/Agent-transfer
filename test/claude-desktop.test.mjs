import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { applyPlan } from '../src/cli/apply.mjs';
import { emitClaudeSession } from '../src/emitters/claude-session.mjs';
import { parseCodexSession } from '../src/parsers/codex-session.mjs';
import { put, sandbox, writeCodexSession } from './fixtures.mjs';

const existing = (overrides = {}) => ({
  sessionId: 'local_00000000-0000-4000-8000-000000000001', cliSessionId: '00000000-0000-4000-8000-0000000000aa', cwd: '/elsewhere',
  originCwd: '/elsewhere', createdAt: 1, lastActivityAt: 1, model: 'model-x', effort: 'high', permissionMode: 'acceptEdits',
  isArchived: false, title: 'older', completedTurns: 3, ...overrides,
});

function addRecord(dir, name, record, mtimeSeconds) {
  const file = join(dir, name);
  put(file, record);
  utimesSync(file, mtimeSeconds, mtimeSeconds);
  return file;
}

const sessionsDir = (...parts) => join(process.env.CLAUDE_DESKTOP_DIR, 'claude-code-sessions', ...parts);
const emit = (root, cwd, options) => emitClaudeSession(parseCodexSession(writeCodexSession(root, cwd)), { now: new Date(5000), ...options });
const snapshot = (dir) => readdirSync(dir, { recursive: true }).sort().map((p) => (statSync(join(dir, p)).isFile() ? `${p}:${readFileSync(join(dir, p), 'utf8')}` : p));

test('desktop record links the new Claude Code session and copies app settings from the newest record', (t) => {
  const { root, cwd } = sandbox(t);
  const org = sessionsDir('acct-1', 'org-1');
  addRecord(org, 'local_old.json', existing({ model: 'stale', effort: 'low', permissionMode: 'default' }), 100);
  addRecord(org, 'local_new.json', existing(), 200);
  addRecord(org, 'deleted_x', 'tombstone', 300);
  const before = snapshot(org);

  const plan = emit(root, cwd);
  const [session, record, resume] = plan.actions;
  assert.equal(record.type, 'write');
  assert.equal(record.what, 'Claude desktop sidebar record');
  assert.equal(resume.type, 'run');
  assert.ok(plan.notes.includes('fully quit and reopen the Claude desktop app to see it in the sidebar'));
  assert.deepEqual(snapshot(org), before, 'planning writes nothing');

  const written = JSON.parse(record.content);
  assert.match(written.sessionId, /^local_[0-9a-f-]{36}$/);
  assert.equal(record.path, join(org, `${written.sessionId}.json`));
  assert.deepEqual(written, {
    sessionId: written.sessionId, cliSessionId: plan.sessionId, cwd, originCwd: cwd, lastFocusedAt: 5000, createdAt: 5000,
    lastActivityAt: 5000, model: 'model-x', effort: 'high', isArchived: false, title: 'Health endpoint (from codex)',
    permissionMode: 'acceptEdits', completedTurns: 0, indexedAt: 5000,
  });
  assert.ok(session.path.endsWith(`${plan.sessionId}.jsonl`));

  assert.ok(applyPlan(plan.actions).every((r) => r.ok));
  assert.ok(readFileSync(record.path)[0] !== 0xef, 'no BOM');
  assert.deepEqual(snapshot(org).filter((p) => !p.startsWith(`${written.sessionId}.json`)), before, 'existing records untouched');
});

test('no desktop folder or --desktop off means no record, with a note only when looked for', (t) => {
  const { root, cwd } = sandbox(t);
  const plan = emit(root, cwd);
  assert.deepEqual(plan.actions.map((a) => a.type), ['write', 'run']);
  assert.match(plan.notes[0], /no Claude desktop app session records/);

  addRecord(sessionsDir('a', 'o'), 'local_1.json', existing(), 100);
  const off = emit(root, cwd, { desktop: 'off' });
  assert.deepEqual(off.actions.map((a) => a.type), ['write', 'run']);
  assert.deepEqual(off.notes, []);
});

test('an unrecognised newest record skips the desktop step', (t) => {
  const { root, cwd } = sandbox(t);
  const org = sessionsDir('a', 'o');
  addRecord(org, 'local_good.json', existing(), 100);
  addRecord(org, 'local_new.json', { id: 'something-else', createdAt: 'yesterday' }, 200);
  const plan = emit(root, cwd);
  assert.deepEqual(plan.actions.map((a) => a.type), ['write', 'run']);
  assert.ok(plan.notes.includes('desktop app record format not recognised; the session still opens with claude --resume'));
  addRecord(org, 'local_newest.json', 'not json', 300);
  assert.deepEqual(emit(root, cwd).actions.map((a) => a.type), ['write', 'run']);
});

test('with several account/org folders the most recently used one is picked and named', (t) => {
  const { root, cwd } = sandbox(t);
  addRecord(sessionsDir('acct-a', 'org-a'), 'local_1.json', existing({ model: 'older-model' }), 100);
  addRecord(sessionsDir('acct-b', 'org-b'), 'local_2.json', existing({ model: 'recent-model' }), 900);
  addRecord(sessionsDir('acct-c', 'org-c'), 'deleted_3', 'tombstone', 999);
  const plan = emit(root, cwd);
  const record = plan.actions.find((a) => a.what === 'Claude desktop sidebar record');
  assert.equal(record.path.startsWith(sessionsDir('acct-b', 'org-b')), true);
  assert.equal(JSON.parse(record.content).model, 'recent-model');
  assert.ok(plan.notes.some((n) => n.startsWith('2 Claude desktop account/org folders') && n.includes(join('acct-b', 'org-b'))));
});