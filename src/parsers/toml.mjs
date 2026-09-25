// A small TOML 1.0 reader, enough for agent config files: tables, array tables, dotted and quoted keys,
// basic/literal/multi-line strings, numbers, booleans, arrays and inline tables. Dates stay strings.
// ponytail: no full spec conformance (datetime types, some number forms); swap for a TOML library if configs outgrow it.
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

export function parseToml(text) {
  const root = {};
  let table = root;
  let i = 0;
  const fail = (message) => {
    throw new Error(`TOML: ${message} on line ${text.slice(0, i).split('\n').length}`);
  };
  const spaces = () => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  const comment = () => {
    if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
  };
  const trivia = () => {
    for (;;) {
      spaces();
      comment();
      if (text[i] !== '\n' && text[i] !== '\r') return;
      i++;
    }
  };

  const string = () => {
    const q = text[i];
    const multi = text.startsWith(q.repeat(3), i);
    i += multi ? 3 : 1;
    if (multi && text[i] === '\r') i++;
    if (multi && text[i] === '\n') i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      if (multi ? text.startsWith(q.repeat(3), i) : text[i] === q) {
        i += multi ? 3 : 1;
        return out;
      }
      if (!multi && text[i] === '\n') fail('newline in string');
      if (q === '"' && text[i] === '\\') {
        const c = text[++i];
        if (c in ESCAPES) {
          out += ESCAPES[c];
          i++;
        } else if (c === 'u' || c === 'U') {
          const n = c === 'u' ? 4 : 8;
          out += String.fromCodePoint(Number.parseInt(text.slice(i + 1, i + 1 + n), 16));
          i += 1 + n;
        } else if (multi && /\s/.test(c)) {
          while (/\s/.test(text[i])) i++;
        } else fail('bad escape');
        continue;
      }
      out += text[i++];
    }
  };

  const key = () => {
    spaces();
    if (text[i] === '"' || text[i] === "'") return string();
    const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 256));
    if (!m) fail('bad key');
    i += m[0].length;
    return m[0];
  };
  const keyPath = () => {
    const path = [key()];
    spaces();
    while (text[i] === '.') {
      i++;
      path.push(key());
      spaces();
    }
    if (path.includes('__proto__')) fail('forbidden key');
    return path;
  };
  const descend = (obj, path) => path.reduce((t, k) => {
    if (Array.isArray(t[k])) return t[k].at(-1);
    t[k] ??= {};
    if (typeof t[k] !== 'object') fail(`${k} is not a table`);
    return t[k];
  }, obj);
  const assign = (obj, path, v) => {
    const t = descend(obj, path.slice(0, -1));
    if (Object.hasOwn(t, path.at(-1))) fail(`duplicate key ${path.at(-1)}`);
    t[path.at(-1)] = v;
  };
  const equals = () => {
    spaces();
    if (text[i++] !== '=') fail('expected =');
  };

  const value = () => {
    spaces();
    const c = text[i];
    if (c === '"' || c === "'") return string();
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        trivia();
        if (text[i] === ']') return i++, arr;
        arr.push(value());
        trivia();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail('expected , or ]');
      }
    }
    if (c === '{') {
      i++;
      const obj = {};
      spaces();
      if (text[i] === '}') return i++, obj;
      for (;;) {
        const path = keyPath();
        equals();
        assign(obj, path, value());
        spaces();
        const next = text[i++];
        if (next === '}') return obj;
        if (next !== ',') fail('expected , or }');
      }
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(i, i + 64));
    if (!m) fail('bad value');
    i += m[0].length;
    const raw = m[0];
    if (raw === 'true' || raw === 'false') return raw === 'true';
    if (/^[+-]?(?:\d[\d_]*)(?:\.[\d_]+)?(?:[eE][+-]?\d+)?$/.test(raw)) return Number(raw.replace(/_/g, ''));
    if (/^0x[0-9a-fA-F_]+$/.test(raw)) return Number.parseInt(raw.slice(2).replace(/_/g, ''), 16);
    return raw;
  };

  for (;;) {
    trivia();
    if (i >= text.length) return root;
    if (text[i] === '[') {
      const many = text[i + 1] === '[';
      i += many ? 2 : 1;
      const path = keyPath();
      const close = many ? ']]' : ']';
      if (!text.startsWith(close, i)) fail('bad table header');
      i += close.length;
      if (many) {
        table = {};
        (descend(root, path.slice(0, -1))[path.at(-1)] ??= []).push(table);
      } else table = descend(root, path);
    } else {
      const path = keyPath();
      equals();
      assign(table, path, value());
    }
    spaces();
    comment();
    if (i < text.length && text[i] !== '\n' && text[i] !== '\r') fail('expected end of line');
  }
}

const BARE = /^[A-Za-z0-9_-]+$/;
export const tomlKey = (k) => (BARE.test(k) ? k : JSON.stringify(k));
// JSON string escapes are a subset of TOML basic-string escapes.
export const tomlValue = (v) => (Array.isArray(v) ? `[${v.map(tomlValue).join(', ')}]` : typeof v === 'string' ? JSON.stringify(v) : String(v));