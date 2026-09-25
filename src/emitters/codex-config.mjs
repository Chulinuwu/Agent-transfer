import { join } from 'node:path';
import { readText } from '../files.mjs';
import { codexHome } from '../homes.mjs';
import { envNameFor } from '../ir/config.mjs';
import { parseToml, tomlKey, tomlValue } from '../parsers/toml.mjs';
import { copyAction, writeAction } from './plan.mjs';

const inlineTable = (pairs) => `{ ${pairs.map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`).join(', ')} }`;

function block(server, notes) {
  const name = tomlKey(server.name);
  const lines = [`[mcp_servers.${name}]`];
  if (server.transport === 'stdio') {
    lines.push(`command = ${tomlValue(server.command)}`);
    if (server.args.length) lines.push(`args = ${tomlValue(server.args)}`);
  } else {
    lines.push(`url = ${tomlValue(server.url)}`);
    if (server.transport === 'sse') notes.push(`${server.name}: Codex has no SSE transport; written as a streamable HTTP url, which may not work`);
  }
  if (server.droppedFields.length) notes.push(`${server.name}: fields not carried over: ${server.droppedFields.join(', ')}`);

  const literalEnv = server.env.filter((f) => 'value' in f);
  // Codex passes variables through by name only (env_vars), so a reference to a differently named variable cannot be kept.
  const passEnv = server.env.filter((f) => !('value' in f));
  for (const f of passEnv) {
    if (f.withheld) notes.push(`${server.name}: env ${f.key} value withheld; Codex will read ${f.key} from your environment`);
    else if (f.ref !== f.key) notes.push(`${server.name}: env ${f.key} referenced \${${f.ref}}; Codex passes ${f.key} through by name, so set ${f.key}`);
  }
  if (passEnv.length) lines.push(`env_vars = ${tomlValue(passEnv.map((f) => f.key))}`);

  const bearer = server.headers.find((f) => f.bearerRef || (f.withheld && f.bearer));
  if (bearer) {
    const env = bearer.bearerRef ?? envNameFor(`${server.name}_token`);
    if (!bearer.bearerRef) notes.push(`${server.name}: ${bearer.key} token withheld; set environment variable ${env}`);
    lines.push(`bearer_token_env_var = ${tomlValue(env)}`);
  }
  const envHeaders = server.headers.filter((f) => f !== bearer && !('value' in f)).map((f) => {
    const env = f.ref ?? envNameFor(f.key);
    if (f.withheld) notes.push(`${server.name}: header ${f.key} value withheld; set environment variable ${env}`);
    return [f.key, env];
  });
  if (envHeaders.length) lines.push(`env_http_headers = ${inlineTable(envHeaders)}`);

  const literalHeaders = server.headers.filter((f) => 'value' in f);
  if (literalEnv.length) lines.push('', `[mcp_servers.${name}.env]`, ...literalEnv.map((f) => `${tomlKey(f.key)} = ${tomlValue(f.value)}`));
  if (literalHeaders.length) lines.push('', `[mcp_servers.${name}.http_headers]`, ...literalHeaders.map((f) => `${tomlKey(f.key)} = ${tomlValue(f.value)}`));
  return `${lines.join('\n')}\n`;
}

function mcpActions(config, notes) {
  const path = join(codexHome(), 'config.toml');
  const current = readText(path) ?? '';
  const existing = parseToml(current).mcp_servers ?? {};
  const actions = [];
  const blocks = [];
  for (const s of config.mcpServers) {
    if (s.disabled) notes.push(`${s.name}: disabled in the source, not transferred`);
    else if (existing[s.name]) actions.push({ type: 'skip', what: `MCP server ${s.name}`, path, reason: 'already in config.toml; edit that table by hand (in-place TOML rewrites are not supported)' });
    else {
      if (s.scope === 'project') notes.push(`${s.name}: project-scoped in the source, written to the user config.toml`);
      blocks.push({ name: s.name, text: block(s, notes) });
    }
  }
  if (blocks.length) {
    const content = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${blocks.map((b) => b.text).join('\n')}`;
    actions.push(writeAction(path, content, { what: `MCP servers ${blocks.map((b) => b.name).join(', ')}`, merge: true }));
  }
  return actions;
}

export function emitCodexConfig(config, { cwd, force = false }) {
  const notes = [];
  const instructions = config.instructions.map((i) => writeAction(join(i.scope === 'user' ? codexHome() : cwd, 'AGENTS.md'), i.text, { what: `${i.scope} instructions from ${i.path}`, force }));
  const skills = config.skills.map((s) => {
    if (s.scope === 'project') notes.push(`skill ${s.name}: project-scoped in the source, copied to the user skills folder`);
    return copyAction(s.path, join(codexHome(), 'skills', s.name), { what: `skill ${s.name}`, force });
  });
  return { actions: [...instructions, ...mcpActions(config, notes), ...skills], notes };
}