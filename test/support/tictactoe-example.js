import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

function spawnTicTacToeDevServer(cwd, port) {
  const child = spawn("npm", ["run", "dev"], {
    cwd,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      PATH: [path.dirname(process.execPath), process.env.PATH || ""].filter(Boolean).join(path.delimiter),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  child.stdout.on("data", chunk => logs.push(String(chunk)));
  child.stderr.on("data", chunk => logs.push(String(chunk)));

  return {
    child,
    logs,
    async stop() {
      if (child.exitCode !== null) return;
      const processGroupId = child.pid;
      try {
        if (processGroupId) process.kill(-processGroupId, "SIGTERM");
        else child.kill("SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (child.exitCode !== null) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try {
        if (processGroupId) process.kill(-processGroupId, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    },
  };
}

export function resolveTicTacToeDevPort(cwd, requestedPort) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) return requestedPort;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const devScript = String(pkg?.scripts?.dev || "");
    const match = devScript.match(/(?:^|\s)PORT=(\d+)(?:\s|$)/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  } catch {}
  return requestedPort;
}

async function urlResponds(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttpOk(url, child, logs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited early while waiting for ${url}\n${logs.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}\n${logs.join("")}`);
}

async function waitForHttpGone(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await urlResponds(url)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for previous dev server to stop at ${url}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

async function postGraphql(baseUrl, query) {
  return await fetchJson(`${baseUrl}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
}

function readScoreRows(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare("SELECT winner, move_count FROM score_history ORDER BY game_id").all()
      .map(row => ({
        winner: String(row.winner),
        move_count: Number(row.move_count),
      }));
  } finally {
    db.close();
  }
}

export function resetTicTacToeRuntimeState(cwd) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = path.join(cwd, `test.db${suffix}`);
    fs.rmSync(target, { force: true });
  }
}

export async function assertTicTacToeAppRuntimeQuality(cwd, { port } = {}) {
  assert.ok(Number.isInteger(port) && port > 0, "runtime quality checks require a concrete port");
  const runtimePort = resolveTicTacToeDevPort(cwd, port);
  const baseUrl = `http://127.0.0.1:${runtimePort}`;
  await waitForHttpGone(baseUrl);
  resetTicTacToeRuntimeState(cwd);

  const server = spawnTicTacToeDevServer(cwd, runtimePort);
  try {
    const home = await waitForHttpOk(`${baseUrl}/`, server.child, server.logs);
    const homeHtml = await home.text();
    assert.match(homeHtml, /board-cell-0/i, "runtime app should render a tic-tac-toe board");
    assert.match(homeHtml, /score/i, "runtime app should render score history text");

    const recorded = await postGraphql(
      baseUrl,
      `mutation RecordCompletedGame {
        recordCompletedGame(winner: "X", moves: [0, 3, 1, 4, 2]) {
          gameId
          winner
          moveCount
        }
      }`,
    );
    assert.equal(recorded.status, 200);
    assert.ok(!recorded.body.errors, "recordCompletedGame should not return GraphQL errors");
    assert.equal(recorded.body.data.recordCompletedGame.winner, "X");
    assert.equal(recorded.body.data.recordCompletedGame.moveCount, 5);

    const scoreHistory = await postGraphql(
      baseUrl,
      `query ScoreHistory {
        scoreHistory {
          gameId
          winner
          moveCount
        }
      }`,
    );
    assert.equal(scoreHistory.status, 200);
    assert.ok(!scoreHistory.body.errors, "scoreHistory should not return GraphQL errors");
    assert.ok(
      Array.isArray(scoreHistory.body.data.scoreHistory)
      && scoreHistory.body.data.scoreHistory.some(entry => entry.winner === "X" && entry.moveCount === 5),
      "runtime app should expose the recorded completed game through GraphQL",
    );
  } finally {
    await server.stop();
  }

  const dbPath = path.join(cwd, "test.db");
  assert.ok(fs.existsSync(dbPath), "runtime app should persist score history to test.db");
  assert.deepEqual(readScoreRows(dbPath), [
    { winner: "X", move_count: 5 },
  ]);

  const restarted = spawnTicTacToeDevServer(cwd, port);
  try {
    await waitForHttpOk(`${baseUrl}/`, restarted.child, restarted.logs);
    const scoreHistory = await postGraphql(
      baseUrl,
      `query ScoreHistory {
        scoreHistory {
          winner
          moveCount
        }
      }`,
    );
    assert.ok(
      Array.isArray(scoreHistory.body.data.scoreHistory)
      && scoreHistory.body.data.scoreHistory.some(entry => entry.winner === "X" && entry.moveCount === 5),
      "restarted app should retain score history from SQLite",
    );
  } finally {
    await restarted.stop();
  }
}
