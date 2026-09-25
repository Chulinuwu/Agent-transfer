import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { codexSessionHomes } from '../homes.mjs';
import { appendPart, createSession, noteUnknown, setToolOutput, toolPart } from '../ir/session.mjs';
import { peekJsonl, readJsonl } from './jsonl.mjs';

const METADATA = new Set(['turn_context', 'event_msg', 'world_state', 'token_usage_record', 'compacted', 'inter_agent_communication_metadata', 'realtime_item']);
const TOOL_CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call', 'tool_search_call']);
const TOOL_OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'tool_search_output']);

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const sessionRoots = () => codexSessionHomes().map((home) => join(home, 'sessions'));

// Orca's home can hold copies of ~/.codex rollouts, so one thread may live in both; the larger copy has the most turns.
const rolloutFiles = () => {
  const byName = new Map();
  for (const root of sessionRoots().filter(existsSync)) {
    for (const file of walk(root).filter((f) => /^rollout-.*\.jsonl$/.test(basename(f)))) {
      const kept = byName.get(basename(file));
      if (!kept || statSync(file).size > statSync(kept).size) byName.set(basename(file), file);
    }
  }
  return [...byName.values()];
};
const idFromName = (file) => /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file)?.[1] ?? basename(file, '.jsonl');

function threadNames() {
  const names = new Map();
  for (const index of codexSessionHomes().map((home) => join(home, 'session_index.jsonl')).filter(existsSync)) {
    for (const line of readFileSync(index, 'utf8').split('\n')) {
      try {
        const { id, thread_name: name } = JSON.parse(line);
        if (id && name) names.set(id, name);
      } catch {}
    }
  }
  return names;
}

const samePath = (a, b) => a && b && resolve(a).toLowerCase() === resolve(b).toLowerCase();

export function listCodexSessions({ cwd } = {}) {
  const names = threadNames();
  return rolloutFiles().map((file) => {
    // session_meta carries the base instructions, so the first line can be large.
    const { head, tail, size } = peekJsonl(file, 1024 * 1024);
    const meta = head.find((r) => r.type === 'session_meta')?.payload;
    const id = meta?.id ?? idFromName(file);
    return {
      id,
      title: names.get(id) ?? firstRequest(head),
      cwd: meta?.cwd ?? null,
      startedAt: meta?.timestamp ?? null,
      updatedAt: [...head, ...tail].findLast((r) => r.timestamp)?.timestamp ?? null,
      version: meta?.cli_version ?? null,
      historyMode: meta?.history_mode ?? null,
      size,
      file,
    };
  }).filter((s) => !cwd || samePath(s.cwd, cwd));
}

export function findCodexSession(id) {
  const matches = rolloutFiles().filter((f) => idFromName(f).startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`session id ${id} is ambiguous (${matches.length} matches)`);
  // Codex 0.154 also projects threads into thread_history_1.sqlite, but every thread still has a rollout file;
  // one without is not something this tool reads.
  throw new Error(`no rollout file for Codex thread ${id} under ${sessionRoots().join(' or ')}; if the thread only exists in Codex's sqlite store, resume it in Codex and let it write a rollout first`);
}

// Codex injects instructions and environment as user-role messages wrapped in a single tag, e.g.
// <environment_context>...</environment_context>, or as "# AGENTS.md instructions ...".
const isInjected = (text) => /^\s*<([a-z_]+(?: [a-z_]+)?)[\s>][\s\S]*<\/\1>\s*$/.test(text) || /^\s*# AGENTS\.md instructions/.test(text) || /^\s*<\/?image\b/.test(text);

// Codex itself falls back to the first real user message for unnamed threads.
const firstRequest = (records) => {
  for (const r of records) {
    if (r.type !== 'response_item' || r.payload?.type !== 'message' || r.payload.role !== 'user') continue;
    const text = r.payload.content?.find((c) => typeof c.text === 'string' && !isInjected(c.text))?.text;
    if (text) return text.trim().split('\n')[0].slice(0, 80);
  }
  return null;
};

const outputText = (output) => {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map((o) => o.text ?? '').join('\n');
  return output?.content ?? JSON.stringify(output ?? '');
};
const parseArgs = (s) => {
  try { return JSON.parse(s); } catch { return s; }
};
const failed = (text) => /^\s*(?:Exit code:|Process exited with code)\s*[1-9]/m.test(text) || /"exit_code"\s*:\s*[1-9]/.test(text);

export function parseCodexSession(file) {
  const { records, bad } = readJsonl(file);
  const session = createSession({ sourceTool: 'codex', sourceId: idFromName(file) });
  session.dropped.badLines = bad;
  const calls = new Map();
  for (const r of records) {
    const p = r.payload ?? {};
    if (r.type === 'session_meta') {
      Object.assign(session, { sourceId: p.id ?? session.sourceId, cwd: p.cwd ?? null, sourceVersion: p.cli_version ?? null, startedAt: p.timestamp ?? r.timestamp ?? null, gitBranch: p.git?.branch ?? null });
    } else if (r.type === 'response_item') readItem(session, p, r.timestamp, calls);
    else if (!METADATA.has(r.type)) noteUnknown(session, r.type);
  }
  session.title = threadNames().get(session.sourceId) ?? firstRequest(records) ?? null;
  return session;
}

function readItem(session, p, at, calls) {
  if (p.type === 'message') {
    if (p.role !== 'user' && p.role !== 'assistant') return void session.dropped.injectedContext++;
    for (const c of p.content ?? []) {
      if (c.type === 'input_image') session.dropped.images++;
      else if (typeof c.text !== 'string') noteUnknown(session, `message/${c.type}`);
      else if (p.role === 'user' && isInjected(c.text)) session.dropped.injectedContext++;
      else appendPart(session, p.role, { kind: 'text', text: c.text }, at);
    }
  } else if (p.type === 'reasoning') session.dropped.thinking++;
  else if (p.type === 'agent_message') {
    // Inter-agent messages are how a subagent thread receives its task (and how a parent hears back), so they read as incoming turns.
    for (const c of p.content ?? []) {
      if (typeof c.text === 'string') appendPart(session, 'user', { kind: 'text', text: `[message from ${p.author ?? 'agent'} to ${p.recipient ?? 'agent'}]\n${c.text}` }, at);
      else session.dropped.encryptedParts++;
    }
  }
  else if (TOOL_CALLS.has(p.type)) {
    const name = p.name ?? p.type.replace(/_call$/, '').replace(/^local_/, '');
    const input = typeof p.arguments === 'string' ? parseArgs(p.arguments) : (p.input ?? p.arguments ?? p.action ?? null);
    const part = appendPart(session, 'assistant', toolPart(name, input), at);
    if (p.call_id) calls.set(p.call_id, part);
  } else if (TOOL_OUTPUTS.has(p.type)) {
    const part = calls.get(p.call_id);
    const text = p.tools ? p.tools.map((tool) => tool.name).join(', ') : outputText(p.output);
    if (part) setToolOutput(session, part, text, failed(text));
  } else noteUnknown(session, `response_item/${p.type}`);
}