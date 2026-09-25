import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { claudeProjectDir } from '../homes.mjs';
import { TESTED } from '../versions.mjs';
import { emitDesktopRecord } from './claude-desktop.mjs';
import { writeAction } from './plan.mjs';
import { renderTurn } from './turn-text.mjs';

// Writes a transcript Claude Code can `--resume`: a uuid/parentUuid chain of plain text turns.
// Tool calls become text because tool_use/tool_result pairs must match tools Claude Code knows.
export function emitClaudeSession(session, { cwd = session.cwd, version = TESTED.claude.max, now = new Date(), toolOutput = 'none', desktop = 'auto' } = {}) {
  if (!cwd) throw new Error('the source session has no working directory; pass --cwd');
  const sessionId = randomUUID();
  const shortId = String(session.sourceId).slice(0, 8);
  const base = { isSidechain: false, userType: 'external', cwd, sessionId, version, gitBranch: session.gitBranch ?? '' };
  const note = `_Transferred from ${session.sourceTool} session ${shortId} by agent-transfer; reasoning, images and native tool calls did not carry over._`;
  const turns = session.turns.map((t) => ({ role: t.role, at: t.at, text: renderTurn(t, { toolOutput }) })).filter((t) => t.text.trim());
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
  const title = session.title ? `${session.title} (from ${session.sourceTool})` : `${session.sourceTool} session ${shortId}`;
  // Claude Code's session lists show custom-title first; ai-title is kept for builds that only read that.
  if (session.title) records.push({ type: 'ai-title', aiTitle: title, sessionId }, { type: 'custom-title', customTitle: title, sessionId });

  const path = join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
  const sidebar = desktop === 'off' ? { actions: [], notes: [] } : emitDesktopRecord({ cliSessionId: sessionId, cwd, title, now });
  return {
    sessionId,
    actions: [
      writeAction(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, { what: 'Claude Code session' }),
      ...sidebar.actions,
      { type: 'run', what: 'resume it', command: `cd "${cwd}" && claude --resume ${sessionId}` },
    ],
    notes: sidebar.notes,
  };
}