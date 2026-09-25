import { join } from 'node:path';
import { handoffDir } from '../homes.mjs';
import { describeDropped, textOf } from '../ir/session.mjs';
import { writeAction } from './plan.mjs';
import { renderTurn } from './turn-text.mjs';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[... trimmed]` : s);
const tools = (session) => session.turns.flatMap((t) => t.parts.filter((p) => p.kind === 'tool'));
const FILE_TOOLS = /^(write|edit|multiedit|notebookedit|create_file|str_replace_editor)$/i;

function filesTouched(session) {
  const files = new Set();
  for (const part of tools(session)) {
    const input = part.input && typeof part.input === 'object' ? part.input : {};
    const path = input.file_path ?? input.notebook_path ?? input.path;
    if (FILE_TOOLS.test(part.name) && typeof path === 'string') files.add(path);
    const raw = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? '');
    for (const m of raw.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n"\\]+)/g)) files.add(m[1].trim());
  }
  return [...files];
}

// The newest plan the agent wrote: Claude's TodoWrite {todos:[{content,status}]} or Codex's update_plan {plan:[{step,status}]}.
function openTodos(session) {
  const plan = tools(session).findLast((p) => Array.isArray(p.input?.todos) || Array.isArray(p.input?.plan));
  const items = plan ? (plan.input.todos ?? plan.input.plan) : [];
  return items.filter((i) => i.status !== 'completed').map((i) => `- [${i.status ?? 'pending'}] ${i.content ?? i.step ?? JSON.stringify(i)}`);
}

export function buildBrief(session, { lastTurns = 12, toolOutput = 'none' } = {}) {
  const firstUser = session.turns.find((t) => t.role === 'user' && textOf(t).trim());
  const lastAssistant = session.turns.findLast((t) => t.role === 'assistant' && textOf(t).trim());
  const todos = openTodos(session);
  const files = filesTouched(session);
  const recent = session.turns.slice(-lastTurns).map((t) => `### ${t.role}${t.at ? ` (${t.at})` : ''}\n\n${clip(renderTurn(t, { toolOutput }), 3000)}`);
  return [
    `# Handoff from ${session.sourceTool} session ${session.sourceId}`,
    '',
    `- Title: ${session.title ?? '(none)'}`,
    `- Project directory: ${session.cwd ?? '(unknown)'}`,
    `- Started: ${session.startedAt ?? '(unknown)'}`,
    `- Source version: ${session.sourceVersion ?? '(unknown)'}`,
    '',
    '## Goal (first request)',
    '',
    firstUser ? clip(textOf(firstUser), 1500) : '(none recorded)',
    '',
    '## Where it stands (latest assistant message)',
    '',
    lastAssistant ? clip(textOf(lastAssistant), 2000) : '(none recorded)',
    '',
    '## Open todos',
    '',
    todos.length ? todos.join('\n') : '(no open plan items recorded)',
    '',
    '## Files touched',
    '',
    files.length ? files.map((f) => `- ${f}`).join('\n') : '(none detected)',
    '',
    `## Last ${Math.min(lastTurns, session.turns.length)} turns`,
    '',
    recent.join('\n\n'),
    '',
    '## Not carried over',
    '',
    describeDropped(session.dropped),
    '',
    '---',
    'Continue this work. Check the current state of the files first; this brief may be out of date.',
    '',
  ].join('\n');
}

const LAUNCH = { claude: 'claude', codex: 'codex' };

export function emitHandoff(session, { target, out, lastTurns, toolOutput } = {}) {
  const path = out ?? join(handoffDir(), `${session.sourceTool}-${session.sourceId}.md`);
  // Codex names a new thread from its first prompt, so leading with the source title keeps it findable.
  const prompt = `${session.title ? `Continue "${session.title}". ` : ''}Read the handoff brief at ${path} and continue the work it describes.`;
  const cd = session.cwd ? `cd "${session.cwd}" && ` : '';
  const commands = LAUNCH[target]
    ? [{ type: 'run', what: `start ${target} with the brief`, command: `${cd}${LAUNCH[target]} "${prompt}"` }]
    : [{ type: 'run', what: 'paste into the target agent', command: prompt }];
  if (target === 'codex') commands.push({ type: 'run', what: 'or run it non-interactively', command: `${cd}codex exec "${prompt}"` });
  return { actions: [writeAction(path, buildBrief(session, { lastTurns, toolOutput }), { what: 'handoff brief', force: true }), ...commands] };
}