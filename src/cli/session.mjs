import { describeDropped, trimSession } from '../ir/session.mjs';
import { emitHandoff } from '../emitters/handoff.mjs';
import { redactSession } from '../redact/redact.mjs';
import { TOOLS } from '../tools.mjs';
import { versionWarning } from '../versions.mjs';
import { applyPlan } from './apply.mjs';
import { out, printPlan, printResults, warn } from './print.mjs';

export function runSession({ from, to, id, last, mode, cwd, out: outFile, apply, json, 'no-redact': noRedact }) {
  if (!from || !id || (!to && !json)) throw new Error('session needs --from, --id and --to (or --json to print the IR)');
  if (mode && mode !== 'native' && mode !== 'handoff') throw new Error(`unknown --mode ${mode}; expected native or handoff`);
  if (last !== undefined && !(Number(last) > 0)) throw new Error('--last needs a positive number');
  const session = TOOLS[from].parseSession(TOOLS[from].findSession(id));
  const drift = versionWarning(from, session.sourceVersion);
  if (drift) warn(drift);
  trimSession(session, { lastTurns: last ? Number(last) : 200 });
  const redactions = noRedact ? 0 : redactSession(session);
  if (json) {
    out(JSON.stringify(session, null, 2));
    return 0;
  }

  const toolParts = session.turns.reduce((n, t) => n + t.parts.filter((p) => p.kind === 'tool').length, 0);
  out(`Source: ${from} session ${session.sourceId} (${session.sourceVersion ?? 'unknown version'}), cwd ${session.cwd ?? 'unknown'}`);
  out(`Carried: ${session.turns.length} turns, ${toolParts} tool calls rendered as text`);
  out(`Dropped or approximated: ${describeDropped(session.dropped)}`);
  out(noRedact ? 'Redaction: off (--no-redact)' : `Redaction: ${redactions} secret-looking values masked`);
  const options = { cwd: cwd ?? session.cwd, out: outFile };
  const plan = mode === 'handoff' ? emitHandoff(session, { ...options, target: to }) : TOOLS[to].emitSession(session, options);
  printPlan(plan, apply);
  return apply ? printResults(applyPlan(plan.actions)) : 0;
}