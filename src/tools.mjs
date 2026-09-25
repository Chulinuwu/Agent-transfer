import { emitClaudeConfig } from './emitters/claude-config.mjs';
import { emitClaudeSession } from './emitters/claude-session.mjs';
import { emitCodexConfig } from './emitters/codex-config.mjs';
import { emitCodexSession } from './emitters/codex-session.mjs';
import { parseClaudeConfig } from './parsers/claude-config.mjs';
import { findClaudeSession, listClaudeSessions, parseClaudeSession } from './parsers/claude-session.mjs';
import { parseCodexConfig } from './parsers/codex-config.mjs';
import { findCodexSession, listCodexSessions, parseCodexSession } from './parsers/codex-session.mjs';

// Adding a tool means one entry here: its session/config parsers into the IR and its emitters out of it.
export const TOOLS = {
  claude: {
    listSessions: listClaudeSessions,
    findSession: findClaudeSession,
    parseSession: parseClaudeSession,
    parseConfig: parseClaudeConfig,
    emitSession: emitClaudeSession,
    emitConfig: emitClaudeConfig,
  },
  codex: {
    listSessions: listCodexSessions,
    findSession: findCodexSession,
    parseSession: parseCodexSession,
    parseConfig: parseCodexConfig,
    emitSession: emitCodexSession,
    emitConfig: emitCodexConfig,
  },
};