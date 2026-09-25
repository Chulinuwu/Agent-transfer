import { redactText } from '../redact/redact.mjs';

export const out = (line = '') => process.stdout.write(`${line}\n`);
export const warn = (line) => process.stderr.write(`warning: ${line}\n`);

export function printPlan({ actions, notes = [] }, apply) {
  out(apply ? 'Applying:' : 'Preview (nothing written; rerun with --apply to write):');
  for (const a of actions) {
    if (a.type === 'write') out(`  ${a.replaces ? 'update' : 'create'} ${a.path}  (${a.what}, ${Buffer.byteLength(a.content)} bytes)`);
    if (a.type === 'copy') out(`  ${a.replaces ? 'replace' : 'copy'} ${a.from} -> ${a.to}  (${a.what})`);
    if (a.type === 'skip') out(`  skip ${a.path ?? ''}  (${a.what}: ${a.reason})`);
    if (a.type === 'run') out(`  then ${a.what}: ${a.command}`);
    // Diffs can include config values; mask anything credential-shaped before it reaches the terminal.
    if (a.diff && !apply) out(redactText(a.diff).text.split('\n').map((l) => `      ${l}`).join('\n'));
  }
  for (const n of notes) out(`  note: ${n}`);
}

export function printResults(results) {
  for (const r of results) out(r.ok ? `  ok ${r.path}${r.backup ? `  (backup ${r.backup})` : ''}` : `  FAILED ${r.path}: ${r.error}`);
  return results.every((r) => r.ok) ? 0 : 1;
}

