import { readUiChecks, genPlaywrightTest } from "./gen-ui.js";
import { readBehaviorChecks, genBehaviorTest, genBehaviorCucumberArtifacts, isGherkinBehavior } from "./gen-behavior.js";
import { readApiChecks, genApiTest } from "./gen-api.js";
import { readDbChecks, genDbTest } from "./gen-db.js";
import { readNfrChecks, genK6Script } from "./gen-nfr.js";
import { readSecurityChecks, genSecurityTest } from "./gen-security.js";
import { readTechnicalChecks, genTechnicalTest } from "./gen-technical.js";

function outputName(sourceFile, ext) {
  return sourceFile.replaceAll("/", "_").replace(/\.ya?ml$/, ext);
}

export const VERIFICATION_REGISTRY = [
  {
    id: "ui",
    label: "UI",
    source_dir: "ui",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "ui.json",
    readChecks: readUiChecks,
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: (check, context) => genPlaywrightTest(check, context.fixturesMap),
  },
  {
    id: "behavior",
    label: "Behavior",
    source_dir: "behavior",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "behavior.json",
    readChecks: readBehaviorChecks,
    filter: check => !isGherkinBehavior(check),
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: (check, context) => genBehaviorTest(check, context.fixturesMap),
  },
  {
    id: "behavior_gherkin",
    label: "Behavior (Gherkin)",
    source_dir: "behavior",
    output_kind: "cucumber",
    output_dir: "cucumber",
    evidence_file: "behavior-gherkin.json",
    readChecks: readBehaviorChecks,
    filter: check => isGherkinBehavior(check),
    generateArtifacts: (check, context) => genBehaviorCucumberArtifacts(check, context.fixturesMap),
  },
  {
    id: "api",
    label: "API",
    source_dir: "api",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "api.json",
    readChecks: readApiChecks,
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: check => genApiTest(check),
  },
  {
    id: "db",
    label: "Database",
    source_dir: "db",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "database.json",
    readChecks: readDbChecks,
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: check => genDbTest(check),
  },
  {
    id: "security",
    label: "Security",
    source_dir: "security",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "security.json",
    readChecks: readSecurityChecks,
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: check => genSecurityTest(check),
  },
  {
    id: "technical",
    label: "Technical",
    source_dir: "technical",
    output_kind: "playwright",
    output_dir: "playwright",
    evidence_file: "technical.json",
    readChecks: readTechnicalChecks,
    outputName: check => outputName(check.__file, ".test.ts"),
    generate: check => genTechnicalTest(check),
  },
  {
    id: "nfr",
    label: "Performance",
    source_dir: "nfr",
    output_kind: "k6",
    output_dir: "k6",
    evidence_file: "load.json",
    readChecks: readNfrChecks,
    outputName: check => outputName(check.__file, ".js"),
    generate: check => genK6Script(check),
  },
];

export function listVerificationTypes() {
  return VERIFICATION_REGISTRY.map(entry => ({ ...entry }));
}

export function findVerificationType(id) {
  return VERIFICATION_REGISTRY.find(entry => entry.id === id) || null;
}

export function listPlaywrightTypes() {
  return VERIFICATION_REGISTRY.filter(entry => entry.output_kind === "playwright");
}

export function listK6Types() {
  return VERIFICATION_REGISTRY.filter(entry => entry.output_kind === "k6");
}

export function listCucumberTypes() {
  return VERIFICATION_REGISTRY.filter(entry => entry.output_kind === "cucumber");
}
