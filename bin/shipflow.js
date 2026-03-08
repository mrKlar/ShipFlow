#!/usr/bin/env node
import { gen } from "../lib/gen.js";
import { verify } from "../lib/verify.js";

const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith("-"));
const flags = new Set(args.filter(a => a.startsWith("-")));
const verbose = flags.has("--verbose") || flags.has("-v");
const quiet = flags.has("--quiet") || flags.has("-q");

async function main() {
  if (!cmd || cmd === "help" || flags.has("--help") || flags.has("-h")) {
    console.log(`ShipFlow v1
Usage:
  shipflow gen         Compile VP verifications into runnable tests
  shipflow verify      Run generated tests, produce evidence
  shipflow impl        AI generates app code from VP + tests
  shipflow run         Full loop: gen → impl → verify (repeat until green)
  shipflow init        Scaffold vp/ directories + platform config
    --claude             Setup for Claude Code (default)
    --codex              Setup for OpenAI Codex CLI
    --gemini             Setup for Google Gemini CLI
  shipflow status      Show verification state (VP, generated, evidence)

Flags:
  --verbose, -v        Show detailed output
  --quiet, -q          Minimal output

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

  if (cmd === "impl") {
    const { impl } = await import("../lib/impl.js");
    await impl({ cwd: process.cwd() });
    return;
  }

  if (cmd === "run") {
    const { run } = await import("../lib/loop.js");
    const code = await run({ cwd: process.cwd() });
    process.exit(code);
  }

  if (cmd === "init") {
    const { init } = await import("../lib/init.js");
    const platforms = [];
    if (flags.has("--claude")) platforms.push("claude");
    if (flags.has("--codex")) platforms.push("codex");
    if (flags.has("--gemini")) platforms.push("gemini");
    if (platforms.length === 0) platforms.push("claude");
    init({ cwd: process.cwd(), platforms });
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
