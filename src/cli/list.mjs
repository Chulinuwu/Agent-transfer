import { TOOLS } from '../tools.mjs';
import { out } from './print.mjs';

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

export function runList({ from, cwd, limit, json }) {
  if (!from) throw new Error('list needs --from');
  const sessions = TOOLS[from].listSessions({ cwd })
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, limit ? Number(limit) : undefined);
  if (json) out(JSON.stringify(sessions.map(({ file, ...s }) => s), null, 2));
  else for (const s of sessions) out(`${s.id}  ${(s.updatedAt ?? '').slice(0, 16)}  ${kb(s.size).padStart(8)}  ${s.title ?? '(untitled)'}  ${s.cwd ?? ''}`);
  return 0;
}