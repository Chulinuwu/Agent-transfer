import { parseArgs } from 'node:util';
import { TOOLS } from '../tools.mjs';
import { runConfig } from './config.mjs';
import { runList } from './list.mjs';
import { runSession } from './session.mjs';

const USAGE = `agent-transfer: move sessions and config between coding agents (${Object.keys(TOOLS).join(', ')})

  agent-transfer list    --from <tool> [--cwd DIR] [--limit N] [--json]
  agent-transfer session --from <tool> --to <tool> --id <id> [--last N] [--mode native|handoff]
                         [--tool-output none|short|full] [--desktop auto|off]
                         [--cwd DIR] [--out FILE] [--no-redact] [--json] [--apply]
  agent-transfer config  --from <tool> --to <tool> [--what instructions,mcp,skills] [--cwd DIR]
                         [--include-secrets] [--force] [--apply]

Nothing is written without --apply; --dry-run is the default and can be passed explicitly.`;

const OPTIONS = {
  from: { type: 'string' },
  to: { type: 'string' },
  id: { type: 'string' },
  cwd: { type: 'string' },
  last: { type: 'string' },
  limit: { type: 'string' },
  mode: { type: 'string' },
  out: { type: 'string' },
  what: { type: 'string' },
  'tool-output': { type: 'string', default: 'none' },
  desktop: { type: 'string', default: 'auto' },
  apply: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  'no-redact': { type: 'boolean', default: false },
  'include-secrets': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const COMMANDS = { list: runList, session: runSession, config: runConfig };

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = COMMANDS[positionals[0]];
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 2;
  }
  for (const flag of ['from', 'to']) {
    if (values[flag] !== undefined && !TOOLS[values[flag]]) {
      process.stderr.write(`unknown --${flag} ${values[flag]}; expected one of ${Object.keys(TOOLS).join(', ')}\n`);
      return 2;
    }
  }
  if (values.apply && values['dry-run']) {
    process.stderr.write('--apply and --dry-run are mutually exclusive\n');
    return 2;
  }
  try {
    return await command(values);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}