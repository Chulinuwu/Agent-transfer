import { IR_VERSION } from './session.mjs';

export const createConfig = (sourceTool) => ({ ir: IR_VERSION, kind: 'config', sourceTool, instructions: [], mcpServers: [], skills: [], notes: [] });

const REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/;
const BEARER_REF = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

// An env/header entry never carries a literal value into the IR unless the user opted in.
// References to environment variables (${VAR}) are not secrets and always carry over.
export function secretField(key, value, includeSecrets) {
  const text = String(value ?? '');
  const ref = REF.exec(text)?.[1];
  if (ref) return { key, ref };
  const bearerRef = BEARER_REF.exec(text)?.[1];
  if (bearerRef) return { key, bearerRef };
  const bearer = /^Bearer\s/i.test(text) || undefined;
  return includeSecrets ? { key, value: text, bearer } : { key, withheld: true, bearer };
}

export const envNameFor = (key) => key.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export const withheldKeys = (config) => config.mcpServers.flatMap((s) => [...s.env, ...s.headers].filter((f) => f.withheld).map((f) => `${s.name}.${f.key}`));