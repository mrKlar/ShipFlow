#!/usr/bin/env node
import { gen } from "../lib/gen.js";
import { verify } from "../lib/verify.js";

const cmd = process.argv[2];

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(`ShipFlow v1
Usage:
  shipflow gen       Compile VP specs into runnable tests
  shipflow verify    Run generated tests, produce evidence
  shipflow impl      AI generates app code from VP + tests
  shipflow run       Full loop: gen → impl → verify (repeat until green)
`);
    process.exit(0);
  }

  if (cmd === "gen") {
    await gen({ cwd: process.cwd() });
    return;
  }

  if (cmd === "verify") {
    const { exitCode } = await verify({ cwd: process.cwd() });
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

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
