import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { applyPlan } from '../src/cli/apply.mjs';
import { emitClaudeConfig } from '../src/emitters/claude-config.mjs';
import { emitCodexConfig } from '../src/emitters/codex-config.mjs';
import { withheldKeys } from '../src/ir/config.mjs';
import { parseClaudeConfig } from '../src/parsers/claude-config.mjs';
import { parseCodexConfig } from '../src/parsers/codex-config.mjs';
import { parseToml } from '../src/parsers/toml.mjs';
import { put, sandbox } from './fixtures.mjs';

function claudeSide(root, cwd) {
  put(join(root, '.claude', 'CLAUDE.md'), 'Use tabs.\n');
  put(join(cwd, 'CLAUDE.md'), 'Project rules.\n');
  put(join(root, '.claude', '.claude.json'), {
    numStartups: 3,
    mcpServers: {
      files: { type: 'stdio', command: 'npx', args: ['-y', 'fs-server'], env: { API_TOKEN: 'literal-secret-123', HOME_DIR: '${HOME}' } },
      remote: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer abc123secret', 'X-Team': '${TEAM_ID}' }, oauth: { clientId: 'x' } },
    },
  });
  put(join(cwd, '.mcp.json'), { mcpServers: { proj: { command: 'node', args: ['server.js'] } } });
  put(join(root, '.claude', 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: d\n---\nbody\n');
  put(join(root, '.claude', 'skills', 'not-a-skill', 'README.md'), 'no SKILL.md here');
}

function codexSide(root, cwd) {
  put(join(root, '.codex', 'AGENTS.md'), 'Codex user rules.\n');
  put(join(root, '.codex', 'config.toml'), [
    'model = "gpt-x"',
    '',
    '[mcp_servers.docs]',
    'url = "https://docs.example.com/mcp"',
    'bearer_token_env_var = "DOCS_TOKEN"',
    'env_http_headers = { "X-Org" = "ORG_ID" }',
    '',
    '[mcp_servers.local]',
    "command = 'C:\\tools\\srv.exe'",
    'args = [',
    '  "--port", # trailing comment',
    '  "9000",',
    ']',
    'env_vars = ["PATH_EXTRA"]',
    'startup_timeout_sec = 20',
    '',
    '[mcp_servers.local.env]',
    'SECRET_KEY = "zzz-literal-999"',
    '',
    '[mcp_servers.off]',
    'command = "x"',
    'enabled = false',
    '',
    "[projects.'c:\\users\\me\\repo']",
    'trust_level = "trusted"',
    '',
  ].join('\n'));
  put(join(root, '.codex', 'skills', 's1', 'SKILL.md'), '---\nname: s1\ndescription: d\n---\n');
  put(join(root, '.codex', 'skills', '.system', 'builtin', 'SKILL.md'), 'bundled');
  put(join(root, '.claude', '.claude.json'), { numStartups: 7, oauthAccount: { email: 'a@b.c' } });
}

test('TOML reader handles the shapes agent configs use', () => {
  const doc = parseToml([
    '# comment',
    'a = 1_000',
    'b = [1, [2, 3], { x = "y" }]',
    "c = 'C:\\no\\escapes'",
    'd = """',
    'multi',
    'line"""',
    'e.f = true',
    '"quoted.key" = "\\u00e9\\n"',
    '[t."x.y".z]',
    'k = -1.5e2',
    '[[arr]]',
    'n = 1',
    '[[arr]]',
    'n = 2',
  ].join('\n'));
  assert.deepEqual(doc, { a: 1000, b: [1, [2, 3], { x: 'y' }], c: 'C:\\no\\escapes', d: 'multi\nline', e: { f: true }, 'quoted.key': 'é\n', t: { 'x.y': { z: { k: -150 } } }, arr: [{ n: 1 }, { n: 2 }] });
  assert.throws(() => parseToml('a = 1\na = 2'), /duplicate key a/);
  assert.throws(() => parseToml('a = "open'), /line 1/);
  assert.throws(() => parseToml('[__proto__]\nx = 1'), /forbidden/);
});

test('claude -> codex maps instructions, MCP servers and skills with secrets withheld', (t) => {
  const { root, cwd } = sandbox(t);
  claudeSide(root, cwd);
  const config = parseClaudeConfig({ cwd });
  assert.deepEqual(config.instructions.map((i) => i.scope), ['user', 'project']);
  assert.deepEqual(config.mcpServers.map((s) => `${s.scope}:${s.name}`), ['user:files', 'user:remote', 'project:proj']);
  assert.deepEqual(config.skills.map((s) => s.name), ['my-skill']);
  assert.deepEqual(withheldKeys(config), ['files.API_TOKEN', 'remote.Authorization']);
  assert.ok(!JSON.stringify(config).includes('literal-secret-123'), 'the IR never holds withheld values');

  const plan = emitCodexConfig(config, { cwd });
  const toml = plan.actions.find((a) => a.path?.endsWith('config.toml'));
  assert.ok(!toml.content.includes('literal-secret-123') && !toml.content.includes('abc123secret'));
  const servers = parseToml(toml.content).mcp_servers;
  assert.deepEqual(servers.files, { command: 'npx', args: ['-y', 'fs-server'], env_vars: ['API_TOKEN', 'HOME_DIR'] });
  assert.deepEqual(servers.remote, { url: 'https://mcp.example.com/mcp', bearer_token_env_var: 'REMOTE_TOKEN', env_http_headers: { 'X-Team': 'TEAM_ID' } });
  assert.deepEqual(servers.proj, { command: 'node', args: ['server.js'] });
  assert.ok(plan.notes.some((n) => /remote: fields not carried over: oauth/.test(n)));
  assert.ok(plan.notes.some((n) => /HOME_DIR referenced \$\{HOME\}/.test(n)));
  assert.ok(plan.actions.some((a) => a.type === 'copy' && a.to === join(root, '.codex', 'skills', 'my-skill')));
  assert.ok(plan.actions.some((a) => a.type === 'write' && a.path === join(root, '.codex', 'AGENTS.md') && a.content === 'Use tabs.\n'));
  assert.ok(plan.actions.some((a) => a.type === 'write' && a.path === join(cwd, 'AGENTS.md')));
  assert.ok(!existsSync(join(root, '.codex')), 'planning writes nothing');

  const results = applyPlan(plan.actions);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const back = parseCodexConfig({ cwd });
  assert.deepEqual(back.mcpServers.map((s) => s.name), ['files', 'remote', 'proj']);
  assert.deepEqual(back.skills.map((s) => s.name), ['my-skill']);
  assert.ok(existsSync(join(root, '.codex', 'skills', 'my-skill', 'SKILL.md')));
});

test('--include-secrets copies literal values', (t) => {
  const { root, cwd } = sandbox(t);
  claudeSide(root, cwd);
  const config = parseClaudeConfig({ cwd, includeSecrets: true });
  assert.deepEqual(withheldKeys(config), []);
  const servers = parseToml(emitCodexConfig(config, { cwd }).actions.find((a) => a.path?.endsWith('config.toml')).content).mcp_servers;
  assert.deepEqual(servers.files.env, { API_TOKEN: 'literal-secret-123' });
  assert.deepEqual(servers.files.env_vars, ['HOME_DIR']);
  assert.deepEqual(servers.remote.http_headers, { Authorization: 'Bearer abc123secret' });
});

test('existing targets are never overwritten without --force, and servers already present are skipped', (t) => {
  const { root, cwd } = sandbox(t);
  claudeSide(root, cwd);
  put(join(cwd, 'AGENTS.md'), 'Existing project rules.\n');
  put(join(root, '.codex', 'config.toml'), '[mcp_servers.files]\ncommand = "mine"\n');
  const config = parseClaudeConfig({ cwd });

  const plan = emitCodexConfig(config, { cwd });
  const agents = plan.actions.find((a) => a.path === join(cwd, 'AGENTS.md'));
  assert.equal(agents.type, 'skip');
  assert.match(agents.diff, /- Existing project rules\.\n\+ Project rules\./);
  assert.ok(plan.actions.some((a) => a.type === 'skip' && a.what === 'MCP server files'));
  const toml = plan.actions.find((a) => a.type === 'write' && a.path.endsWith('config.toml'));
  assert.ok(toml.content.startsWith('[mcp_servers.files]\ncommand = "mine"\n'), 'existing content kept');
  assert.equal(parseToml(toml.content).mcp_servers.files.command, 'mine');

  const forced = emitCodexConfig(config, { cwd, force: true }).actions.find((a) => a.path === join(cwd, 'AGENTS.md'));
  assert.equal(forced.type, 'write');
  assert.equal(forced.replaces, true);
  const [result] = applyPlan([forced]);
  assert.ok(result.ok && existsSync(result.backup));
  assert.equal(readFileSync(result.backup, 'utf8'), 'Existing project rules.\n');
  assert.equal(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), 'Project rules.\n');
});

test('codex -> claude maps into ~/.claude.json without leaking secrets or dropping other keys', (t) => {
  const { root, cwd } = sandbox(t);
  codexSide(root, cwd);
  const config = parseCodexConfig({ cwd });
  assert.deepEqual(config.skills.map((s) => s.name), ['s1'], 'dot folders such as .system are skipped');
  assert.deepEqual(withheldKeys(config), ['local.SECRET_KEY']);

  const plan = emitClaudeConfig(config, { cwd });
  const write = plan.actions.find((a) => a.path === join(root, '.claude', '.claude.json'));
  assert.ok(!write.content.includes('zzz-literal-999'));
  const json = JSON.parse(write.content);
  assert.equal(json.numStartups, 7);
  assert.deepEqual(json.oauthAccount, { email: 'a@b.c' });
  assert.deepEqual(json.mcpServers.docs, { type: 'http', url: 'https://docs.example.com/mcp', headers: { 'X-Org': '${ORG_ID}', Authorization: 'Bearer ${DOCS_TOKEN}' } });
  assert.deepEqual(json.mcpServers.local, { type: 'stdio', command: 'C:\\tools\\srv.exe', args: ['--port', '9000'], env: { SECRET_KEY: '${SECRET_KEY}', PATH_EXTRA: '${PATH_EXTRA}' } });
  assert.equal(json.mcpServers.off, undefined);
  assert.ok(plan.notes.some((n) => /off: disabled/.test(n)));
  assert.ok(plan.notes.some((n) => /startup_timeout_sec/.test(n)));
  assert.ok(plan.notes.some((n) => /SECRET_KEY value withheld/.test(n)));
  assert.ok(plan.actions.some((a) => a.type === 'write' && a.path === join(root, '.claude', 'CLAUDE.md') && a.content === 'Codex user rules.\n'));
  assert.ok(plan.actions.some((a) => a.type === 'copy' && a.to === join(root, '.claude', 'skills', 's1')));
});