import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { claudeHome, claudeProjectDir } from '../homes.mjs';
import { appendPart, createSession, noteUnknown, setToolOutput, toolPart } from '../ir/session.mjs';
import { peekJsonl, readJsonl } from './jsonl.mjs';

const METADATA = new Set(['system', 'file-history-snapshot', 'last-prompt', 'ai-title', 'custom-title', 'summary', 'mode', 'permission-mode', 'queue-operation', 'cost-state', 'tag', 'agent-name', 'pr-link', 'file-history-delta', 'atis-latch']);

const projectsDir = () => join(claudeHome(), 'projects');

function sessionFiles(cwd) {
  const root = projectsDir();
  if (!existsSync(root)) return [];
  const dirs = cwd ? [claudeProjectDir(cwd)].filter(existsSync) : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name));
  return dirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)));
}

const titleOf = (records) => records.findLast((r) => r.type === 'custom-title')?.customTitle ?? records.findLast((r) => r.type === 'ai-title')?.aiTitle;

export function listClaudeSessions({ cwd } = {}) {
  return sessionFiles(cwd).map((file) => {
    const { head, tail, size } = peekJsonl(file);
    const first = head.find((r) => r.cwd && r.timestamp);
    const last = [...head, ...tail].findLast((r) => r.timestamp);
    return {
      id: basename(file, '.jsonl'),
      title: titleOf([...head, ...tail]) ?? null,
      cwd: first?.cwd ?? null,
      startedAt: first?.timestamp ?? null,
      updatedAt: last?.timestamp ?? null,
      version: first?.version ?? null,
      size,
      file,
    };
  });
}

export function findClaudeSession(id) {
  const matches = sessionFiles().filter((f) => basename(f, '.jsonl').startsWith(id));
  if (matches.length !== 1) throw new Error(matches.length ? `session id ${id} is ambiguous (${matches.length} matches)` : `no Claude session ${id} under ${projectsDir()}`);
  return matches[0];
}

const blockText = (content) => (typeof content === 'string' ? content : (content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

export function parseClaudeSession(file) {
  const { records, bad } = readJsonl(file);
  const session = createSession({ sourceTool: 'claude', sourceId: basename(file, '.jsonl') });
  session.dropped.badLines = bad;
  session.title = titleOf(records) ?? null;

  const byUuid = new Map();
  let leaf;
  for (const r of records) {
    if (r.uuid) byUuid.set(r.uuid, r);
    if ((r.type === 'user' || r.type === 'assistant') && !r.isSidechain) leaf = r;
    else if (!METADATA.has(r.type) && r.type !== 'attachment' && r.type !== 'user' && r.type !== 'assistant') noteUnknown(session, r.type);
  }

  // Rewinds leave abandoned branches in the same file; only the chain that ends at the latest message is the live conversation.
  const chain = [];
  const seen = new Set();
  for (let r = leaf; r && !seen.has(r.uuid); r = byUuid.get(r.parentUuid ?? r.logicalParentUuid)) {
    seen.add(r.uuid);
    chain.push(r);
  }
  chain.reverse();

  const tools = new Map();
  for (const r of chain) {
    if (r.cwd && !session.cwd) Object.assign(session, { cwd: r.cwd, sourceVersion: r.version ?? null, gitBranch: r.gitBranch || null, startedAt: r.timestamp ?? null });
    if (r.type === 'attachment') session.dropped.attachments++;
    if (r.type === 'user') readUser(session, r, tools);
    if (r.type === 'assistant') readAssistant(session, r, tools);
  }
  return session;
}

function readUser(session, r, tools) {
  if (r.isMeta) return void session.dropped.metaMessages++;
  const content = r.message?.content;
  if (typeof content === 'string') return void appendPart(session, 'user', { kind: 'text', text: content }, r.timestamp);
  for (const block of content ?? []) {
    if (block.type === 'text') appendPart(session, 'user', { kind: 'text', text: block.text }, r.timestamp);
    else if (block.type === 'tool_result') {
      const part = tools.get(block.tool_use_id);
      if (part) setToolOutput(session, part, blockText(block.content), block.is_error);
      if (Array.isArray(block.content)) session.dropped.images += block.content.filter((b) => b.type === 'image').length;
    } else if (block.type === 'image') session.dropped.images++;
    else if (block.type === 'document') session.dropped.attachments++;
    else noteUnknown(session, `user/${block.type}`);
  }
}

function readAssistant(session, r, tools) {
  for (const block of r.message?.content ?? []) {
    if (block.type === 'text') appendPart(session, 'assistant', { kind: 'text', text: block.text }, r.timestamp);
    else if (block.type === 'thinking' || block.type === 'redacted_thinking') session.dropped.thinking++;
    else if (block.type === 'tool_use') tools.set(block.id, appendPart(session, 'assistant', toolPart(block.name, block.input), r.timestamp));
    else noteUnknown(session, `assistant/${block.type}`);
  }
}