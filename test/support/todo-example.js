import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const todoExampleDir = path.join(repoRoot, "examples", "todo-app");

const TODO_SERVER_SOURCE = `import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

function pageHtml(filter) {
  const safeFilter = ["all", "active", "completed"].includes(filter) ? filter : "all";
  const selected = value => (value === safeFilter ? " selected" : "");
  return \`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShipFlow Todo Example</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        background: #f4f7fb;
        color: #0f172a;
      }
      main {
        max-width: 720px;
        margin: 48px auto;
        padding: 32px;
        background: white;
        border-radius: 20px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin-top: 0;
      }
      form,
      .toolbar,
      li {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      form,
      .toolbar {
        margin-bottom: 16px;
      }
      input,
      select,
      button {
        font: inherit;
        padding: 10px 12px;
      }
      input,
      select {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
      }
      button {
        border: 0;
        border-radius: 10px;
        background: #0f172a;
        color: white;
        cursor: pointer;
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        justify-content: space-between;
        padding: 12px 0;
        border-bottom: 1px solid #e2e8f0;
      }
      .todo-text[data-completed="true"] {
        text-decoration: line-through;
        color: #64748b;
      }
      .status-pill {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #dcfce7;
        color: #166534;
      }
    </style>
  </head>
  <body>
    <main>
      <h1 data-testid="app-title">ShipFlow Todo</h1>
      <form id="todo-form">
        <input data-testid="new-todo-input" id="new-todo-input" name="title" placeholder="Add a task" autocomplete="off" />
        <button type="submit">Add</button>
      </form>
      <div class="toolbar">
        <label for="filter-select">Filter</label>
        <select id="filter-select" name="filter" aria-label="Filter">
          <option value="all"\${selected("all")}>All</option>
          <option value="active"\${selected("active")}>Active</option>
          <option value="completed"\${selected("completed")}>Completed</option>
        </select>
        <strong data-testid="completed-count">0 completed</strong>
      </div>
      <p id="no-todos-message" data-testid="no-todos-message">No todos yet.</p>
      <ul id="todo-list" data-testid="todo-list"></ul>
    </main>
    <script>
      const listEl = document.getElementById("todo-list");
      const formEl = document.getElementById("todo-form");
      const inputEl = document.getElementById("new-todo-input");
      const filterEl = document.getElementById("filter-select");
      const emptyEl = document.getElementById("no-todos-message");
      const completedCountEl = document.querySelector('[data-testid="completed-count"]');

      async function request(path, init) {
        const response = await fetch(path, init);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || response.statusText);
        }
        return response.json();
      }

      function currentFilter() {
        return filterEl.value || "all";
      }

      function syncFilterUrl(value) {
        const url = new URL(window.location.href);
        if (value === "all") url.searchParams.delete("filter");
        else url.searchParams.set("filter", value);
        window.history.replaceState({}, "", url);
      }

      function render(todos) {
        listEl.innerHTML = "";
        emptyEl.hidden = todos.length > 0;
        const completedCount = todos.filter(todo => todo.completed).length;
        completedCountEl.textContent = String(completedCount) + " completed";

        todos.forEach((todo, index) => {
          const item = document.createElement("li");
          item.dataset.testid = "todo-item";

          const textWrap = document.createElement("div");
          const title = document.createElement("span");
          title.className = "todo-text";
          title.dataset.completed = String(todo.completed);
          title.dataset.testid = "todo-item-" + index;
          title.textContent = todo.title;
          textWrap.appendChild(title);

          if (index === todos.length - 1) {
            const lastTitle = document.createElement("span");
            lastTitle.dataset.testid = "todo-item-last";
            lastTitle.hidden = true;
            lastTitle.textContent = todo.title;
            textWrap.appendChild(lastTitle);
          }

          const completed = document.createElement("span");
          completed.className = "status-pill";
          completed.dataset.testid = "todo-completed-" + index;
          completed.hidden = !todo.completed;
          completed.textContent = "Completed";
          textWrap.appendChild(completed);

          const actions = document.createElement("div");
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.dataset.testid = "todo-toggle-" + index;
          toggle.textContent = todo.completed ? "Undo" : "Complete";
          toggle.addEventListener("click", async () => {
            await request("/api/todos/" + todo.id, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ completed: !todo.completed }),
            });
            await refresh();
          });
          actions.appendChild(toggle);

          item.append(textWrap, actions);
          listEl.appendChild(item);
        });
      }

      async function refresh() {
        const todos = await request("/api/todos?filter=" + encodeURIComponent(currentFilter()));
        render(todos);
      }

      formEl.addEventListener("submit", async event => {
        event.preventDefault();
        const title = inputEl.value.trim();
        if (!title) return;
        await request("/api/todos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, completed: false }),
        });
        inputEl.value = "";
        await refresh();
      });

      filterEl.addEventListener("change", async () => {
        syncFilterUrl(currentFilter());
        await refresh();
      });

      refresh().catch(error => {
        emptyEl.hidden = false;
        emptyEl.textContent = "Error: " + error.message;
      });
    </script>
  </body>
</html>\`;
}

export function createTodoApp({ rootDir = process.cwd() } = {}) {
  const dbPath = path.join(rootDir, "test.db");
  const db = new DatabaseSync(dbPath);
  db.exec(\`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );
  \`);

  const selectAllTodos = db.prepare("SELECT id, title, completed FROM todos ORDER BY id");
  const selectFilteredTodos = {
    all: selectAllTodos,
    active: db.prepare("SELECT id, title, completed FROM todos WHERE completed = 0 ORDER BY id"),
    completed: db.prepare("SELECT id, title, completed FROM todos WHERE completed = 1 ORDER BY id"),
  };
  const insertTodoStatement = db.prepare("INSERT INTO todos (title, completed) VALUES (?, ?)");
  const readTodoById = db.prepare("SELECT id, title, completed FROM todos WHERE id = ?");
  const updateTodoCompletion = db.prepare("UPDATE todos SET completed = ? WHERE id = ?");

  function toTodo(row) {
    return {
      id: Number(row.id),
      title: String(row.title),
      completed: Boolean(row.completed),
    };
  }

  function listTodos(filter = "all") {
    const stmt = selectFilteredTodos[filter] || selectFilteredTodos.all;
    return stmt.all().map(toTodo);
  }

  function createTodo({ title, completed = false }) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) return { status: 400, body: { error: "title is required" } };
    const result = insertTodoStatement.run(normalizedTitle, completed ? 1 : 0);
    return { status: 201, body: toTodo(readTodoById.get(Number(result.lastInsertRowid))) };
  }

  function updateTodo(id, { completed = false } = {}) {
    updateTodoCompletion.run(completed ? 1 : 0, Number(id));
    const row = readTodoById.get(Number(id));
    if (!row) return { status: 404, body: { error: "todo not found" } };
    return { status: 200, body: toTodo(row) };
  }

  function handleApi({ method, pathname, searchParams = new URLSearchParams(), body = {} }) {
    if (method === "GET" && pathname === "/api/todos") {
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: listTodos(searchParams.get("filter") || "all"),
      };
    }
    if (method === "POST" && pathname === "/api/todos") {
      const result = createTodo(body);
      return {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: result.body,
      };
    }
    const patchMatch = pathname.match(/^\\/api\\/todos\\/(\\d+)$/);
    if (method === "PATCH" && patchMatch) {
      const result = updateTodo(patchMatch[1], body);
      return {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: result.body,
      };
    }
    return {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { error: "not found" },
    };
  }

  function renderPage(filter = "all") {
    return pageHtml(filter);
  }

  function close() {
    db.close();
  }

  return { dbPath, listTodos, createTodo, updateTodo, handleApi, renderPage, close };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

async function handleHttp(app, req, res) {
  const url = new URL(req.url || "/", \`http://\${req.headers.host || "127.0.0.1"}\`);
  if (req.method === "GET" && url.pathname === "/") {
    return sendHtml(res, 200, app.renderPage(url.searchParams.get("filter") || "all"));
  }

  const body = req.method === "POST" || req.method === "PATCH"
    ? await parseJsonBody(req)
    : {};
  const result = app.handleApi({
    method: req.method || "GET",
    pathname: url.pathname,
    searchParams: url.searchParams,
    body,
  });
  return sendJson(res, result.status, result.body);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createTodoApp();
  const server = http.createServer((req, res) => {
    handleHttp(app, req, res).catch(error => {
      sendJson(res, 500, { error: error.message });
    });
  });
  const port = Number(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log(\`ShipFlow todo example listening on http://127.0.0.1:\${port}\`);
  });

  const shutdown = () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
`;

