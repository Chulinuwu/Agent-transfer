export const TOOL_OUTPUT = { none: 0, short: 300, full: Infinity };
const SUMMARY_LIMIT = 120;
const MAX_TOOLS = 8;

const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}...` : s);

// A fence longer than any backtick run inside the output keeps it from closing the block early.
function fenced(text) {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return [fence, ...text.split('\n'), fence].map((l) => `  ${l}`).join('\n');
}

function renderTool(part, toolOutput) {
  const line = `- \`${part.name}\`: ${cut(part.summary, SUMMARY_LIMIT)}${part.isError ? ' (failed)' : ''}`;
  const limit = TOOL_OUTPUT[toolOutput];
  return limit && part.output ? `${line}\n${fenced(cut(part.output, limit))}` : line;
}

function renderTools(parts, toolOutput) {
  const lines = parts.slice(0, MAX_TOOLS).map((p) => renderTool(p, toolOutput));
  if (parts.length > MAX_TOOLS) lines.push(`- ... and ${parts.length - MAX_TOOLS} more tool calls`);
  return lines.join('\n');
}

// Prose stays verbatim; each run of consecutive tool calls becomes one compact list below the text before it.
export function renderTurn(turn, { toolOutput = 'none' } = {}) {
  const blocks = [];
  let run = [];
  const flush = () => {
    if (run.length) blocks.push(renderTools(run, toolOutput));
    run = [];
  };
  for (const part of turn.parts) {
    if (part.kind === 'tool') run.push(part);
    else if (part.text.trim()) {
      flush();
      blocks.push(part.text);
    }
  }
  flush();
  return blocks.join('\n\n');
}