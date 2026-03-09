import fs from "node:fs";
import path from "node:path";
import { readBehaviorChecks, isGherkinBehavior } from "./gen-behavior.js";
import { readDbChecks } from "./gen-db.js";
import { readTechnicalChecks } from "./gen-technical.js";
import { frameworkPackages } from "./technical-frameworks.js";

export function hasDependency(cwd, name) {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .some(section => pkg[section] && Object.prototype.hasOwnProperty.call(pkg[section], name));
  } catch {
    return false;
  }
}

function countFiles(dir, exts = [".yml", ".yaml"]) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(file => exts.some(ext => file.endsWith(ext))).length;
}

export function listPolicyFiles(cwd) {
  const dir = path.join(cwd, "vp", "policy");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => file.endsWith(".rego"));
}

export function collectVerificationRequirements(cwd) {
  const vpDir = path.join(cwd, "vp");
  const requirements = {
    playwright_required: false,
    k6_required: countFiles(path.join(vpDir, "nfr")) > 0,
    opa_required: listPolicyFiles(cwd).length > 0,
    behavior_frameworks: [],
    db_engines: [],
    technical_frameworks: [],
    technical_packages: [],
    parse_issues: [],
  };

  const playwrightDirs = ["ui", "behavior", "api", "db", "security"];
  requirements.playwright_required = playwrightDirs.some(dir => countFiles(path.join(vpDir, dir)) > 0);

  try {
    requirements.behavior_frameworks = [...new Set(
      readBehaviorChecks(vpDir)
        .filter(check => isGherkinBehavior(check))
        .map(() => "cucumber")
    )];
  } catch (error) {
    requirements.parse_issues.push(`Behavior verification checks could not be parsed: ${error.message}`);
  }

  try {
    requirements.db_engines = [...new Set(readDbChecks(vpDir).map(check => check.app.engine))].sort();
  } catch (error) {
    requirements.parse_issues.push(`Database verification checks could not be parsed: ${error.message}`);
  }

  try {
    const technicalChecks = readTechnicalChecks(vpDir);
    requirements.technical_frameworks = [...new Set(
      technicalChecks
        .map(check => check.runner?.framework)
        .filter(framework => framework && framework !== "custom" && framework !== "archtest")
    )].sort();
    requirements.technical_packages = [...new Set(
      technicalChecks.flatMap(check => frameworkPackages(check.runner?.framework, check))
    )].sort();
  } catch (error) {
    requirements.parse_issues.push(`Technical verification checks could not be parsed: ${error.message}`);
  }

  return requirements;
}

export function requiredVerificationPackages(requirements) {
  return [...new Set([
    ...(requirements.playwright_required ? ["@playwright/test"] : []),
    ...requirements.behavior_frameworks.map(framework => framework === "cucumber" ? "@cucumber/cucumber" : null),
    ...requirements.technical_packages,
  ].filter(Boolean))].sort();
}
