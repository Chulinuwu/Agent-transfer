import { join } from 'node:path';
import { readJson, readText } from '../files.mjs';
import { claudeHome, claudeJson } from '../homes.mjs';
import { envNameFor } from '../ir/config.mjs';
import { copyAction, writeAction } from './plan.mjs';

// Claude Code expands ${VAR} in MCP env and header values, so withheld secrets become references the user fills in.
function fieldValue(server, field, notes) {
  if ('value' in field) return field.value;
  if (field.bearerRef) return `Bearer \${${field.bearerRef}}`;
  if (field.ref) return `\${${field.ref}}`;
  const env = envNameFor(field.key === 'Authorization' ? `${server.name}_token` : field.key);
  notes.push(`${server.name}: ${field.key} value withheld; set environment variable ${env}`);
  return field.bearer ? `Bearer \${${env}}` : `\${${env}}`;
}

function entry(server, notes) {
  const pairs = (fields) => Object.fromEntries(fields.map((f) => [f.key, fieldValue(server, f, notes)]));
  if (server.droppedFields.length) notes.push(`${server.name}: fields not carried over: ${server.droppedFields.join(', ')}`);
  if (server.transport === 'stdio') return { type: 'stdio', command: server.command, args: server.args, ...(server.env.length && { env: pairs(server.env) }) };
  return { type: server.transport, url: server.url, ...(server.headers.length && { headers: pairs(server.headers) }) };
}

function mcpActions(config, { cwd, force }, notes) {
  const targets = { user: claudeJson(), project: join(cwd, '.mcp.json') };
  const actions = [];
  for (const [scope, path] of Object.entries(targets)) {
    const servers = config.mcpServers.filter((s) => s.scope === scope && !s.disabled);
    if (!servers.length) continue;
    const current = readJson(path) ?? {};
    const existing = current.mcpServers ?? {};
    const added = {};
    for (const s of servers) {
      if (existing[s.name] && !force) actions.push({ type: 'skip', what: `MCP server ${s.name}`, path, reason: 'already configured; rerun with --force to replace it' });
      else added[s.name] = entry(s, notes);
    }
    if (!Object.keys(added).length) continue;
    const trailing = readText(path)?.endsWith('\n') ?? true ? '\n' : '';
    const content = `${JSON.stringify({ ...current, mcpServers: { ...existing, ...added } }, null, 2)}${trailing}`;
    actions.push(writeAction(path, content, { what: `MCP servers ${Object.keys(added).join(', ')} (${scope})`, merge: true }));
    if (path === claudeJson()) notes.push(`${path} is Claude Code's live state file; quit running Claude Code sessions before --apply so they do not overwrite the change`);
  }
  for (const s of config.mcpServers.filter((s) => s.disabled)) notes.push(`${s.name}: disabled in the source, not transferred`);
  return actions;
}

export function emitClaudeConfig(config, { cwd, force = false }) {
  const notes = [];
  const instructions = config.instructions.map((i) => writeAction(join(i.scope === 'user' ? claudeHome() : cwd, 'CLAUDE.md'), i.text, { what: `${i.scope} instructions from ${i.path}`, force }));
  const skills = config.skills.map((s) => copyAction(s.path, join(s.scope === 'user' ? claudeHome() : join(cwd, '.claude'), 'skills', s.name), { what: `skill ${s.name}`, force }));
  return { actions: [...instructions, ...mcpActions(config, { cwd, force }, notes), ...skills], notes };
}