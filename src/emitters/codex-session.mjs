import { emitHandoff } from './handoff.mjs';

// Codex 0.154 keeps threads in paginated sqlite stores next to the rollout files; writing those from outside
// is fragile across releases, so a Codex target always gets a handoff brief instead of a native thread.
export function emitCodexSession(session, options) {
  const plan = emitHandoff(session, { ...options, target: 'codex' });
  if (session.sourceTool === 'claude') {
    plan.notes = ["Codex has its own Claude Code importer (/import in the Codex TUI) that turns Claude sessions into resumable Codex threads; prefer it when you need the full thread rather than a brief."];
  }
  return plan;
}