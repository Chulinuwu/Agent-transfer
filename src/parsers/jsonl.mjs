import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

const parseLines = (lines) => lines.flatMap((line) => {
  if (!line.trim()) return [];
  try { return [JSON.parse(line)]; } catch { return []; }
});

export function readJsonl(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const records = parseLines(lines);
  return { records, bad: lines.length - records.length };
}

// Listing many multi-megabyte transcripts must not read them whole: identity lives at the head, titles near the tail.
// Partial lines at the cut points fail JSON.parse and are skipped.
export function peekJsonl(file, bytes = 256 * 1024) {
  const size = statSync(file).size;
  const fd = openSync(file, 'r');
  try {
    const read = (pos, len) => {
      const buf = Buffer.alloc(len);
      return buf.subarray(0, readSync(fd, buf, 0, len, pos)).toString('utf8');
    };
    const head = parseLines(read(0, Math.min(bytes, size)).split('\n'));
    const tail = size > bytes ? parseLines(read(size - bytes, bytes).split('\n').slice(1)) : [];
    return { head, tail, size };
  } finally {
    closeSync(fd);
  }
}