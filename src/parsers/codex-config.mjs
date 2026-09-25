import { join } from 'node:path';
import { codexHome } from '../homes.mjs';
import { createConfig, secretField } from '../ir/config.mjs';
import { readText } from '../files.mjs';
import { instruction, skillDirs } from './config-sources.mjs';
import { parseToml } from './toml.mjs';

const KNOWN = new Set(['command', 'args', 'env', 'env_vars', 'url', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'enabled']);

export const readCodexToml = () => parseToml(readText(join(codexHome(), 'config.toml')) ?? '');

function server(name, entry, includeSecrets) {
  const env = [
    ...Object.entries(entry.env ?? {}).map(([k, v]) => secretField(k, v, includeSecrets)),
    ...(entry.env_vars ?? []).map((k) => ({ key: k, ref: k })),
  ];
  const headers = [
    ...Object.entries(entry.http_headers ?? {}).map(([k, v]) => secretField(k, v, includeSecrets)),
    ...Object.entries(entry.env_http_headers ?? {}).map(([k, v]) => ({ key: k, ref: v })),
    ...(entry.bearer_token_env_var ? [{ key: 'Authorization', bearerRef: entry.bearer_token_env_var }] : []),
  ];
  return {
    name,
    scope: 'user',
    transport: entry.url ? 'http' : 'stdio',
    command: entry.command ?? null,
    args: entry.args ?? [],
    url: entry.url ?? null,
    env,
    headers,
    disabled: entry.enabled === false,
    droppedFields: Object.keys(entry).filter((k) => !KNOWN.has(k)),
  };
}

export function parseCodexConfig({ cwd, includeSecrets = false }) {
  const config = createConfig('codex');
  config.instructions = [...instruction('user', join(codexHome(), 'AGENTS.md')), ...instruction('project', join(cwd, 'AGENTS.md'))];
  config.mcpServers = Object.entries(readCodexToml().mcp_servers ?? {}).map(([name, entry]) => server(name, entry, includeSecrets));
  config.skills = skillDirs(join(codexHome(), 'skills'), 'user');
  return config;
}