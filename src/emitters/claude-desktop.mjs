import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from '../files.mjs';
import { claudeDesktopDir } from '../homes.mjs';
import { writeAction } from './plan.mjs';

const UNRECOGNISED = 'desktop app record format not recognised; the session still opens with claude --resume';
const RESTART = 'fully quit and reopen the Claude desktop app to see it in the sidebar';

const subdirs = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dir, e.name));

// The app keeps one record per session under claude-code-sessions/<account>/<org>/; deleted_* files are tombstones.
function newestRecords(root) {
  return subdirs(root).flatMap(subdirs).flatMap((dir) => {
    const newest = readdirSync(dir).filter((f) => /^local_.+\.json$/.test(f))
      .map((f) => ({ dir, file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    return newest ? [newest] : [];
  }).sort((a, b) => b.mtime - a.mtime);
}

function parseRecord(file) {
  try {
    const r = JSON.parse(readText(file).replace(/^\uFEFF/, ''));
    const ok = typeof r?.sessionId === 'string' && r.sessionId.startsWith('local_') && typeof r.cliSessionId === 'string'
      && typeof r.cwd === 'string' && typeof r.title === 'string' && typeof r.createdAt === 'number';
    return ok ? r : null;
  } catch {
    return null;
  }
}

// Best effort against an undocumented format: only ever adds a new record, copying app-owned settings from the newest one.
export function emitDesktopRecord({ cliSessionId, cwd, title, now }) {
  const root = join(claudeDesktopDir(), 'claude-code-sessions');
  const found = existsSync(root) ? newestRecords(root) : [];
  if (!found.length) return { actions: [], notes: [`no Claude desktop app session records under ${root}; skipped the sidebar record`] };
  const [pick] = found;
  const notes = found.length > 1 ? [`${found.length} Claude desktop account/org folders have sessions; using the most recently used one, ${pick.dir}`] : [];
  const template = parseRecord(pick.file);
  if (!template) return { actions: [], notes: [...notes, UNRECOGNISED] };

  const sessionId = `local_${randomUUID()}`;
  const ms = now.getTime();
  const record = {
    sessionId, cliSessionId, cwd, originCwd: cwd, lastFocusedAt: ms, createdAt: ms, lastActivityAt: ms,
    model: template.model, effort: template.effort, isArchived: false, title, permissionMode: template.permissionMode,
    completedTurns: 0, indexedAt: ms,
  };
  return {
    actions: [writeAction(join(pick.dir, `${sessionId}.json`), JSON.stringify(record), { what: 'Claude desktop sidebar record' })],
    notes: [...notes, RESTART],
  };
}