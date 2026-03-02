#!/usr/bin/env node
import { gen } from "../lib/gen.js";
import { verify } from "../lib/verify.js";

const cmd = process.argv[2];

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(`ShipFlow v1
Usage:
  shipflow gen
  shipflow verify
`);
    process.exit(0);
  }

  if (cmd === "gen") {
    await gen({ cwd: process.cwd() });
    return;
  }
  if (cmd === "verify") {
    const code = await verify({ cwd: process.cwd() });
    process.exit(code);
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
