#!/usr/bin/env node
import { gen } from "../lib/gen.js";
import { verify } from "../lib/verify.js";

const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith("-"));
const flags = new Set(args.filter(a => a.startsWith("-")));
const optionValue = (name) => {
  const prefix = `--${name}=`;
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};
const verbose = flags.has("--verbose") || flags.has("-v");
const quiet = flags.has("--quiet") || flags.has("-q");

async function main() {
  if (!cmd || cmd === "help" || flags.has("--help") || flags.has("-h")) {
    console.log(`ShipFlow v1
Usage:
  Standard flow:
    shipflow draft         Human + AI draft and refine the verification pack
    shipflow implement     Standard loop: validate pack, generate tests, implement, verify

  Advanced / debug:
    shipflow map           Review repo surfaces and coverage gaps before drafting
    shipflow lint          Lint verification quality before generation
    shipflow doctor        Check local tools, runners, and AI CLI adapters
    shipflow gen           Generate runnable tests from the verification pack
    shipflow verify        Run generated tests and write evidence
    shipflow status        Show pack, generated tests, and evidence
    shipflow implement-once  Single implementation pass without the retry loop
    shipflow run           Legacy alias for shipflow implement

  Setup:
  shipflow init        Set up verification directories + platform config
    --claude             Setup for Claude Code (default)
    --codex              Setup for OpenAI Codex CLI
    --gemini             Setup for Google Gemini CLI
    --all                Setup for all supported platforms

Flags:
  --verbose, -v        Show detailed output
  --quiet, -q          Minimal output
  --json               Machine-readable output for map/lint
  --write              Write draft starter files to vp/ (for shipflow draft)
  --ai                 Ask the configured draft provider to refine draft proposals
  --provider=<name>    Override provider for shipflow draft/implement
  --model=<id>         Override model for shipflow draft/implement

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

  if (cmd === "implement-once" || cmd === "impl-once") {
    const { impl } = await import("../lib/impl.js");
    await impl({ cwd: process.cwd(), provider: optionValue("provider"), model: optionValue("model") });
    return;
  }

  if (cmd === "implement" || cmd === "impl" || cmd === "run") {
    const { run } = await import("../lib/loop.js");
    const code = await run({ cwd: process.cwd(), provider: optionValue("provider"), model: optionValue("model") });
    process.exit(code);
  }

  if (cmd === "map") {
    const { map } = await import("../lib/map.js");
    const { exitCode } = map({ cwd: process.cwd(), json: flags.has("--json") });
    process.exit(exitCode);
  }

  if (cmd === "draft") {
    const { draft } = await import("../lib/draft.js");
    const { exitCode } = await draft({
      cwd: process.cwd(),
      json: flags.has("--json"),
      write: flags.has("--write"),
      ai: flags.has("--ai"),
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
    const { init } = await import("../lib/init.js");
    const platforms = [];
    if (flags.has("--all")) platforms.push("claude", "codex", "gemini", "kiro");
    if (flags.has("--claude")) platforms.push("claude");
    if (flags.has("--codex")) platforms.push("codex");
    if (flags.has("--gemini")) platforms.push("gemini");
    if (flags.has("--kiro")) platforms.push("kiro");
    if (platforms.length === 0) platforms.push("claude");
    init({ cwd: process.cwd(), platforms: [...new Set(platforms)] });
    return;
  }

  if (cmd === "status") {
    const { status } = await import("../lib/status.js");
    status({ cwd: process.cwd() });
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  if (!quiet) console.error(err?.stack || String(err));
  process.exit(1);
});
