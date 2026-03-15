import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const tictactoeExampleDir = path.join(repoRoot, "examples", "tic-tac-toe-app");

function shouldCopyExample(src) {
  return !src.split(path.sep).includes(".gen");
}

export function createTempTicTacToeExampleProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-tictactoe-example-"));
  fs.cpSync(tictactoeExampleDir, tmpDir, {
    recursive: true,
    filter: shouldCopyExample,
  });
  return tmpDir;
}