export function createTempTodoExampleProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-todo-example-"));
  fs.cpSync(todoExampleDir, tmpDir, { recursive: true });
  fs.rmSync(path.join(tmpDir, ".gen"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "evidence"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "node_modules"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "test.db"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "src"), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "src", ".gitkeep"), "");
  return tmpDir;
}

export function todoExampleImplementationFiles() {
  return [["src/server.js", `${TODO_SERVER_SOURCE}\n`]];
}

export function todoExampleImplementationFileBlocks() {
  return todoExampleImplementationFiles()
    .map(([filePath, content]) => `--- FILE: ${filePath} ---\n${content}--- END FILE ---`)
    .join("\n\n");
}

async function loadTodoModule(cwd) {
  const moduleUrl = `${pathToFileURL(path.join(cwd, "src", "server.js")).href}?t=${Date.now()}`;
  return import(moduleUrl);
}

export async function assertTodoAppQuality(cwd) {
  const serverPath = path.join(cwd, "src", "server.js");
  assert.ok(fs.existsSync(serverPath), "todo example should generate src/server.js");

  const source = fs.readFileSync(serverPath, "utf-8");
  assert.match(source, /node:sqlite/, "implementation should use node:sqlite");
  assert.doesNotMatch(source, /better-sqlite3|from\s+["']sqlite3["']|require\(["']sqlite3["']\)/, "implementation should avoid native sqlite addons");
  assert.doesNotMatch(source, /\bTODO[:\s-]/, "implementation should not leave TODO markers");
  assert.doesNotMatch(source, /your implementation here|replace me/i, "implementation should not leave obvious unfinished placeholders");
  for (const selector of ["new-todo-input", "todo-item-last", "completed-count", "no-todos-message"]) {
    assert.match(source, new RegExp(selector.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
  }

  const { createTodoApp } = await loadTodoModule(cwd);
  assert.equal(typeof createTodoApp, "function");

  let app = createTodoApp({ rootDir: cwd });
  try {
    const html = app.renderPage("all");
    assert.match(html, /data-testid="new-todo-input"/);
    assert.match(html, /data-testid="completed-count"/);
    assert.match(html, />Filter</);
    assert.match(html, />Add</);

    const initialTodos = app.handleApi({ method: "GET", pathname: "/api/todos" });
    assert.equal(initialTodos.status, 200);
    assert.deepEqual(initialTodos.body, []);

    const alpha = app.handleApi({
      method: "POST",
      pathname: "/api/todos",
      body: { title: "Alpha", completed: false },
    });
    const beta = app.handleApi({
      method: "POST",
      pathname: "/api/todos",
      body: { title: "Beta", completed: false },
    });
    assert.equal(alpha.status, 201);
    assert.equal(beta.status, 201);
    assert.equal(alpha.body.completed, false);
    assert.equal(beta.body.completed, false);

    const toggled = app.handleApi({
      method: "PATCH",
      pathname: `/api/todos/${alpha.body.id}`,
      body: { completed: true },
    });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.completed, true);

    const allTodos = app.handleApi({ method: "GET", pathname: "/api/todos" });
    assert.deepEqual(allTodos.body.map(todo => todo.title), ["Alpha", "Beta"]);
    assert.deepEqual(allTodos.body.map(todo => todo.completed), [true, false]);

    const activeTodos = app.handleApi({
      method: "GET",
      pathname: "/api/todos",
      searchParams: new URLSearchParams("filter=active"),
    });
    assert.deepEqual(activeTodos.body.map(todo => todo.title), ["Beta"]);

    const completedTodos = app.handleApi({
      method: "GET",
      pathname: "/api/todos",
      searchParams: new URLSearchParams("filter=completed"),
    });
    assert.deepEqual(completedTodos.body.map(todo => todo.title), ["Alpha"]);

    const filteredHtml = app.renderPage("active");
    assert.match(filteredHtml, /option value="active" selected/);
  } finally {
    app.close();
  }

  const dbPath = path.join(cwd, "test.db");
  assert.ok(fs.existsSync(dbPath), "todo example should persist to test.db");
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare("SELECT title, completed FROM todos ORDER BY id").all()
      .map(row => ({ title: row.title, completed: row.completed }));
    assert.deepEqual(rows, [
      { title: "Alpha", completed: 1 },
      { title: "Beta", completed: 0 },
    ]);
  } finally {
    db.close();
  }

  app = createTodoApp({ rootDir: cwd });
  try {
    const persistedTodos = app.handleApi({ method: "GET", pathname: "/api/todos" });
    assert.deepEqual(persistedTodos.body.map(todo => todo.title), ["Alpha", "Beta"]);
    assert.deepEqual(persistedTodos.body.map(todo => todo.completed), [true, false]);
  } finally {
    app.close();
  }
}
