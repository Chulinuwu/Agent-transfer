# agent-transfer

Move work between AI coding agents. agent-transfer reads a session or configuration from one tool, turns it into a neutral intermediate representation (IR), and writes it out for another tool. Today it speaks Claude Code and Codex CLI, in both directions.

- Sessions: continue a Claude Code conversation in Codex, or a Codex thread in Claude Code.
- Configuration: `CLAUDE.md` <-> `AGENTS.md`, MCP servers (`~/.claude.json` / `.mcp.json` <-> `~/.codex/config.toml`), and skills folders.

It is plain Node.js with no dependencies. Nothing is written until you pass `--apply`.

## Usage

```
npx agent-transfer list    --from claude|codex [--cwd DIR] [--limit N] [--json]
npx agent-transfer session --from claude|codex --to claude|codex --id <id> [--last N] [--mode native|handoff]
                           [--tool-output none|short|full] [--tool-render native|text|hidden] [--desktop auto|off]
                           [--cwd DIR] [--out FILE] [--no-redact] [--json] [--apply]
npx agent-transfer config  --from claude|codex --to claude|codex [--what instructions,mcp,skills] [--cwd DIR]
                           [--include-secrets] [--force] [--apply]
```

Until it is published to npm, run `node bin/agent-transfer.mjs` from a clone. Requires Node.js 20.11 or later.

Typical flow:

```
agent-transfer list --from codex --limit 10
agent-transfer session --from codex --to claude --id 019f...        # preview: what carries, what is dropped
agent-transfer session --from codex --to claude --id 019f... --apply
cd <project> && claude --resume <new id>                           # printed by the command
```

