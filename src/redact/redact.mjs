const MASK = '[REDACTED]';

const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk-(?:ant-|proj-)?|sk_(?:live|test)_|pk_live_|rk_(?:live|test)_|tk_|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[abprs]-)[A-Za-z0-9_-]{12,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const BEARER = /\b(Bearer|Basic)(\s+)(?!\[REDACTED)[A-Za-z0-9._~+/=-]{12,}/gi;
// KEY=value, KEY: value, "key": "value" where the key name looks secret and the value looks like a credential
// (8+ characters with a digit or symbol), so prose such as "password: see above" is left alone.
const ASSIGNMENT = /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|credential)[A-Za-z0-9_]*)(["']?\s*[=:]\s*)(["']?)(?!\$\{|\[REDACTED)(?=[^\s"'`,;]*[\d_+/=-])([^\s"'`,;]{8,})/gi;

export function redactText(text) {
  let count = 0;
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, () => (count++, MASK));
  out = out.replace(BEARER, (_, scheme, gap) => (count++, `${scheme}${gap}${MASK}`));
  out = out.replace(ASSIGNMENT, (_, key, sep, quote) => (count++, `${key}${sep}${quote}${MASK}`));
  return { text: out, count };
}

function deep(value, tally) {
  if (typeof value === 'string') {
    const { text, count } = redactText(value);
    tally.count += count;
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => deep(v, tally));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v, tally)]));
  return value;
}

export function redactSession(session) {
  const tally = { count: 0 };
  session.title = deep(session.title, tally);
  session.turns = deep(session.turns, tally);
  return tally.count;
}