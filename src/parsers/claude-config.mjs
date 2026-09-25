import { join } from 'node:path';
import { claudeHome, claudeJson } from '../homes.mjs';
import { createConfig, secretField } from '../ir/config.mjs';
import { readJson } from '../files.mjs';
import { instruction, skillDirs } from './config-sources.mjs';

const KNOWN = new Set(['type', 'command', 'args', 'env', 'url', 'headers']);

function server(name, scope, entry, includeSecrets) {
  const transport = entry.type === 'http' || entry.type === 'sse' ? entry.type : entry.url ? 'http' : 'stdio';
  return {
    name,
    scope,
    transport,
    command: entry.command ?? null,
    args: entry.args ?? [],
    url: entry.url ?? null,
    env: Object.entries(entry.env ?? {}).map(([k, v]) => secretField(k, v, includeSecrets)),
    headers: Object.entries(entry.headers ?? {}).map(([k, v]) => secretField(k, v, includeSecrets)),
    disabled: false,
    droppedFields: Object.keys(entry).filter((k) => !KNOWN.has(k)),
  };
}

export function parseClaudeConfig({ cwd, includeSecrets = false }) {
  const config = createConfig('claude');
  config.instructions = [...instruction('user', join(claudeHome(), 'CLAUDE.md')), ...instruction('project', join(cwd, 'CLAUDE.md'))];
  if (config.instructions.some((i) => /^@\S+/m.test(i.text))) config.notes.push('CLAUDE.md @imports are copied as plain text; the target will not resolve them');

  const sources = [
    ['user', readJson(claudeJson())?.mcpServers],
    ['user', readJson(join(claudeHome(), 'settings.json'))?.mcpServers],
    ['project', readJson(join(cwd, '.mcp.json'))?.mcpServers],
  ];
  const seen = new Set();
  for (const [scope, servers] of sources) {
    for (const [name, entry] of Object.entries(servers ?? {})) {
      if (seen.has(name)) continue;
      seen.add(name);
      config.mcpServers.push(server(name, scope, entry, includeSecrets));
    }
  }
  config.skills = [...skillDirs(join(claudeHome(), 'skills'), 'user'), ...skillDirs(join(cwd, '.claude', 'skills'), 'project')];
  return config;
}