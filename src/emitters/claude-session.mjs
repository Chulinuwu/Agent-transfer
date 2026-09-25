import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { claudeProjectDir } from '../homes.mjs';
import { TESTED } from '../versions.mjs';
import { emitDesktopRecord } from './claude-desktop.mjs';
import { claudeToolResult, claudeToolUse } from './claude-tools.mjs';
import { writeAction } from './plan.mjs';
import { renderTurn } from './turn-text.mjs';

export const TOOL_RENDER = ['native', 'text', 'hidden'];
const hex = () => randomUUID().replace(/-/g, '');

// One Claude API message per segment: the prose before a tool call plus that call.
function segments(turn, { toolOutput, toolRender }) {
  if (turn.role === 'user' || toolRender !== 'native') return [{ text: renderTurn(turn, { toolOutput, tools: toolRender }), tool: null }];
  const out = [];
  let text = [];
  for (const part of turn.parts) {
    if (part.kind === 'tool') {
      out.push({ text: text.join('\n\n'), tool: part });
      text = [];
    } else if (part.text.trim()) text.push(part.text);
  }
  if (text.length) out.push({ text: text.join('\n\n'), tool: null });
  return out;
}

// Writes a transcript Claude Code can `--resume`: a uuid/parentUuid chain shaped like Claude Code's own,
// one content block per record, blocks of one API message sharing its id, and each tool_result in its own user record.
export function emitClaudeSession(session, { cwd = session.cwd, version = TESTED.claude.max, now = new Date(), toolOutput = 'none', toolRender = 'native', desktop = 'auto' } = {}) {
  if (!cwd) throw new Error('the source session has no working directory; pass --cwd');
  const sessionId = randomUUID();
  const shortId = String(session.sourceId).slice(0, 8);
  const base = { isSidechain: false, userType: 'external', cwd, sessionId, version, gitBranch: session.gitBranch ?? '' };
  const lost = toolRender === 'native' ? 'reasoning and images' : 'reasoning, images and native tool calls';
  const note = `_Transferred from ${session.sourceTool} session ${shortId} by agent-transfer; ${lost} did not carry over._`;
  const turns = session.turns
    .map((t) => ({ role: t.role, at: t.at, segments: segments(t, { toolOutput, toolRender }).filter((s) => s.tool || s.text.trim()) }))
    .filter((t) => t.segments.length);
  if (turns[0]?.role === 'user') turns[0].segments[0].text = `${note}\n\n${turns[0].segments[0].text}`;
  else turns.unshift({ role: 'user', at: null, segments: [{ text: note, tool: null }] });

  const records = [];
  let parentUuid = null;
  const push = (type, message, at, extra = {}) => {
    const uuid = randomUUID();
    const timestamp = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : now.toISOString();
    records.push({ parentUuid, ...base, type, message, uuid, timestamp, ...extra });
    parentUuid = uuid;
    return uuid;
  };
  const assistant = (id, block, stop) => ({ id, type: 'message', role: 'assistant', model: '<synthetic>', content: [block], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } });
  for (const { role, at, segments: segs } of turns) {
    if (role === 'user') {
      push('user', { role: 'user', content: segs[0].text }, at);
      continue;
    }
    for (const { text, tool } of segs) {
      const id = `msg_${hex()}`;
      const stop = tool ? 'tool_use' : 'end_turn';
      if (text.trim()) push('assistant', assistant(id, { type: 'text', text }, stop), at);
      if (!tool) continue;
      const toolUseId = `toolu_${hex().slice(0, 24)}`;
      const { name, input } = claudeToolUse(tool, session.sourceTool);
      const from = push('assistant', assistant(id, { type: 'tool_use', id: toolUseId, name, input }, stop), at);
      const content = claudeToolResult(tool, toolOutput);
      const bash = name === 'Bash' ? { toolUseResult: { stdout: content, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } } : {};
      push('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: tool.isError }] }, at, { ...bash, sourceToolAssistantUUID: from });
    }
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