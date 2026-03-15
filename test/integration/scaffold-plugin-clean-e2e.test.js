import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const shipflowBin = path.join(repoRoot, "bin", "shipflow.js");
const DOS_DATE = 33;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function withTmpDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shipflow-scaffold-e2e-"));
  const keepTmp = process.env.SHIPFLOW_KEEP_TEMP === "1";
  try {
    return fn(tmpDir);
  } finally {
    if (!keepTmp) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
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

  for (const [relativePath, content] of Object.entries(templateFiles)) {
    const fullPath = path.join(templateDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  if (installScript) {
    fs.writeFileSync(path.join(rootDir, "install.mjs"), installScript);
  }

  writeJson(path.join(rootDir, "shipflow-scaffold-plugin.json"), {
    schema_version: 1,
    id,
    name: `${id} plugin`,
    version: "1.0.0",
    plugin_type: pluginType,
    description: `Fixture plugin ${id}`,
    component_kinds: componentKinds,
    llm: {
      summary: `${id} summary`,
      guidance: [`Extend the installed ${id} foundation instead of rebuilding it.`],
    },
    capabilities: {
      app_shapes: pluginType === "startup" ? ["fullstack-web-stateful"] : [],
      adds: componentKinds.map(kind => `${kind}:${id}`),
    },
    apply: {
      template_dir: "template",
    },
    install: installScript ? { script: "install.mjs" } : null,
  });
}

function listFiles(rootDir) {
  const files = [];
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(fullPath);
    }
  }
  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer so the CLI path exercises the real install/unzip flow.
function writeZipArchiveFromDirectory(sourceDir, archivePath) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const files = listFiles(sourceDir);

  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).replaceAll(path.sep, "/");
    const nameBuffer = Buffer.from(relativePath, "utf-8");
    const dataBuffer = fs.readFileSync(filePath);
    const crc = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(archivePath, Buffer.concat([...localChunks, centralDirectory, eocd]));
}

function runShipflow(cwd, args) {
  return spawnSync(process.execPath, [shipflowBin, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: {
      ...process.env,
      PATH: [path.dirname(process.execPath), process.env.PATH || ""].filter(Boolean).join(path.delimiter),
    },
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`.trim());
}

describe("scaffold plugin clean e2e", () => {
  it("installs startup and component plugins through the CLI and applies them on a clean repo", () => {
    withTmpDir(tmpDir => {
      try {
        const projectDir = path.join(tmpDir, "project");
        fs.mkdirSync(projectDir, { recursive: true });

        assertSuccess(runShipflow(projectDir, ["init", "--codex"]));

        const startupFixtureDir = path.join(tmpDir, "movie-foundation");
        createPluginFixture(startupFixtureDir, {
          id: "movie-foundation",
          pluginType: "startup",
          templateFiles: {
            "package.json": JSON.stringify({
              private: true,
              type: "module",
              scripts: {
                dev: "node src/server.js",
              },
            }, null, 2),
            "src/server.js": "console.log('movie foundation');\n",
            "vp/technical/framework-stack.yml": "id: technical-framework-stack\ntitle: Movie foundation stack stays in place\nseverity: blocker\ncategory: framework\napp:\n  kind: technical\n  root: .\nassert:\n  - path_exists:\n      path: src/server.js\n",
          },
          installScript: "import fs from 'node:fs';\nfs.writeFileSync('startup-plugin.log', 'movie foundation installed\\n');\nconsole.log('startup install complete');\n",
        });
        const startupZip = path.join(tmpDir, "movie-foundation.zip");
        writeZipArchiveFromDirectory(startupFixtureDir, startupZip);

        const componentFixtureDir = path.join(tmpDir, "comments-graphql");
        createPluginFixture(componentFixtureDir, {
          id: "comments-graphql",
          pluginType: "component",
          componentKinds: ["api", "service"],
          templateFiles: {
            "package.json": JSON.stringify({
              dependencies: {
                graphql: "^16.10.0",
              },
            }, null, 2),
            "src/graphql/schema.js": "export const schema = 'type Query { comments: [String!]! }';\n",
          },
          installScript: "import fs from 'node:fs';\nfs.writeFileSync('component-plugin.log', 'comments graphql installed\\n');\nconsole.log('component install complete');\n",
        });
        const componentZip = path.join(tmpDir, "comments-graphql.zip");
        writeZipArchiveFromDirectory(componentFixtureDir, componentZip);

        assertSuccess(runShipflow(projectDir, ["scaffold-plugin", "install", startupZip]));
        assertSuccess(runShipflow(projectDir, ["scaffold-plugin", "install", componentZip]));

        const listResult = runShipflow(projectDir, ["scaffold-plugin", "list"]);
        assertSuccess(listResult);
        assert.ok(fs.existsSync(path.join(projectDir, ".shipflow", "scaffold-plugins", "movie-foundation", "shipflow-scaffold-plugin.json")));
        assert.ok(fs.existsSync(path.join(projectDir, ".shipflow", "scaffold-plugins", "comments-graphql", "shipflow-scaffold-plugin.json")));

        const configPath = path.join(projectDir, "shipflow.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        config.impl = {
          ...(config.impl || {}),
          context: "Build a movie comments app with a GraphQL API.",
          scaffold: {
            enabled: true,
            plugin: "movie-foundation",
            components: ["comments-graphql"],
          },
        };
        writeJson(configPath, config);

        const scaffoldResult = runShipflow(projectDir, ["scaffold"]);
        assertSuccess(scaffoldResult);

        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
        assert.equal(pkg.type, "module");
        assert.equal(pkg.scripts.dev, "node src/server.js");
        assert.equal(pkg.dependencies.graphql, "^16.10.0");
        assert.ok(fs.existsSync(path.join(projectDir, "src", "server.js")));
        assert.ok(fs.existsSync(path.join(projectDir, "src", "graphql", "schema.js")));
        assert.ok(fs.existsSync(path.join(projectDir, "vp", "technical", "framework-stack.yml")));
        assert.equal(fs.readFileSync(path.join(projectDir, "startup-plugin.log"), "utf-8"), "movie foundation installed\n");
        assert.equal(fs.readFileSync(path.join(projectDir, "component-plugin.log"), "utf-8"), "comments graphql installed\n");

        const state = JSON.parse(fs.readFileSync(path.join(projectDir, ".shipflow", "scaffold-state.json"), "utf-8"));
        assert.equal(state.startup.id, "movie-foundation");
        assert.deepEqual(state.startup.base_verification_files, ["vp/technical/framework-stack.yml"]);
        assert.equal(state.components.length, 1);
        assert.equal(state.components[0].id, "comments-graphql");
        assert.deepEqual(state.components[0].component_kinds, ["api", "service"]);
      } catch (error) {
        console.error(`scaffold-plugin clean e2e temp dir: ${tmpDir}`);
        throw error;
      }
    });
  });
});
