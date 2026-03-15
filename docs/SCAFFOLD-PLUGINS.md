# Scaffold Plugins

Scaffold plugins let ShipFlow install a deterministic project foundation from a packaged artifact instead of forcing the LLM to rebuild the same setup from scratch.

For ShipFlow, a startup foundation is not only code. A `startup` plugin is also where the archetype's base verification files come from. If the foundation implies a root shell, a protocol surface, a runtime contract, architecture rules, or baseline security headers, those truths should ship in the plugin under `vp/` and become part of the locked pack immediately.

Use them when:
- a built-in preset does not cover your stack
- your team already has a repeatable startup foundation
- you want reusable additive slices such as an API, database, mobile shell, or TUI layer

ShipFlow supports two plugin classes:
- `startup`: a foundation for a greenfield repo only
- `component`: an additive slice that can be layered into an existing repo

## Why Contribute Plugins

The fastest way to improve ShipFlow for a new stack is usually to contribute a scaffold plugin, not another prompt rule.

A good scaffold plugin:
- removes fragile setup work from the LLM
- gives the implementation loop a stable base
- encodes the stack choices your team already trusts
- makes greenfield runs faster and less error-prone for everyone

## Archive Format

ShipFlow installs scaffold plugins from `.zip` archives:

```text
my-plugin.zip
├── shipflow-scaffold-plugin.json
├── template/
│   ├── vp/
│   │   ├── technical/...
│   │   └── ui/...
│   ├── package.json
│   └── src/...
└── install.mjs
```

Required pieces:
- `shipflow-scaffold-plugin.json`
- `template/`

Optional pieces:
- `install.mjs` or another install script referenced by the manifest

Additional rule for `startup` plugins:
- `template/vp/` is required and must contain the archetype's base verification files

During installation, ShipFlow extracts the archive into `.shipflow/scaffold-plugins/<plugin-id>/`.

## Manifest

The manifest filename is fixed:

```text
shipflow-scaffold-plugin.json
```

Minimal example:

```json
{
  "schema_version": 1,
  "id": "vue-antdv-admin-foundation",
  "name": "Vue AntDV Admin Foundation",
  "version": "1.0.0",
  "plugin_type": "startup",
  "description": "Vue 3 + Ant Design Vue admin foundation with a Node GraphQL backend.",
  "llm": {
    "summary": "A Vue 3 + Ant Design Vue admin foundation and a Node GraphQL entrypoint are already installed.",
    "guidance": [
      "Extend the installed frontend and backend foundation instead of replacing the stack.",
      "Reuse the existing design-system setup and package scripts."
    ]
  },
  "capabilities": {
    "app_shapes": ["fullstack-web-stateful"],
    "adds": ["ui:web", "ui:vue", "api:graphql", "db:sqlite"]
  },
  "apply": {
    "template_dir": "template",
    "merge_package_json": true
  },
  "install": {
    "script": "install.mjs"
  }
}
```

Required fields:
- `schema_version`
- `id`
- `name`
- `version`
- `plugin_type`
- `description`
- `llm.summary`
- `llm.guidance`

`plugin_type` must be one of:
- `startup`
- `component`

For `component` plugins, `component_kinds` is also required.

Allowed `component_kinds`:
- `api`
- `service`
- `database`
- `ui`
- `mobile`
- `tui`
- `worker`
- `integration`
- `other`

## Template Payload

The template directory is copied into the target repo before the optional install script runs.

Rules:
- `package.json` is merged instead of blindly overwritten
- other files are created unless they already exist
- `--force` allows supported overwrites

Use the template to provide the stable foundation the LLM should extend:
- scripts
- base dependencies
- initial source layout
- entrypoints
- shell UI or API files
- base verification files for the archetype when `plugin_type` is `startup`

Those base verification files should cover what is universally true for the foundation itself. Typical examples:
- root shell or health surface exists
- expected protocol surface is live
- runtime and package-manager assumptions are pinned
- baseline architecture boundaries are enforced
- baseline security posture is asserted

Do not move those truths into an out-of-band benchmark script. If the archetype promises them, the plugin should install them into `vp/`.

## Install Script Contract

The install script is optional, but useful when the scaffold needs to do repo-local setup after the files land.

Examples:
- write a local config file
- patch a generated path
- create a marker file
- perform deterministic repo wiring

ShipFlow runs the install script inside the target repo with these environment variables:
- `SHIPFLOW_SCAFFOLD_PLUGIN_ID`
- `SHIPFLOW_SCAFFOLD_PLUGIN_TYPE`
- `SHIPFLOW_SCAFFOLD_PLUGIN_DIR`
- `SHIPFLOW_SCAFFOLD_MANIFEST`
- `SHIPFLOW_SCAFFOLD_TARGET_DIR`

The script should:
- be deterministic
- stay inside the target repo
- avoid network-dependent setup when possible
- print short high-level log lines only

If the script exits non-zero, the scaffold apply fails.

## Startup vs Component

Use a `startup` plugin when you are defining the initial foundation of a project:
- framework
- package manager shape
- root scripts
- base UI or API shell
- standard directory layout
- the base verification boundary that makes this foundation meaningful

Use a `component` plugin when you are adding a deterministic slice to an existing repo:
- GraphQL API
- REST API
- SQLite layer
- mobile shell
- TUI shell
- worker subsystem

`startup` plugins only run on greenfield repos.

They must be self-describing in two ways:
- code/template foundation
- base verification files under `vp/`

That keeps the acceptance boundary inside ShipFlow's normal pack workflow instead of hiding it in a custom harness.

`component` plugins can be applied on top of an existing foundation and can be combined:

```bash
shipflow scaffold --component=graphql-api --component=sqlite-db
```

## Using Plugins In A Repo

Install plugins into the current repo:

```bash
shipflow scaffold-plugin install ./my-foundation.zip
shipflow scaffold-plugin install ./sqlite-component.zip
shipflow scaffold-plugin list
```

Apply them directly:

```bash
shipflow scaffold --plugin=my-foundation
shipflow scaffold --component=sqlite-component
```

Or declare them in `shipflow.json`:

```json
{
  "impl": {
    "scaffold": {
      "enabled": true,
      "plugin": "my-foundation",
      "components": ["sqlite-component"]
    }
  }
}
```

When ShipFlow applies a plugin, it records the result in:

```text
.shipflow/scaffold-state.json
```

That state is fed back into the implementation prompt so the orchestrator and specialists extend the installed foundation instead of rebuilding it.

## Contribution Guidelines

If you want your plugin to be broadly useful, optimize for determinism first.

Good contribution patterns:
- package a startup foundation for a mainstream stack
- package one narrow component per concern
- write `llm.summary` and `llm.guidance` as extension instructions, not marketing copy
- keep install scripts short and deterministic
- prefer stable, popular open-source libraries over custom one-off wiring
- include the archetype's base `vp/` files directly in every `startup` plugin

Avoid:
- giant kitchen-sink plugins
- plugins that depend on interactive setup
- network-heavy install scripts
- vague guidance that forces the LLM to rediscover the stack
- hidden acceptance logic outside `vp/`

If you want a scaffold to become an official built-in preset, contribute the proven plugin first. Once the shape is stable and broadly useful, it can graduate from plugin to preset.
