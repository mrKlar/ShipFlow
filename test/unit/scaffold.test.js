import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyProjectScaffold, resolveProjectScaffold } from "../../lib/scaffold.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-scaffold-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("resolveProjectScaffold", () => {
  it("infers the Vue + Ant Design Vue scaffold from implementation context", () => {
    withTmpDir(tmpDir => {
      const result = resolveProjectScaffold(tmpDir, {
        config: {
          impl: {
            context: "Build a Vue 3 movie-comments app with an Ant Design Vue interface, a GraphQL API, and SQLite storage.",
          },
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.preset, "vue-antdv-graphql-sqlite");
      assert.equal(result.inferred, true);
    });
  });

  it("skips inferred scaffolds when implementation files already exist", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), "console.log('existing');\n");

      const result = resolveProjectScaffold(tmpDir, {
        config: {
          impl: {
            context: "Build a Node.js tic-tac-toe app with a browser UI, GraphQL API, and SQLite history.",
          },
        },
      });

      assert.equal(result.skipped, true);
      assert.match(result.reason, /implementation files already exist/i);
    });
  });
});

describe("applyProjectScaffold", () => {
  it("merges the scaffold package.json and creates the expected file structure", () => {
    withTmpDir(tmpDir => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
        private: true,
        devDependencies: {
          "@playwright/test": "^1.45.0",
        },
      }, null, 2));

      const result = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              preset: "node-web-graphql-sqlite",
            },
          },
        },
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
      assert.equal(result.ok, true);
      assert.equal(result.applied, true);
      assert.equal(result.preset, "node-web-graphql-sqlite");
      assert.equal(pkg.name, path.basename(tmpDir).toLowerCase());
      assert.equal(pkg.type, "module");
      assert.equal(pkg.scripts.dev, "node src/server.js");
      assert.equal(pkg.devDependencies["@playwright/test"], "^1.45.0");
      assert.equal(pkg.dependencies.graphql, "^16.10.0");
      assert.ok(fs.existsSync(path.join(tmpDir, "src", "server.js")));
      assert.ok(fs.existsSync(path.join(tmpDir, "src", "public", "index.html")));
      assert.ok(fs.existsSync(path.join(tmpDir, "src", "public", "app.js")));
      assert.ok(fs.existsSync(path.join(tmpDir, "src", "public", "styles.css")));
    });
  });

  it("applies the REST scaffold explicitly even without implementation context", () => {
    withTmpDir(tmpDir => {
      const result = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              preset: "node-rest-service-sqlite",
            },
          },
        },
      });

      const serverFile = fs.readFileSync(path.join(tmpDir, "src", "server.js"), "utf-8");
      assert.equal(result.ok, true);
      assert.equal(result.preset, "node-rest-service-sqlite");
      assert.match(serverFile, /REST service scaffold/i);
    });
  });
});
