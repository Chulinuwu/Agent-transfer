import { TOOLS } from '../tools.mjs';
import { withheldKeys } from '../ir/config.mjs';
import { applyPlan } from './apply.mjs';
import { out, printPlan, printResults } from './print.mjs';

const PARTS = { instructions: 'instructions', mcp: 'mcpServers', skills: 'skills' };

export function runConfig({ from, to, what, cwd = process.cwd(), apply, force, 'include-secrets': includeSecrets }) {
  if (!from || !to) throw new Error('config needs --from and --to');
  const wanted = (what ?? Object.keys(PARTS).join(',')).split(',').map((w) => w.trim());
  const unknown = wanted.filter((w) => !PARTS[w]);
  if (unknown.length) throw new Error(`unknown --what ${unknown.join(', ')}; expected ${Object.keys(PARTS).join(', ')}`);

  const config = TOOLS[from].parseConfig({ cwd, includeSecrets });
  for (const [name, key] of Object.entries(PARTS)) if (!wanted.includes(name)) config[key] = [];
  out(`Source: ${from} config (${config.instructions.length} instruction files, ${config.mcpServers.length} MCP servers, ${config.skills.length} skills)`);
  const withheld = withheldKeys(config);
  if (withheld.length) out(`Secrets withheld (keys only; --include-secrets copies values): ${withheld.join(', ')}`);
  const plan = TOOLS[to].emitConfig(config, { cwd, force });
  plan.notes = [...config.notes, ...plan.notes];
  printPlan(plan, apply);
  return apply ? printResults(applyPlan(plan.actions)) : 0;
}