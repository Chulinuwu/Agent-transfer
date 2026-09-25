# Contributing

Run the tests with `npm test` (or `node --test test/<file>.test.mjs` one file at a time). Tests build their own synthetic fixtures in a temporary home; never commit a real transcript, config file or anything copied from your own `~/.claude` or `~/.codex`.

## Adding a tool

agent-transfer is a small compiler: parsers read a tool's native files into the intermediate representation (IR), emitters write the IR out in another tool's format. A new tool is one parser and one emitter per concern, plus one registry entry:

1. `src/parsers/<tool>-session.mjs`: `list<Tool>Sessions({ cwd })`, `find<Tool>Session(id)` and `parse<Tool>Session(file)` returning a session IR (`src/ir/session.mjs`). Anything the IR cannot hold goes into `dropped` as a count; record types you do not recognize go into `dropped.unknownRecordTypes` instead of throwing.
2. `src/parsers/<tool>-config.mjs`: `parse<Tool>Config({ cwd, includeSecrets })` returning a config IR (`src/ir/config.mjs`). Build env and header entries with `secretField` so literal values stay out of the IR unless the user opted in.
3. `src/emitters/<tool>-session.mjs` and `src/emitters/<tool>-config.mjs`: return `{ actions, notes }`. Actions are plans (`write`, `copy`, `skip`, `run`), never side effects; `src/cli/apply.mjs` executes them only under `--apply`. Use `writeAction` and `copyAction` from `src/emitters/plan.mjs` so existing files are diffed and never overwritten without `--force`. If writing a native session is unsafe for the tool, emit a handoff with `emitHandoff`.
4. Register the tool in `src/tools.mjs` and add its tested version range to `src/versions.mjs`.
5. Add a `test/<tool>-*.test.mjs` with synthetic fixtures: parse to IR (including tool calls and an unknown record type), emit, and a dry run that writes nothing.