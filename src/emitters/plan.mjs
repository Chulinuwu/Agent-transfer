import { existsSync } from 'node:fs';
import { readText } from '../files.mjs';

const REPLACE_HINT = 'rerun with --force to replace it (a backup is kept)';

// Common prefix/suffix trimming is enough for the edits this tool makes (appends, inserted blocks, replaced files)
// and stays linear on large files such as ~/.claude.json.
export function diffLines(before, after, limit = 120) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const lines = [`@@ line ${start + 1} @@`, ...a.slice(start, a.length - end).map((l) => `- ${l}`), ...b.slice(start, b.length - end).map((l) => `+ ${l}`)];
  return lines.length > limit ? [...lines.slice(0, limit), `[... ${lines.length - limit} more diff lines]`].join('\n') : lines.join('\n');
}

// merge: the content was built from the current file (config merges), so writing it never loses user content.
export function writeAction(path, content, { what, force = false, merge = false }) {
  const current = readText(path);
  if (current === null) return { type: 'write', what, path, content };
  if (current === content) return { type: 'skip', what, path, reason: 'already identical' };
  const diff = diffLines(current, content);
  if (merge || force) return { type: 'write', what, path, content, diff, replaces: true };
  return { type: 'skip', what, path, reason: `target exists and differs; ${REPLACE_HINT}`, diff };
}

export function copyAction(from, to, { what, force = false }) {
  if (!existsSync(to)) return { type: 'copy', what, from, to };
  if (!force) return { type: 'skip', what, path: to, reason: `target exists; ${REPLACE_HINT}` };
  return { type: 'copy', what, from, to, replaces: true };
}