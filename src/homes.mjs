import { homedir } from 'node:os';
import { join } from 'node:path';

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const claudeJson = () => process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const handoffDir = () => join(homedir(), '.agent-transfer', 'handoffs');

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

export const claudeDesktopDir = () => process.env.CLAUDE_DESKTOP_DIR || join(appDataDir(), 'Claude');

// Orca runs Codex with its own CODEX_HOME, so threads started inside Orca never reach ~/.codex.
export const orcaCodexHome = () => process.env.ORCA_CODEX_HOME || join(appDataDir(), 'orca', 'codex-runtime-home', 'home');

export const codexSessionHomes = () => [...new Set([codexHome(), join(homedir(), '.codex'), orcaCodexHome()])];

// Claude Code names a project folder after its cwd with every non-alphanumeric character turned into '-'
// (C:\Users\me\my_app -> C--Users-me-my-app). Paths over 200 characters get a hashed suffix whose
// algorithm is not documented, so those are refused rather than guessed.
export function claudeProjectDir(cwd) {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length > 200) throw new Error(`cwd is too long to map to a Claude project folder: ${cwd}`);
  return join(claudeHome(), 'projects', name);
}