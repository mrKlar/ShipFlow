import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const movieCommentsExampleDir = path.join(repoRoot, "examples", "movie-comments-app");

function shouldCopyExample(src) {
  return !src.split(path.sep).includes(".gen");
}

export function createTempMovieCommentsExampleProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-movie-comments-example-"));
  fs.cpSync(movieCommentsExampleDir, tmpDir, {
    recursive: true,
    filter: shouldCopyExample,
  });
  return tmpDir;
}
