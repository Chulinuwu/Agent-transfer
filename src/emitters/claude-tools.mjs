import { basename } from 'node:path';
import { TOOL_OUTPUT, cut } from './turn-text.mjs';

// Shell-running tools from other agents; their command replays as a Claude Bash call.
export const SHELL_TOOLS = new Set(['exec_command', 'shell', 'shell_command', 'local_shell', 'container.exec', 'unified_exec']);
const SHELLS = /^(?:(?:ba|z)?sh|pwsh|powershell)(?:\.exe)?$/i;

function commandOf(input) {
  const raw = input?.command ?? input?.cmd;
  if (typeof raw === 'string') return raw.trim() ? raw : null;
  if (!Array.isArray(raw) || !raw.length) return null;
  // Codex wraps scripts as ["bash", "-lc", "<script>"]; the script is the part a reader recognises.
  if (raw.length === 3 && SHELLS.test(basename(String(raw[0]))) && /^-(?:l?c|Command)$/i.test(raw[1])) return raw[2];
  return raw.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

// Claude Code resumes tool_use blocks whose name it does not have, so unmapped calls keep their own name,
// prefixed with the source tool so a later turn does not mistake them for a callable Claude tool.
export function claudeToolUse(part, sourceTool) {
  const command = SHELL_TOOLS.has(part.name) ? commandOf(part.input) : null;
  if (command) return { name: 'Bash', input: { command, description: `${part.name} from ${sourceTool}` } };
  const name = sourceTool === 'claude' ? part.name : `${sourceTool}_${part.name}`;
  const input = part.input && typeof part.input === 'object' && !Array.isArray(part.input) ? part.input : { input: part.input ?? '' };
  return { name: name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), input };
}

// Every tool_use needs a paired tool_result, so an omitted output still gets a one-line stand-in.
export function claudeToolResult(part, toolOutput) {
  if (part.output === null) return '(no result recorded)';
  const limit = TOOL_OUTPUT[toolOutput];
  if (!limit) return '(output not carried over)';
  return part.output ? cut(part.output, limit) : '(no output)';
}