- Session ids can be a unique prefix.
- `--last N` keeps the newest N turns (default 200); transcripts are also capped near 1 MB, and the preview says how many turns were trimmed.
- `--tool-render native|text|hidden` controls how tool calls appear in a Claude Code target (see [Tool calls in Claude Code](#tool-calls-in-claude-code)). Handoff briefs always use the compact text list.
- `--tool-output none|short|full` controls how much tool output is carried. In text form (handoff briefs and `--tool-render text`) the default `none` writes one line per call (`` - `exec_command`: <command, file or first input line> ``, marked `(failed)` on errors) grouped as a list under the assistant's text, with runs over 8 collapsed into `... and N more tool calls`. `short` adds the first 300 characters of each output in a fenced block; `full` adds the whole stored output (up to 2,000 characters).
- `--json` prints the IR instead of a plan, which is handy for debugging or feeding another tool.
- Every run prints what was dropped or approximated. Unknown record types are listed, not fatal. A source version outside the tested range prints a warning.

## How sessions move

| From -> To | Result | Fidelity |
|---|---|---|
| Codex -> Claude Code | Native Claude transcript in `~/.claude/projects/<encoded cwd>/<new uuid>.jsonl`, resumable with `claude --resume` | User and assistant text kept; tool calls replayed as Claude tool calls (shell commands as `Bash`), outputs with `--tool-output`; reasoning and images dropped |
| Claude Code -> Claude Code | Same as above: a fork of the session | Same as above; tool calls keep their original names and inputs |
| Claude Code -> Codex | Handoff brief plus a ready `codex "..."` / `codex exec "..."` command | Goal, latest state, open todos, files touched, last turns. For a full resumable thread, Codex's own `/import` is the higher-fidelity path |
| Codex -> Codex | Handoff brief | As above |

Why no native Codex sessions: Codex 0.154 keeps threads in paginated SQLite stores (`state_5.sqlite`, `thread_history_1.sqlite`) next to the rollout files. Writing those from outside is fragile and changes between releases, so agent-transfer writes a brief the new session reads instead. `--mode handoff` produces the same brief for a Claude target.

Where sessions are read from: Claude Code sessions come from `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`), which the CLI, the desktop app and wrappers such as Orca all share. Codex sessions come from `CODEX_HOME`, `~/.codex` and, when it exists, the separate Codex home that Orca keeps under its app data folder (`%APPDATA%\orca\codex-runtime-home\home` on Windows; set `ORCA_CODEX_HOME` to point elsewhere). A thread found in more than one home is listed once, from its largest copy.

### Tool calls in Claude Code

With `--tool-render native` (the default), each tool call becomes a real `tool_use` block in an assistant record, paired with a `tool_result` in the next user record, the same shape Claude Code writes itself. Claude Code and the desktop app then show them as tool calls rather than text.

| Source tool | Written as |
|---|---|
| Codex `exec_command`, `shell`, `shell_command`, `local_shell`, `container.exec`, `unified_exec` | `Bash` with `{ command, description }`; `["bash", "-lc", "<script>"]` becomes the script |
| Any other Codex tool (JS code-mode `exec`, `wait`, `apply_patch`, `update_plan`, MCP calls, ...) | Its own name with a `codex_` prefix and its original input (a string input is wrapped as `{ input }`) |
| Claude Code tools (Claude -> Claude) | Unchanged name and input |

Every `tool_use` gets exactly one `tool_result`. With `--tool-output none` that result is a one-line stand-in, `(output not carried over)`; `short` and `full` carry the first 300 characters or the whole stored output.

Before choosing this, resuming was tested with Claude Code 2.1.281 (`claude -p --resume`) on synthetic transcripts: both `Bash` calls and calls under a tool name Claude Code does not have were accepted and the model read them as earlier tool calls. That is why unmapped tools stay native under a prefixed name instead of falling back to text; the prefix keeps them from looking like a tool the new session can call. How the desktop app draws tool cards for names it does not know is up to the app.

`--tool-render text` writes the compact text list described under `--tool-output` (the previous behaviour). `--tool-render hidden` drops tool calls and leaves one italic line per run, such as `_(3 tool calls not shown)_`.

### Claude desktop app sidebar

The Claude desktop app lists only sessions it has its own record for, so a transcript written to `~/.claude/projects` opens with `claude --resume` but does not show up in the app's sidebar. With `--desktop auto` (the default), a Claude target also plans a small sidebar record next to the app's existing ones:

- The app data folder is `%APPDATA%\Claude` on Windows, `~/Library/Application Support/Claude` on macOS and `$XDG_CONFIG_HOME/Claude` (or `~/.config/Claude`) on Linux; set `CLAUDE_DESKTOP_DIR` to point elsewhere.
- Records live in `claude-code-sessions/<account>/<org>/local_<uuid>.json`. If several account/org folders have records, the one used most recently is picked and named in the output. If none exist, the step is skipped with a note.
- The new record points at the new Claude Code session and copies the model, effort and permission mode from the newest existing record. If that record does not look like the expected format, the step is skipped; the session still opens with `claude --resume`.
- Existing records are never changed or deleted. The record is shown in the preview and written only with `--apply`. Fully quit and reopen the desktop app to see the session.

This is best effort against an undocumented app format that may change in any release. `--desktop off` skips it.

Handoff briefs are saved to `~/.agent-transfer/handoffs/<tool>-<id>.md` (or `--out`).

## How configuration moves

| Item | Claude Code | Codex | Notes |
|---|---|---|---|
| Instructions | `~/.claude/CLAUDE.md`, `<project>/CLAUDE.md` | `~/.codex/AGENTS.md`, `<project>/AGENTS.md` | Copied as text. `@imports` in CLAUDE.md are not resolved. An existing, different target is shown as a diff and skipped unless `--force` (a backup is kept) |
| MCP servers | `~/.claude.json` and `~/.claude/settings.json` (user), `<project>/.mcp.json` (project) | `[mcp_servers.*]` in `~/.codex/config.toml` | stdio and streamable HTTP map both ways. Codex has no SSE transport and no project scope; those are approximated and noted. Fields with no counterpart (timeouts, OAuth blocks, tool filters) are listed as not carried. Servers that already exist in the target are skipped. Disabled servers are not transferred |
| Skills | `~/.claude/skills/*`, `<project>/.claude/skills/*` | `~/.codex/skills/*` | `SKILL.md` folders are the same format and are copied; existing folders are skipped unless `--force` |

Claude Code writes `~/.claude.json` itself while it runs. Quit running Claude Code sessions before applying a config change that targets it.

## What cannot move

- Reasoning: Claude thinking blocks are signed and Codex reasoning is encrypted; neither is portable. They are counted, not copied.
- Native tool call ids and exact schemas: calls are replayed with new ids, shell commands as `Bash` and other tools under a prefixed name. Outputs are left out unless `--tool-output` asks for them, and are truncated to 2,000 characters either way. Codex targets get tool calls as text in the brief.
- Images, attachments, file-history snapshots and hook output.
- Model, permission and sandbox profiles, token and cost accounting.
- Subagent transcripts (Claude sidechains). Codex inter-agent messages are kept as text; their encrypted parts are dropped.
- Codex threads that exist only in SQLite without a rollout file.
- Claude project folders for working directories longer than 200 characters (Claude hashes those names in an undocumented way; the tool refuses rather than guesses).

## Privacy

- Everything runs locally; nothing is sent anywhere.
- Redaction is on by default for transcripts: private key blocks, common API key prefixes (`sk-`, `ghp_`, `xox*-`, `AKIA...`, and similar), JWTs, bearer tokens and `SECRET=value`-style assignments are replaced with `[REDACTED]` before anything is written or printed. `--no-redact` turns it off. It is pattern based, so review a brief before sharing it.
- MCP env and header values are never copied by default. The preview lists the withheld keys, and the target config references environment variables instead (`${VAR}` for Claude Code, `env_vars`, `env_http_headers` and `bearer_token_env_var` for Codex). `--include-secrets` copies literal values.
- Diffs in previews are masked the same way.

## The IR

Version 1. Sessions:

```
{ ir: 1, kind: 'session', sourceTool, sourceVersion, sourceId, cwd, gitBranch, title, startedAt,
  turns: [{ role: 'user' | 'assistant', at,
            parts: [{ kind: 'text', text }
                  | { kind: 'tool', name, summary, input, output, isError }] }],
  dropped: { thinking, images, attachments, injectedContext, metaMessages, encryptedParts,
             badLines, truncatedOutputs, trimmedTurns, unknownRecordTypes: [] } }
```

Configuration:

```
{ ir: 1, kind: 'config', sourceTool,
  instructions: [{ scope: 'user' | 'project', path, text }],
  mcpServers: [{ name, scope, transport: 'stdio' | 'http' | 'sse', command, args, url,
                 env: [{ key, ref? | bearerRef? | value? | withheld? }], headers: [...same],
                 disabled, droppedFields: [] }],
  skills: [{ name, scope, path }], notes: [] }
```

`ref` is an environment variable reference (not a secret, always carried). `value` is present only with `--include-secrets`; otherwise a literal becomes `withheld: true`.

Adding a tool means one parser and one emitter; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Tested versions

Claude Code 2.1.209 to 2.1.281 and Codex CLI 0.144 to 0.155 (the transcripts available when this was written). Other versions work if their formats have not changed; the tool warns when it sees one outside this range.

## Related projects

Other open-source tools tackle parts of this:

- casr: Rust, IR-based session conversion with native resume, installed via a shell script.
- cli-continues: generates a Markdown context document to continue work across many agents.
- sessport and codex2claude: session portability between specific tools.

What agent-transfer does differently: it is pure Node (runs with `npx`, no install step or binary), it compiles configuration both ways (instructions, MCP servers, skills) and not only sessions, it writes native Claude Code sessions where that is safe and a handoff brief where native writing is not (Codex's paginated SQLite store), it redacts by default, and it always previews before writing.

## License

MIT