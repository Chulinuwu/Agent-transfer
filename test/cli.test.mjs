import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { CODEX_ID, put, sandbox, writeClaudeSession, writeCodexSession } from './fixtures.mjs';

const bin = resolve(import.meta.dirname, '..', 'bin', 'agent-transfer.mjs');
const run = (args, env) => spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
const tree = (dir) => readdirSync(dir, { recursive: true }).map((p) => `${p}:${statSync(join(dir, p)).mtimeMs}`).sort();

test('session preview writes nothing; --apply writes the Claude session', (t) => {
  const { root, cwd, env } = sandbox(t);
  writeCodexSession(root, cwd);
  const before = tree(root);

  const preview = run(['session', '--from', 'codex', '--to', 'claude', '--id', CODEX_ID.slice(0, 8)], env);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Preview \(nothing written/);
  assert.match(preview.stdout, /Dropped or approximated: thinking 1; images 1; injectedContext 3/);
  assert.match(preview.stdout, /unknown record types: mystery_record, response_item\/new_item_kind/);
  assert.deepEqual(tree(root), before, 'dry run left the sandbox untouched');

  const dryRun = run(['session', '--from', 'codex', '--to', 'codex', '--id', CODEX_ID, '--dry-run'], env);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.deepEqual(tree(root), before);

  const applied = run(['session', '--from', 'codex', '--to', 'claude', '--id', CODEX_ID, '--apply'], env);
  assert.equal(applied.status, 0, applied.stderr);
  const projectDir = join(root, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  const [file] = readdirSync(projectDir);
  assert.match(file, /^[0-9a-f-]{36}\.jsonl$/);
  assert.match(applied.stdout, new RegExp(`claude --resume ${file.replace('.jsonl', '')}`));
});

test('session --json prints the redacted IR', (t) => {
  const { root, cwd, env } = sandbox(t);
  writeClaudeSession(root, cwd);
  const result = run(['session', '--from', 'claude', '--id', '1111', '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  const ir = JSON.parse(result.stdout);
  assert.equal(ir.ir, 1);
  assert.ok(!result.stdout.includes('sk-ant-abcdefghijklmnop123'));
  const raw = JSON.parse(run(['session', '--from', 'claude', '--id', '1111', '--json', '--no-redact'], env).stdout);
  assert.ok(JSON.stringify(raw).includes('sk-ant-abcdefghijklmnop123'));
});

test('handoff --apply writes the brief under ~/.agent-transfer', (t) => {
  const { root, cwd, env } = sandbox(t);
  writeClaudeSession(root, cwd);
  const result = run(['session', '--from', 'claude', '--to', 'codex', '--id', '1111', '--apply'], env);
  assert.equal(result.status, 0, result.stderr);
  const brief = readFileSync(join(root, '.agent-transfer', 'handoffs', 'claude-11111111-2222-4333-8444-555555555555.md'), 'utf8');
  assert.match(brief, /# Handoff from claude session/);
  assert.ok(!brief.includes('sk-ant-abcdefghijklmnop123'), 'redaction is on by default');
  assert.match(result.stdout, /\/import/);
});

test('config preview writes nothing and lists withheld secrets', (t) => {
  const { root, cwd, env } = sandbox(t);
  put(join(root, '.claude', '.claude.json'), { mcpServers: { s: { command: 'x', env: { MY_TOKEN: 'v4lue-123456' } } } });
  put(join(root, '.claude', 'CLAUDE.md'), 'rules');
  const before = tree(root);
  const result = run(['config', '--from', 'claude', '--to', 'codex', '--cwd', cwd], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Secrets withheld \(keys only; --include-secrets copies values\): s\.MY_TOKEN/);
  assert.ok(!result.stdout.includes('v4lue-123456'));
  assert.deepEqual(tree(root), before);

  const onlyMcp = run(['config', '--from', 'claude', '--to', 'codex', '--cwd', cwd, '--what', 'mcp', '--apply'], env);
  assert.equal(onlyMcp.status, 0, onlyMcp.stderr);
  assert.match(readFileSync(join(root, '.codex', 'config.toml'), 'utf8'), /env_vars = \["MY_TOKEN"\]/);
  assert.throws(() => statSync(join(root, '.codex', 'AGENTS.md')), /ENOENT/, '--what mcp leaves instructions alone');
});

test('bad input fails loudly', (t) => {
  const { env } = sandbox(t);
  assert.equal(run(['list', '--from', 'cursor'], env).status, 2);
  assert.equal(run(['bogus'], env).status, 2);
  assert.equal(run(['config', '--from', 'claude', '--to', 'codex', '--what', 'hooks'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'nope'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--apply', '--dry-run'], env).status, 2);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--mode', 'fancy'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--last', 'lots'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--tool-output', 'all'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--tool-render', 'cards'], env).status, 1);
  assert.equal(run(['session', '--from', 'claude', '--to', 'codex', '--id', 'x', '--desktop', 'on'], env).status, 1);
  assert.equal(run(['list', '--from', 'codex', '--json'], env).stdout.trim(), '[]');
});
test('the desktop sidebar record is previewed, written only with --apply, and skippable with --desktop off', (t) => {
  const { root, cwd, env } = sandbox(t);
  writeCodexSession(root, cwd);
  const org = join(env.CLAUDE_DESKTOP_DIR, 'claude-code-sessions', 'acct', 'org');
  put(join(org, 'local_existing.json'), { sessionId: 'local_existing', cliSessionId: 'c', cwd, title: 't', createdAt: 1, model: 'm', effort: 'e', permissionMode: 'p' });
  const before = tree(root);

  const preview = run(['session', '--from', 'codex', '--to', 'claude', '--id', CODEX_ID, '--tool-output', 'short'], env);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /create .*local_[0-9a-f-]{36}\.json {2}\(Claude desktop sidebar record/);
  assert.match(preview.stdout, /note: fully quit and reopen the Claude desktop app to see it in the sidebar/);
  assert.deepEqual(tree(root), before, 'dry run writes nothing');

  assert.doesNotMatch(run(['session', '--from', 'codex', '--to', 'claude', '--id', CODEX_ID, '--desktop', 'off'], env).stdout, /sidebar record/);

  const applied = run(['session', '--from', 'codex', '--to', 'claude', '--id', CODEX_ID, '--apply'], env);
  assert.equal(applied.status, 0, applied.stderr);
  const created = readdirSync(org).filter((f) => f !== 'local_existing.json');
  assert.equal(created.length, 1);
  const sessionId = /claude --resume ([0-9a-f-]{36})/.exec(applied.stdout)[1];
  assert.equal(JSON.parse(readFileSync(join(org, created[0]), 'utf8')).cliSessionId, sessionId);
});