import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyProjectScaffold, resolveProjectScaffold, scaffoldPlugin } from "../../lib/scaffold.js";
import { installScaffoldPlugin, readScaffoldState } from "../../lib/scaffold-plugins.js";

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-scaffold-"));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function createPluginFixture(rootDir, {
  id,
  pluginType,
  componentKinds = [],
  templateFiles = {},
  installScript = "",
}) {
  fs.mkdirSync(rootDir, { recursive: true });
  const templateDir = path.join(rootDir, "template");
  fs.mkdirSync(templateDir, { recursive: true });
  for (const [relative, content] of Object.entries(templateFiles)) {
    const fullPath = path.join(templateDir, relative);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  if (installScript) {
    fs.writeFileSync(path.join(rootDir, "install.mjs"), installScript);
  }
  fs.writeFileSync(path.join(rootDir, "shipflow-scaffold-plugin.json"), JSON.stringify({
    schema_version: 1,
    id,
    name: `${id} plugin`,
    version: "1.0.0",
    plugin_type: pluginType,
    description: `Fixture plugin ${id}`,
    component_kinds: componentKinds,
    llm: {
      summary: `${id} summary`,
      guidance: [`${id} guidance`],
    },
    capabilities: {
      app_shapes: pluginType === "startup" ? ["fullstack-web-stateful"] : [],
      adds: componentKinds,
    },
    apply: {
      template_dir: "template",
    },
    install: installScript ? { script: "install.mjs" } : null,
  }, null, 2));
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

  it("captures component plugin entries from shipflow.json", () => {
    withTmpDir(tmpDir => {
      const result = resolveProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              components: ["graphql-api-component", { plugin: "sqlite-db-component" }],
            },
          },
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.components.length, 2);
      assert.equal(result.components[0].plugin, "graphql-api-component");
      assert.equal(result.components[1].plugin, "sqlite-db-component");
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
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "ui", "root-shell.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "api", "health.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "technical", "framework-stack.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "technical", "architecture-boundaries.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "security", "response-headers.yml")));
      assert.deepEqual(result.components, []);
      assert.ok(Array.isArray(result.actions));
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
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "api", "health.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "technical", "api-protocol.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "technical", "architecture-boundaries.yml")));
      assert.ok(fs.existsSync(path.join(tmpDir, "vp", "security", "response-headers.yml")));
    });
  });

  it("keeps the Vue Vite scaffold compatible with ShipFlow managed PORT", () => {
    withTmpDir(tmpDir => {
      const result = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              preset: "vue-antdv-graphql-sqlite",
            },
          },
        },
      });

      const devScript = fs.readFileSync(path.join(tmpDir, "scripts", "dev.js"), "utf-8");
      const viteConfig = fs.readFileSync(path.join(tmpDir, "vite.config.js"), "utf-8");
      assert.equal(result.ok, true);
      assert.match(devScript, /process\.env\.PORT/);
      assert.doesNotMatch(devScript, /--port/);
      assert.match(viteConfig, /process\.env\.PORT/);
      assert.doesNotMatch(viteConfig, /\bport:\s*3000\b/);
    });
  });

  it("does not reapply an already-installed startup scaffold on a non-greenfield repo", () => {
    withTmpDir(tmpDir => {
      const first = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              preset: "node-web-graphql-sqlite",
            },
          },
        },
      });
      assert.equal(first.ok, true);
      assert.equal(first.applied, true);

      const second = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              preset: "node-web-graphql-sqlite",
            },
          },
        },
      });

      assert.equal(second.ok, true);
      assert.equal(second.applied, false);
      assert.match(second.actions.join("\n"), /already installed/i);
    });
  });

  it("installs a startup scaffold plugin from a zip package and applies it on a greenfield repo", () => {
    withTmpDir(tmpDir => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      const fixtureDir = path.join(tmpDir, "fixture-startup");
      createPluginFixture(fixtureDir, {
        id: "startup-foundation",
        pluginType: "startup",
        templateFiles: {
          "package.json": JSON.stringify({
            private: true,
            type: "module",
            scripts: { dev: "node src/server.js" },
          }, null, 2),
          "src/server.js": "console.log('startup foundation');\n",
          "vp/technical/framework-stack.yml": "id: technical-framework-stack\ntitle: Startup stack stays in place\nseverity: blocker\ncategory: framework\napp:\n  kind: technical\n  root: .\nassert:\n  - path_exists:\n      path: src/server.js\n",
        },
        installScript: "import fs from 'node:fs';\nfs.writeFileSync('startup-plugin.log', 'installed\\n');\nconsole.log('startup script ran');\n",
      });
      const archive = path.join(tmpDir, "startup-foundation.zip");
      fs.writeFileSync(archive, "");

      const install = installScaffoldPlugin(projectDir, archive, {
        extractZip: (_zipPath, destination) => {
          fs.cpSync(fixtureDir, destination, { recursive: true });
        },
      });
      assert.equal(install.ok, true);

      const result = applyProjectScaffold(projectDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              plugin: "startup-foundation",
            },
          },
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.applied, true);
      assert.ok(fs.existsSync(path.join(projectDir, "src", "server.js")));
      assert.ok(fs.existsSync(path.join(projectDir, "vp", "technical", "framework-stack.yml")));
      assert.equal(fs.readFileSync(path.join(projectDir, "startup-plugin.log"), "utf-8"), "installed\n");
      const state = readScaffoldState(projectDir);
      assert.equal(state.startup.id, "startup-foundation");
      assert.equal(state.startup.llm.summary, "startup-foundation summary");
      assert.deepEqual(state.startup.base_verification_files, ["vp/technical/framework-stack.yml"]);
    });
  });

  it("rejects startup scaffold plugins that do not bundle base verification files", () => {
    withTmpDir(tmpDir => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      const fixtureDir = path.join(tmpDir, "fixture-startup");
      createPluginFixture(fixtureDir, {
        id: "startup-foundation",
        pluginType: "startup",
        templateFiles: {
          "src/server.js": "console.log('startup foundation');\n",
        },
      });
      const archive = path.join(tmpDir, "startup-foundation.zip");
      fs.writeFileSync(archive, "");

      const install = installScaffoldPlugin(projectDir, archive, {
        extractZip: (_zipPath, destination) => {
          fs.cpSync(fixtureDir, destination, { recursive: true });
        },
      });

      assert.equal(install.ok, false);
      assert.match(install.issues[0], /must bundle base verification files under vp\//i);
    });
  });

  it("rejects startup scaffold plugins on non-greenfield repos", () => {
    withTmpDir(tmpDir => {
      const projectDir = path.join(tmpDir, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      const fixtureDir = path.join(tmpDir, "fixture-startup");
      createPluginFixture(fixtureDir, {
        id: "startup-foundation",
        pluginType: "startup",
        templateFiles: {
          "src/server.js": "console.log('startup foundation');\n",
          "vp/technical/framework-stack.yml": "id: technical-framework-stack\ntitle: Startup stack stays in place\nseverity: blocker\ncategory: framework\napp:\n  kind: technical\n  root: .\nassert:\n  - path_exists:\n      path: src/server.js\n",
        },
      });
      const archive = path.join(tmpDir, "startup-foundation.zip");
      fs.writeFileSync(archive, "");
      installScaffoldPlugin(projectDir, archive, {
        extractZip: (_zipPath, destination) => {
          fs.cpSync(fixtureDir, destination, { recursive: true });
        },
      });

      fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "src", "existing.js"), "console.log('existing');\n");

      const result = applyProjectScaffold(projectDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              plugin: "startup-foundation",
            },
          },
        },
      });

      assert.equal(result.ok, false);
      assert.match(result.issues[0], /greenfield repo/i);
    });
  });

  it("applies component plugins onto an existing repo and preserves scaffold state", () => {
    withTmpDir(tmpDir => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "server.js"), "console.log('base');\n");

      const fixtureDir = path.join(tmpDir, "fixture-component");
      createPluginFixture(fixtureDir, {
        id: "graphql-api-component",
        pluginType: "component",
        componentKinds: ["api", "service"],
        templateFiles: {
          "package.json": JSON.stringify({
            dependencies: { graphql: "^16.10.0" },
          }, null, 2),
          "src/graphql.js": "export const schema = 'type Query { ok: Boolean! }';\n",
        },
        installScript: "import fs from 'node:fs';\nfs.writeFileSync('component-plugin.log', 'component installed\\n');\nconsole.log('component script ran');\n",
      });
      const archive = path.join(tmpDir, "graphql-api-component.zip");
      fs.writeFileSync(archive, "");
      installScaffoldPlugin(tmpDir, archive, {
        extractZip: (_zipPath, destination) => {
          fs.cpSync(fixtureDir, destination, { recursive: true });
        },
      });

      const result = applyProjectScaffold(tmpDir, {
        config: {
          impl: {
            scaffold: {
              enabled: true,
              components: ["graphql-api-component"],
            },
          },
        },
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
      assert.equal(result.ok, true);
      assert.ok(fs.existsSync(path.join(tmpDir, "src", "graphql.js")));
      assert.equal(pkg.dependencies.graphql, "^16.10.0");
      assert.equal(fs.readFileSync(path.join(tmpDir, "component-plugin.log"), "utf-8"), "component installed\n");
      const state = readScaffoldState(tmpDir);
      assert.equal(state.components.length, 1);
      assert.equal(state.components[0].id, "graphql-api-component");
      assert.deepEqual(state.components[0].component_kinds, ["api", "service"]);
    });
  });
});

describe("scaffoldPlugin", () => {
  it("lists installed scaffold plugins", () => {
    withTmpDir(tmpDir => {
      const fixtureDir = path.join(tmpDir, "fixture-component");
      createPluginFixture(fixtureDir, {
        id: "graphql-api-component",
        pluginType: "component",
        componentKinds: ["api"],
        templateFiles: {
          "src/graphql.js": "export const schema = '';\n",
        },
      });
      const archive = path.join(tmpDir, "graphql-api-component.zip");
      fs.writeFileSync(archive, "");
      installScaffoldPlugin(tmpDir, archive, {
        extractZip: (_zipPath, destination) => {
          fs.cpSync(fixtureDir, destination, { recursive: true });
        },
      });

      const writes = [];
      const errors = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => writes.push(args.join(" "));
      console.error = (...args) => errors.push(args.join(" "));
      try {
        const result = scaffoldPlugin({ cwd: tmpDir, input: "list" });
        assert.equal(result.exitCode, 0);
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      assert.equal(errors.length, 0);
      assert.ok(writes.some(line => /graphql-api-component@1\.0\.0 \(component\)/.test(line)));
    });
  });
});
