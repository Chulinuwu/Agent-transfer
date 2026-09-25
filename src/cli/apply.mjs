import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// Each action is independent: one failure is reported and the rest still run, so a rerun only redoes what failed.
export function applyPlan(actions) {
  return actions.filter((a) => a.type === 'write' || a.type === 'copy').map((a) => {
    const target = a.path ?? a.to;
    try {
      mkdirSync(dirname(target), { recursive: true });
      let backup;
      if (existsSync(target)) {
        backup = `${target}.bak-${stamp()}`;
        if (a.type === 'write') copyFileSync(target, backup);
        else renameSync(target, backup);
      }
      if (a.type === 'write') {
        const tmp = `${target}.tmp-${process.pid}`;
        writeFileSync(tmp, a.content);
        renameSync(tmp, target);
      } else cpSync(a.from, target, { recursive: true, dereference: true });
      return { ok: true, what: a.what, path: target, backup };
    } catch (error) {
      return { ok: false, what: a.what, path: target, error: error.message };
    }
  });
}