#!/usr/bin/env node
import { gen } from "../lib/gen.js";
import { verify } from "../lib/verify.js";

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith("-"));
const cmd = positional[0];
const input = positional.slice(1).join(" ").trim();
const flags = new Set(args.filter(a => a.startsWith("-")));
const optionValue = (name) => {
  const prefix = `--${name}=`;
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};
const optionValues = (name) => {
  const prefix = `--${name}=`;
  return args
    .filter(a => a.startsWith(prefix))
    .flatMap(arg => arg.slice(prefix.length).split(","))
    .map(value => value.trim())
    .filter(Boolean);
};
const verbose = flags.has("--verbose") || flags.has("-v");
const quiet = flags.has("--quiet") || flags.has("-q");

async function main() {
  if (!cmd || cmd === "help" || flags.has("--help") || flags.has("-h")) {
    console.log(`ShipFlow v1
Standard flow:
  shipflow draft [description] Draft and finalize the verification pack
  shipflow implement           Standard loop: validate pack, generate tests, implement, verify

Advanced / debug:
  shipflow map [description]   Review repo surfaces and coverage gaps before drafting
  shipflow lint                Lint verification quality before generation
  shipflow doctor              Check local tools, runners, and AI CLI adapters
  shipflow gen                 Generate runnable tests from the verification pack
  shipflow approve-visual      Capture or refresh locked UI visual baselines
  shipflow scaffold            Apply a deterministic project foundation for supported stacks
  shipflow scaffold-plugin     Install or list scaffold plugins packaged as zip archives
  shipflow verify              Run generated tests and write evidence
  shipflow status              Show pack, generated tests, and evidence
  shipflow implement-once      Single implementation pass without the retry loop
  shipflow run                 Legacy alias for shipflow implement

Setup:
  shipflow init [--claude|--codex|--gemini|--kiro|--all]
                               Set up shared files plus active or detected platform config

Flags:
  --verbose, -v        Show detailed output
  --quiet, -q          Minimal output
  --json               Machine-readable output for map/lint/status/draft
  --write              Write selected draft proposals to vp/ (for shipflow draft)
  --ai                 Ask the configured draft provider to refine draft proposals
  --accept=<path>      Mark a draft proposal as accepted
  --reject=<path>      Mark a draft proposal as rejected
  --pending=<path>     Reset a draft proposal back to pending
  --clear-session      Remove the saved draft session before continuing
  --update-existing    Allow accepted draft proposals to replace existing vp files
  --provider=<name>    Override provider for shipflow draft/implement
  --model=<id>         Override model for shipflow draft/implement
  --preset=<id>        Override the built-in startup scaffold preset
  --plugin=<id>        Override the startup scaffold plugin to apply
  --component=<id>     Add one or more component scaffold plugins
  --force              Allow scaffold/application overwrite where supported

Exit codes:
  0    Success (all tests pass)
  1    Test failure or runtime error
  2    Usage error (unknown command)
  3    Policy violation
`);
    process.exit(0);
  }

  if (cmd === "gen") {
    await gen({ cwd: process.cwd() });
    return;
  }

  if (cmd === "verify") {
    const { exitCode } = await verify({ cwd: process.cwd(), verbose });
    process.exit(exitCode);
  }

  if (cmd === "approve-visual") {
    const { approveVisual } = await import("../lib/approve-visual.js");
    const { exitCode } = await approveVisual({ cwd: process.cwd(), input });
    process.exit(exitCode);
  }

  if (cmd === "scaffold") {
    const { scaffold } = await import("../lib/scaffold.js");
    const componentFlags = optionValues("component");
    const { exitCode } = scaffold({
      cwd: process.cwd(),
      force: flags.has("--force"),
      preset: optionValue("preset"),
      plugin: optionValue("plugin"),
      components: componentFlags.length > 0 ? componentFlags : undefined,
    });
    process.exit(exitCode);
  }

  if (cmd === "scaffold-plugin") {
    const { scaffoldPlugin } = await import("../lib/scaffold.js");
    const { exitCode } = scaffoldPlugin({ cwd: process.cwd(), input });
    process.exit(exitCode);
  }

  if (cmd === "implement-once") {
    const { impl } = await import("../lib/impl.js");
    await impl({ cwd: process.cwd(), provider: optionValue("provider"), model: optionValue("model") });
    return;
  }

  if (cmd === "implement" || cmd === "run") {
    const { run } = await import("../lib/loop.js");
    const code = await run({ cwd: process.cwd(), provider: optionValue("provider"), model: optionValue("model") });
    process.exit(code);
  }

  if (cmd === "map") {
    const { map } = await import("../lib/map.js");
    const { exitCode } = map({ cwd: process.cwd(), input, json: flags.has("--json") });
    process.exit(exitCode);
  }

  if (cmd === "draft") {
    const { draft } = await import("../lib/draft.js");
    const { exitCode } = await draft({
      cwd: process.cwd(),
      input,
      json: flags.has("--json"),
      write: flags.has("--write"),
      ai: flags.has("--ai"),
      accept: optionValues("accept"),
      reject: optionValues("reject"),
      pending: optionValues("pending"),
      clearSession: flags.has("--clear-session"),
      updateExisting: flags.has("--update-existing"),
      provider: optionValue("provider"),
      model: optionValue("model"),
    });
    process.exit(exitCode);
  }

  if (cmd === "lint") {
    const { lint } = await import("../lib/lint.js");
    const { exitCode } = lint({ cwd: process.cwd(), json: flags.has("--json") });
    process.exit(exitCode);
  }

  if (cmd === "doctor") {
    const { doctor } = await import("../lib/doctor.js");
    const { exitCode } = doctor({ cwd: process.cwd(), json: flags.has("--json") });
    process.exit(exitCode);
  }

  if (cmd === "init") {
    const { init, recommendedPlatforms } = await import("../lib/init.js");
    const platforms = [];
    if (flags.has("--all")) platforms.push("claude", "codex", "gemini", "kiro");
    if (flags.has("--claude")) platforms.push("claude");
    if (flags.has("--codex")) platforms.push("codex");
    if (flags.has("--gemini")) platforms.push("gemini");
    if (flags.has("--kiro")) platforms.push("kiro");
    if (platforms.length === 0) platforms.push(...recommendedPlatforms(process.cwd()));
    init({ cwd: process.cwd(), platforms: [...new Set(platforms)] });
    return;
  }

  if (cmd === "status") {
    const { status } = await import("../lib/status.js");
    const { exitCode } = status({ cwd: process.cwd(), json: flags.has("--json") });
    process.exit(exitCode);
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  if (!quiet) console.error(err?.stack || String(err));
  process.exit(1);
});
