import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { claudeProjectDir } from '../homes.mjs';
import { TESTED } from '../versions.mjs';
import { writeAction } from './plan.mjs';

const OUTPUT_LINES = 20;

export function renderPart(part) {
  if (part.kind === 'text') return part.text;
  const head = `[tool ${part.name}${part.isError ? ', failed' : ''}] ${part.summary}`;
  if (!part.output) return head;
  const lines = part.output.split('\n');
  const shown = lines.slice(0, OUTPUT_LINES).join('\n');
  return `${head}\n  -> ${shown}${lines.length > OUTPUT_LINES ? `\n  [... ${lines.length - OUTPUT_LINES} more lines]` : ''}`;
}

const renderTurn = (turn) => turn.parts.map(renderPart).filter((t) => t.trim()).join('\n\n');

// Writes a transcript Claude Code can `--resume`: a uuid/parentUuid chain of plain text turns.
// Tool calls become text because tool_use/tool_result pairs must match tools Claude Code knows.
export function emitClaudeSession(session, { cwd = session.cwd, version = TESTED.claude.max, now = new Date() } = {}) {
  if (!cwd) throw new Error('the source session has no working directory; pass --cwd');
  const sessionId = randomUUID();
  const base = { isSidechain: false, userType: 'external', cwd, sessionId, version, gitBranch: session.gitBranch ?? '' };
  const note = `[Transferred from ${session.sourceTool} session ${session.sourceId} by agent-transfer. Reasoning, images, attachments and native tool calls did not carry over; tool calls are shown as text.]`;
  const turns = session.turns.map((t) => ({ role: t.role, at: t.at, text: renderTurn(t) })).filter((t) => t.text.trim());
  if (turns[0]?.role === 'user') turns[0].text = `${note}\n\n${turns[0].text}`;
  else turns.unshift({ role: 'user', at: null, text: note });

  const records = [];
  let parentUuid = null;
  for (const turn of turns) {
    const uuid = randomUUID();
    const timestamp = turn.at && !Number.isNaN(Date.parse(turn.at)) ? new Date(turn.at).toISOString() : now.toISOString();
    const message = turn.role === 'user'
      ? { role: 'user', content: turn.text }
      : { id: `msg_${randomUUID().replace(/-/g, '')}`, type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: turn.text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
    records.push({ parentUuid, ...base, type: turn.role, message, uuid, timestamp });
    parentUuid = uuid;
  }
  if (session.title) records.push({ type: 'ai-title', aiTitle: `${session.title} (from ${session.sourceTool})`, sessionId });

  const path = join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
  return {
    sessionId,
    actions: [
      writeAction(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, { what: 'Claude Code session' }),
      { type: 'run', what: 'resume it', command: `cd "${cwd}" && claude --resume ${sessionId}` },
    ],
  };
}