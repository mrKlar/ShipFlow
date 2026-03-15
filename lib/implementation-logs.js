import fs from "node:fs";
import path from "node:path";

const IMPLEMENTATION_LOG_VERSION = 1;

function evidenceDir(cwd) {
  return path.join(cwd, "evidence");
}

function agentsDir(cwd) {
  return path.join(evidenceDir(cwd), "agents");
}

export function sanitizeImplementationActorId(actorId) {
  const normalized = String(actorId || "unknown")
    .trim()
    .toLowerCase()
    .replaceAll("\\", "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function implementationLogPaths(cwd, actorId = null) {
  const evidDir = evidenceDir(cwd);
  const actors = agentsDir(cwd);
  return {
    evidenceDir: evidDir,
    manifest: path.join(evidDir, "implement-log-manifest.json"),
    events: path.join(evidDir, "implement-log.jsonl"),
    actorsDir: actors,
    actor: actorId ? path.join(actors, `${sanitizeImplementationActorId(actorId)}.jsonl`) : null,
  };
}

export function createImplementationRunId(prefix = "impl") {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${suffix}`;
}

function relativeEvidencePath(cwd, targetPath) {
  return path.relative(cwd, targetPath).replaceAll("\\", "/");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function createImplementationLogger({
  cwd,
  runId = createImplementationRunId(),
  provider = null,
  model = null,
} = {}) {
  if (!cwd) throw new Error("createImplementationLogger requires cwd");

  const paths = implementationLogPaths(cwd);
  fs.mkdirSync(paths.evidenceDir, { recursive: true });
  fs.mkdirSync(paths.actorsDir, { recursive: true });
  fs.writeFileSync(paths.events, "", "utf-8");

  let step = 0;
  let eventCount = 0;
  const actorFiles = new Map();
  const actors = new Set();
  const createdAt = new Date().toISOString();

  function writeManifest() {
    const manifest = {
      version: IMPLEMENTATION_LOG_VERSION,
      run_id: runId,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
      provider,
      model,
      last_step: step,
      event_count: eventCount,
      files: {
        events: relativeEvidencePath(cwd, paths.events),
        actors_dir: relativeEvidencePath(cwd, paths.actorsDir),
      },
      actors: [...actors]
        .sort((left, right) => left.localeCompare(right))
        .map(actorId => ({
          actor_id: actorId,
          path: relativeEvidencePath(cwd, actorFiles.get(actorId) || implementationLogPaths(cwd, actorId).actor),
        })),
    };
    writeJson(paths.manifest, manifest);
  }

  function ensureActorFile(actorId) {
    const normalized = sanitizeImplementationActorId(actorId);
    if (actorFiles.has(normalized)) return actorFiles.get(normalized);
    const file = implementationLogPaths(cwd, normalized).actor;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "", "utf-8");
    actorFiles.set(normalized, file);
    actors.add(normalized);
    writeManifest();
    return file;
  }

  function log({
    actorType = "orchestrator",
    actorId = "orchestrator",
    event = "note",
    message = "",
    iteration = null,
    stage = null,
    data = null,
  } = {}) {
    const normalizedActorId = sanitizeImplementationActorId(actorId);
    const record = {
      version: IMPLEMENTATION_LOG_VERSION,
      step: step + 1,
      run_id: runId,
      at: new Date().toISOString(),
      actor_type: String(actorType || "orchestrator"),
      actor_id: normalizedActorId,
      event: String(event || "note"),
      message: String(message || "").trim(),
    };
    if (Number.isFinite(iteration)) record.iteration = Number(iteration);
    if (stage) record.stage = String(stage);
    if (provider) record.provider = provider;
    if (model) record.model = model;
    if (data && typeof data === "object" && Object.keys(data).length > 0) record.data = data;

    step = record.step;
    eventCount += 1;
    fs.appendFileSync(paths.events, `${JSON.stringify(record)}\n`, "utf-8");
    fs.appendFileSync(ensureActorFile(normalizedActorId), `${JSON.stringify(record)}\n`, "utf-8");
    writeManifest();
    return record;
  }

  function actor(actorType, actorId, defaults = {}) {
    return {
      log(fields = {}) {
        return log({
          actorType,
          actorId,
          ...defaults,
          ...fields,
        });
      },
    };
  }

  writeManifest();

  return {
    cwd,
    runId,
    provider,
    model,
    paths,
    get lastStep() {
      return step;
    },
    get eventCount() {
      return eventCount;
    },
    actor,
    log,
  };
}
