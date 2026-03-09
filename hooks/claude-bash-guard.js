#!/usr/bin/env node
// ShipFlow Claude Bash guard — blocks Bash detours that inspect ShipFlow itself
// instead of using `shipflow draft`, `shipflow lint`, and `shipflow gen`.

import { readFileSync } from "node:fs";
import {
  extractCommandFromHook,
  INTROSPECTION_BLOCK_MESSAGE,
  shouldBlockShipflowIntrospection,
} from "./introspection-common.js";

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return null;
  }
}

const input = readHookInput();
if (!input) process.exit(0);

const command = extractCommandFromHook(input);
if (!shouldBlockShipflowIntrospection(command)) process.exit(0);

process.stderr.write(INTROSPECTION_BLOCK_MESSAGE);
process.exit(2);
