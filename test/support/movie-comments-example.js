import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const movieCommentsExampleDir = path.join(repoRoot, "examples", "movie-comments-app");

const MOVIE_POSTER_DATA_URL = "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240\" height=\"360\"><rect width=\"100%\" height=\"100%\" fill=\"%23141b2d\"/><text x=\"50%\" y=\"50%\" fill=\"white\" font-size=\"28\" text-anchor=\"middle\" dominant-baseline=\"middle\">Arrival</text></svg>";
const MOVIE_SEED_SQL = `
  CREATE TABLE IF NOT EXISTS movies (
    movie_id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    release_year INTEGER NOT NULL,
    poster_url TEXT NOT NULL,
    synopsis TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS movie_comments (
    comment_id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (movie_id) REFERENCES movies(movie_id)
  );
  DELETE FROM movie_comments;
  DELETE FROM movies;
  INSERT INTO movies (movie_id, slug, title, release_year, poster_url, synopsis)
  VALUES (
    1,
    'arrival',
    'Arrival',
    2016,
    '${MOVIE_POSTER_DATA_URL}',
    'A linguist works with alien visitors to understand their language before conflict escalates.'
  );
`;

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

function spawnMovieCommentsDevServer(cwd, port) {
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

export function resolveMovieCommentsDevPort(cwd, requestedPort) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fs.existsSync(packageJsonPath)) return requestedPort;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const devScript = String(pkg?.scripts?.dev || "");
    const match = devScript.match(/(?:^|\s)PORT=(\d+)(?:\s|$)/);
    if (match) return Number.parseInt(match[1], 10);
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

function packageHasDependency(cwd, name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
  return Boolean(
    pkg?.dependencies?.[name]
    || pkg?.devDependencies?.[name]
    || pkg?.peerDependencies?.[name]
    || pkg?.optionalDependencies?.[name]
  );
}

function readCommentRows(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare("SELECT movie_id, author, body FROM movie_comments ORDER BY comment_id").all()
      .map(row => ({
        movie_id: Number(row.movie_id),
        author: String(row.author),
        body: String(row.body),
      }));
  } finally {
    db.close();
  }
}

export function resetMovieCommentsRuntimeState(cwd) {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = path.join(cwd, `test.db${suffix}`);
    fs.rmSync(target, { force: true });
  }
  const db = new DatabaseSync(path.join(cwd, "test.db"));
  try {
    db.exec(MOVIE_SEED_SQL);
  } finally {
    db.close();
  }
}

export async function assertMovieCommentsAppRuntimeQuality(cwd, { port } = {}) {
  assert.ok(Number.isInteger(port) && port > 0, "runtime quality checks require a concrete port");
  const runtimePort = resolveMovieCommentsDevPort(cwd, port);
  const baseUrl = `http://127.0.0.1:${runtimePort}`;
  await waitForHttpGone(baseUrl);
  resetMovieCommentsRuntimeState(cwd);

  assert.equal(packageHasDependency(cwd, "vue"), true, "runtime app should depend on vue");
  assert.equal(packageHasDependency(cwd, "ant-design-vue"), true, "runtime app should depend on ant-design-vue");
  assert.equal(packageHasDependency(cwd, "graphql"), true, "runtime app should depend on graphql");

  const server = spawnMovieCommentsDevServer(cwd, runtimePort);
  try {
    const home = await waitForHttpOk(`${baseUrl}/`, server.child, server.logs);
    const homeHtml = await home.text();
    assert.match(homeHtml, /movie/i, "runtime app should serve a movie-comments shell");

    const movieDetail = await postGraphql(
      baseUrl,
      `query MovieDetail {
        movie(movieId: 1) {
          movieId
          title
          posterUrl
          synopsis
          comments {
            author
            body
          }
        }
      }`,
    );
    assert.equal(movieDetail.status, 200);
    assert.ok(!movieDetail.body.errors, "movie detail should not return GraphQL errors");
    assert.equal(movieDetail.body.data.movie.title, "Arrival");
    assert.match(String(movieDetail.body.data.movie.posterUrl || ""), /^data:image|^\/|^https?:/);
    assert.ok(Array.isArray(movieDetail.body.data.movie.comments));

    const added = await postGraphql(
      baseUrl,
      `mutation AddMovieComment {
        addMovieComment(movieId: 1, author: "Nadia", body: "Loved the ending.") {
          commentId
          author
          body
          movie {
            movieId
            title
          }
        }
      }`,
    );
    assert.equal(added.status, 200);
    assert.ok(!added.body.errors, "addMovieComment should not return GraphQL errors");
    assert.equal(added.body.data.addMovieComment.author, "Nadia");
    assert.equal(added.body.data.addMovieComment.body, "Loved the ending.");
    assert.equal(added.body.data.addMovieComment.movie.title, "Arrival");

    const refreshedDetail = await postGraphql(
      baseUrl,
      `query MovieDetailAfterComment {
        movie(movieId: 1) {
          comments {
            author
            body
          }
        }
      }`,
    );
    assert.equal(refreshedDetail.status, 200);
    assert.ok(!refreshedDetail.body.errors, "movie detail after comment should not return GraphQL errors");
    assert.ok(
      refreshedDetail.body.data.movie.comments.some(comment => comment.author === "Nadia" && comment.body === "Loved the ending."),
      "runtime app should expose the newly added movie comment through GraphQL",
    );
  } finally {
    await server.stop();
  }

  const dbPath = path.join(cwd, "test.db");
  assert.ok(fs.existsSync(dbPath), "runtime app should persist movie comments to test.db");
  assert.deepEqual(readCommentRows(dbPath), [
    { movie_id: 1, author: "Nadia", body: "Loved the ending." },
  ]);

  const restarted = spawnMovieCommentsDevServer(cwd, runtimePort);
  try {
    await waitForHttpOk(`${baseUrl}/`, restarted.child, restarted.logs);
    const movieDetail = await postGraphql(
      baseUrl,
      `query MovieDetailAfterRestart {
        movie(movieId: 1) {
          comments {
            author
            body
          }
        }
      }`,
    );
    assert.ok(
      Array.isArray(movieDetail.body.data.movie.comments)
      && movieDetail.body.data.movie.comments.some(comment => comment.author === "Nadia" && comment.body === "Loved the ending."),
      "restarted app should retain movie comments from SQLite",
    );
  } finally {
    await restarted.stop();
  }
}
