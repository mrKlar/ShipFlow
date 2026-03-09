const SPECIALIZED_FRAMEWORKS = new Set([
  "dependency-cruiser",
  "madge",
  "tsarch",
  "eslint-plugin-boundaries",
]);

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function splitGlob(glob) {
  return String(glob || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
}

export function technicalFrameworkFor(check) {
  return check?.runner?.framework || "custom";
}

export function isSpecializedTechnicalFramework(framework) {
  return SPECIALIZED_FRAMEWORKS.has(framework);
}

export function isSpecializedTechnicalCheck(check) {
  return isSpecializedTechnicalFramework(technicalFrameworkFor(check));
}

export function isPathLikePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  return pattern.includes("/") || pattern.includes("\\") || pattern.includes("*") || pattern.startsWith(".");
}

export function frameworkSupportsAssertion(framework, assertion) {
  if (!isSpecializedTechnicalFramework(framework)) return false;
  if (framework === "madge") return Boolean(assertion?.no_circular_dependencies);
  if (framework === "eslint-plugin-boundaries") return Boolean(assertion?.layer_dependencies);
  if (framework === "dependency-cruiser") {
    if (assertion?.layer_dependencies) return true;
    if (assertion?.imports_forbidden) {
      return assertion.imports_forbidden.patterns.some(isPathLikePattern);
    }
    return false;
  }
  if (framework === "tsarch") {
    if (assertion?.layer_dependencies || assertion?.no_circular_dependencies) return true;
    if (assertion?.imports_forbidden) {
      return assertion.imports_forbidden.patterns.some(isPathLikePattern);
    }
    return false;
  }
  return false;
}

export function splitTechnicalAssertions(check) {
  const framework = technicalFrameworkFor(check);
  const backendAssertions = [];
  const genericAssertions = [];
  for (const assertion of check.assert || []) {
    if (frameworkSupportsAssertion(framework, assertion)) backendAssertions.push(assertion);
    else genericAssertions.push(assertion);
  }
  return { framework, backendAssertions, genericAssertions };
}

export function globBase(glob) {
  const segments = splitGlob(glob);
  const stable = [];
  for (const segment of segments) {
    if (segment.includes("*") || segment.includes("?") || segment.includes("{") || segment.includes("[")) break;
    stable.push(segment);
  }
  if (stable.length === 0) return ".";
  const joined = stable.join("/");
  const last = stable[stable.length - 1] || "";
  if (last.includes(".")) return stable.slice(0, -1).join("/") || ".";
  return joined || ".";
}

function collectLayerGlobs(assertion) {
  return assertion?.layer_dependencies?.layers?.map(layer => layer.files) || [];
}

export function deriveTechnicalFrameworkTargets(check, framework = technicalFrameworkFor(check)) {
  const targets = [];
  for (const assertion of check.assert || []) {
    if (!frameworkSupportsAssertion(framework, assertion)) continue;
    if (assertion.imports_forbidden) targets.push(globBase(assertion.imports_forbidden.files));
    if (assertion.imports_allowed_only_from) targets.push(globBase(assertion.imports_allowed_only_from.files));
    if (assertion.no_circular_dependencies) targets.push(globBase(assertion.no_circular_dependencies.files));
    for (const glob of collectLayerGlobs(assertion)) targets.push(globBase(glob));
  }
  return uniq(targets.length > 0 ? targets : [check.app?.root || "."]);
}

export function frameworkPackages(framework, check = null) {
  if (framework === "dependency-cruiser") return ["dependency-cruiser"];
  if (framework === "madge") return ["madge"];
  if (framework === "tsarch") return ["tsarch"];
  if (framework === "eslint-plugin-boundaries") {
    const needsTsParser = usesTypeScriptPatterns(check);
    return uniq([
      "eslint",
      "eslint-plugin-boundaries",
      ...(needsTsParser ? ["@typescript-eslint/parser"] : []),
    ]);
  }
  return [];
}

export function usesTypeScriptPatterns(check) {
  const patterns = [];
  for (const assertion of check?.assert || []) {
    if (assertion.imports_forbidden) patterns.push(assertion.imports_forbidden.files, ...assertion.imports_forbidden.patterns);
    if (assertion.imports_allowed_only_from) patterns.push(assertion.imports_allowed_only_from.files, ...assertion.imports_allowed_only_from.patterns);
    if (assertion.no_circular_dependencies) {
      patterns.push(assertion.no_circular_dependencies.files);
      for (const ext of assertion.no_circular_dependencies.extensions || []) patterns.push(`*.${ext}`);
    }
    if (assertion.layer_dependencies) {
      for (const layer of assertion.layer_dependencies.layers || []) patterns.push(layer.files);
    }
  }
  return patterns.some(pattern => /\.(ts|tsx)(?:$|[^a-z])/i.test(String(pattern || "")));
}
