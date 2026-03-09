# Todo App — Canonical ShipFlow Example

This is the single canonical example in the repo.

Its job is simple: prove that a locked verification pack can recreate a normal app after the implementation code is deleted.

The example shape is intentionally practical:

- browser UI at `/`
- REST API under `/api/todos`
- SQLite persistence in `./test.db`
- implementation context prefers `node:sqlite` over native SQLite addons
- ShipFlow is installed globally first, then used inside this example directory

The committed pack under `vp/` covers:

- UI add / complete / filter flows
- behavior-level API round-trip flow compiled through Cucumber
- REST API GET and POST contracts with todo shape assertions
- SQLite schema and data lifecycle
- technical stack consistency, REST protocol, and portable SQLite runtime constraints
- generated runners under `.gen/`

## Layout

```text
todo-app/
├── request.txt                  # Example greenfield request
├── shipflow.json                # ShipFlow config/context
├── package.json                 # Minimal runtime/test scripts
├── src/.gitkeep                 # Implementation starts empty
└── vp/
    ├── ui/*.yml
    ├── behavior/*.yml
    ├── api/*.yml
    ├── db/*.yml
    └── technical/*.yml
```

## What is committed here

This directory is committed as a ShipFlow project with a finalized pack:

- `vp/` is the source of truth
- `.gen/` shows the current generated runnable artifacts
- `src/` stays empty on purpose

The point is to let someone delete or keep `src/` empty and prove that `shipflow implement` can rebuild the app from the locked pack.

## Normal rebuild loop

From this directory:

```bash
npm install
shipflow implement
```

That runs the normal loop against the pack already committed in `vp/`.

To test the disposable-code claim explicitly:

```bash
rm -rf src
mkdir -p src
touch src/.gitkeep
shipflow implement
```

`shipflow` itself is installed globally first via the main project install flow. If you want native Claude/Codex/Gemini/Kiro integration in your own copy of this example, run `shipflow init` there instead of relying on machine-specific files from this repository.

From the repo root, the fastest path is:

```bash
./scripts/try-todo-example.sh
```

System requirements for the committed pack:

- `sqlite3`, or Node with `node:sqlite` support

## Real live Claude cycle

This example also includes a no-fake live harness that starts from a fresh temp project, installs ShipFlow into that project, runs `init -> draft -> review -> write -> implement`, and uses the real Claude CLI for implementation. The committed example directory stays clean; the live run happens in a temporary working copy:

```bash
npm run shipflow:claude-live
```

Useful flags:

```bash
npm run shipflow:claude-live -- --keep
npm run shipflow:claude-live -- --ai-draft
npm run shipflow:claude-live -- --model=<model-id>
```

Requirements for the live harness:

- `claude`
- `sqlite3`, or Node with `node:sqlite` support
- `npm`
- `npx`

`--ai-draft` is optional. Without it, the draft phase uses ShipFlow's local proposal engine and the real Claude CLI handles implementation.
