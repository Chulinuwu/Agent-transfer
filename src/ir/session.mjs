export const IR_VERSION = 1;
const OUTPUT_LIMIT = 2000;

export const createSession = (fields) => ({
  ir: IR_VERSION,
  kind: 'session',
  sourceTool: null,
  sourceVersion: null,
  sourceId: null,
  cwd: null,
  gitBranch: null,
  title: null,
  startedAt: null,
  turns: [],
  dropped: {
    thinking: 0,
    images: 0,
    attachments: 0,
    injectedContext: 0,
    metaMessages: 0,
    encryptedParts: 0,
    badLines: 0,
    truncatedOutputs: 0,
    trimmedTurns: 0,
    unknownRecordTypes: [],
  },
  ...fields,
});

export function noteUnknown(session, type) {
  if (!session.dropped.unknownRecordTypes.includes(type)) session.dropped.unknownRecordTypes.push(type);
}

export function appendPart(session, role, part, at) {
  const last = session.turns.at(-1);
  if (last?.role === role) last.parts.push(part);
  else session.turns.push({ role, at: at ?? null, parts: [part] });
  return part;
}

const firstLine = (s) => String(s).split('\n').find((l) => l.trim())?.trim() ?? '';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...` : s);

function summarize(input) {
  if (typeof input === 'string') {
    const patched = [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
    return clip(patched.length ? `patch ${patched.join(', ')}` : firstLine(input), 160);
  }
  if (!input || typeof input !== 'object') return '';
  const pick = input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.notebook_path ?? input.pattern ?? input.query ?? input.url ?? input.description;
  if (pick !== undefined) return clip(Array.isArray(pick) ? pick.join(' ') : firstLine(pick), 160);
  return clip(JSON.stringify(input), 160);
}

export const toolPart = (name, input) => ({ kind: 'tool', name, summary: summarize(input), input, output: null, isError: false });

export function setToolOutput(session, part, output, isError = false) {
  const text = String(output ?? '');
  if (text.length > OUTPUT_LIMIT) session.dropped.truncatedOutputs++;
  part.output = text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n[... ${text.length - OUTPUT_LIMIT} more characters trimmed]` : text;
  part.isError = Boolean(isError);
}

export function trimSession(session, { lastTurns = 200, maxBytes = 1_000_000 } = {}) {
  let keep = session.turns.slice(-lastTurns);
  let bytes = 0;
  let start = keep.length;
  while (start > 0 && (start === keep.length || bytes + JSON.stringify(keep[start - 1]).length <= maxBytes)) bytes += JSON.stringify(keep[--start]).length;
  keep = keep.slice(start);
  session.dropped.trimmedTurns += session.turns.length - keep.length;
  session.turns = keep;
  return session;
}

export const textOf = (turn) => turn.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n');
export function describeDropped(dropped) {
  const counts = Object.entries(dropped).filter(([, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${k} ${v}`);
  if (dropped.unknownRecordTypes.length) counts.push(`unknown record types: ${dropped.unknownRecordTypes.join(', ')}`);
  return counts.length ? counts.join('; ') : 'nothing';
}