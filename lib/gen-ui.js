import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { UiCheck, UiFixture } from "./schema/ui-check.zod.js";
import { pushStateRuntime, usesStateRuntime } from "./gen-state.js";

function formatZodError(file, err) {
  const lines = err.issues.map(iss => `  ${iss.path.join(".")}: ${iss.message}`);
  return new Error(`Validation failed in ${file}:\n${lines.join("\n")}`);
}

export function locatorExpr(loc) {
  if (loc.testid) return `page.getByTestId(${JSON.stringify(loc.testid)})`;
  if (loc.label) return `page.getByLabel(${JSON.stringify(loc.label)})`;
  const role = loc.role;
  const name = loc.name;
  if (loc.name_regex) return `page.getByRole(${JSON.stringify(role)}, { name: new RegExp(${JSON.stringify(name)}) })`;
  return `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`;
}

export function genStep(step, baseUrl) {
  if (step.open) return `await page.goto(${JSON.stringify(baseUrl + step.open)});`;
  if (step.click) return `await ${locatorExpr(step.click)}.click();`;
  if (step.fill) return `await ${locatorExpr(step.fill)}.fill(${JSON.stringify(step.fill.value)});`;
  if (step.select) return `await ${locatorExpr(step.select)}.selectOption(${JSON.stringify(step.select.value)});`;
  if (step.hover) return `await ${locatorExpr(step.hover)}.hover();`;
  if (step.wait_for) return `await page.waitForTimeout(${step.wait_for.ms ?? 250});`;
  if (step.route_block) {
    const { path: routePath, status } = step.route_block;
    return `await page.route(${JSON.stringify("**" + routePath)}, route => route.fulfill({ status: ${status}, body: "" }));`;
  }
  throw new Error("Unknown step");
}

function genRuntimeStep(step, baseUrlExpr) {
  if (step.open) return `await page.goto(${baseUrlExpr} + ${JSON.stringify(step.open)});`;
  if (step.click) return `await ${locatorExpr(step.click)}.click();`;
  if (step.fill) return `await ${locatorExpr(step.fill)}.fill(${JSON.stringify(step.fill.value)});`;
  if (step.select) return `await ${locatorExpr(step.select)}.selectOption(${JSON.stringify(step.select.value)});`;
  if (step.hover) return `await ${locatorExpr(step.hover)}.hover();`;
  if (step.wait_for) return `await page.waitForTimeout(${step.wait_for.ms ?? 250});`;
  if (step.route_block) {
    const { path: routePath, status } = step.route_block;
    return `await page.route(${JSON.stringify("**" + routePath)}, route => route.fulfill({ status: ${status}, body: "" }));`;
  }
  throw new Error("Unknown step");
}

export function assertExpr(a) {
  if (a.text_equals) {
    const { testid, equals } = a.text_equals;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(${JSON.stringify(equals)});`;
  }
  if (a.text_matches) {
    const { testid, regex } = a.text_matches;
    return `await expect(page.getByTestId(${JSON.stringify(testid)})).toHaveText(new RegExp(${JSON.stringify(regex)}));`;
  }
  if (a.visible) {
    return `await expect(page.getByTestId(${JSON.stringify(a.visible.testid)})).toBeVisible();`;
  }
  if (a.hidden) {
    return `await expect(page.getByTestId(${JSON.stringify(a.hidden.testid)})).toBeHidden();`;
  }
  if (a.url_matches) {
    return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(a.url_matches.regex)}));`;
  }
  if (a.count) {
    return `await expect(page.getByTestId(${JSON.stringify(a.count.testid)})).toHaveCount(${a.count.equals});`;
  }
  throw new Error("Unknown assert");
}

export function hasInteractiveUiFlow(steps = []) {
  return steps.some(step => step.click || step.fill || step.select || step.hover || step.route_block);
}

export function assertConditionExpr(a) {
  if (a.text_equals) {
    const { testid, equals } = a.text_equals;
    return `(await page.getByTestId(${JSON.stringify(testid)}).evaluateAll(nodes => ((nodes[0]?.textContent ?? "")).trim())) === ${JSON.stringify(equals)}`;
  }
  if (a.text_matches) {
    const { testid, regex } = a.text_matches;
    return `new RegExp(${JSON.stringify(regex)}).test(await page.getByTestId(${JSON.stringify(testid)}).evaluateAll(nodes => ((nodes[0]?.textContent ?? "")).trim()))`;
  }
  if (a.visible) {
    return `await page.getByTestId(${JSON.stringify(a.visible.testid)}).isVisible().catch(() => false)`;
  }
  if (a.hidden) {
    return `await page.getByTestId(${JSON.stringify(a.hidden.testid)}).isHidden().catch(() => false)`;
  }
  if (a.url_matches) {
    return `new RegExp(${JSON.stringify(a.url_matches.regex)}).test(page.url())`;
  }
  if (a.count) {
    return `(await page.getByTestId(${JSON.stringify(a.count.testid)}).count().catch(() => -1)) === ${a.count.equals}`;
  }
  return null;
}

function testUseOptions(check) {
  const context = check.visual?.context;
  if (!context) return null;
  const options = [];
  if (context.viewport) {
    options.push(`viewport: { width: ${context.viewport.width}, height: ${context.viewport.height} }`);
  }
  if (context.color_scheme) options.push(`colorScheme: ${JSON.stringify(context.color_scheme)}`);
  if (context.locale) options.push(`locale: ${JSON.stringify(context.locale)}`);
  if (context.timezone) options.push(`timezoneId: ${JSON.stringify(context.timezone)}`);
  if (context.device_scale_factor !== undefined) options.push(`deviceScaleFactor: ${context.device_scale_factor}`);
  options.push(`reducedMotion: ${JSON.stringify(context.reduced_motion ? "reduce" : "no-preference")}`);
  return options.length === 0 ? null : options;
}

function hasVisualChecks(check) {
  return Boolean(check.visual);
}

function visualHelperModule() {
  return [
    `const __filename = fileURLToPath(import.meta.url);`,
    `const __dirname = path.dirname(__filename);`,
    `const projectRoot = path.resolve(__dirname, "..", "..");`,
    `const evidenceRoot = path.resolve(process.env.SHIPFLOW_EVIDENCE_DIR || path.join(projectRoot, "evidence"));`,
    ``,
    `function safePathSegment(value) {`,
    `  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");`,
    `}`,
    ``,
    `function ensureDir(dir) {`,
    `  fs.mkdirSync(dir, { recursive: true });`,
    `}`,
    ``,
    `function baselinePathFor(checkId, snapshotName) {`,
    `  return path.join(projectRoot, "vp", "ui", "_baselines", safePathSegment(checkId), \`\${safePathSegment(snapshotName)}.png\`);`,
    `}`,
    ``,
    `function artifactPathsFor(checkId, snapshotName) {`,
    `  const root = path.join(evidenceRoot, "visual", safePathSegment(checkId), safePathSegment(snapshotName));`,
    `  return {`,
    `    root,`,
    `    expected: path.join(root, "expected.png"),`,
    `    actual: path.join(root, "actual.png"),`,
    `    diff: path.join(root, "diff.png"),`,
    `    metrics: path.join(root, "metrics.json"),`,
    `  };`,
    `}`,
    ``,
    `async function waitForVisualFonts(page) {`,
    `  await page.evaluate(async () => {`,
    `    if (document.fonts?.ready) await document.fonts.ready;`,
    `  });`,
    `}`,
    ``,
    `function requireTarget(targets, name) {`,
    `  const target = targets[name];`,
    `  if (!target) throw new Error(\`Unknown visual target "\${name}"\`);`,
    `  return target;`,
    `}`,
    ``,
    `async function requireBox(targets, name) {`,
    `  const box = await requireTarget(targets, name).boundingBox();`,
    `  if (!box) throw new Error(\`Visual target "\${name}" is not rendered\`);`,
    `  return box;`,
    `}`,
    ``,
    `function axisValue(box, axis) {`,
    `  if (axis === "left") return box.x;`,
    `  if (axis === "right") return box.x + box.width;`,
    `  if (axis === "top") return box.y;`,
    `  if (axis === "bottom") return box.y + box.height;`,
    `  if (axis === "center-x") return box.x + (box.width / 2);`,
    `  if (axis === "center-y") return box.y + (box.height / 2);`,
    `  throw new Error(\`Unknown alignment axis "\${axis}"\`);`,
    `}`,
    ``,
    `async function readCssValue(target, property) {`,
    `  return target.evaluate((element, cssProperty) => getComputedStyle(element).getPropertyValue(cssProperty).trim(), property);`,
    `}`,
    ``,
    `async function resolveTokenValue(target, property, token) {`,
    `  return target.evaluate((element, payload) => {`,
    `    const computed = getComputedStyle(element);`,
    `    const tokenValue = computed.getPropertyValue(payload.token).trim();`,
    `    if (!tokenValue) return { actual: computed.getPropertyValue(payload.property).trim(), resolved: "" };`,
    `    const sandbox = document.createElement("div");`,
    `    sandbox.style.position = "absolute";`,
    `    sandbox.style.left = "-9999px";`,
    `    sandbox.style.top = "-9999px";`,
    `    sandbox.style.pointerEvents = "none";`,
    `    sandbox.style.opacity = "0";`,
    `    sandbox.style.setProperty(payload.token, tokenValue);`,
    `    sandbox.style.setProperty(payload.property, \`var(\${payload.token})\`);`,
    `    document.body.appendChild(sandbox);`,
    `    const resolved = getComputedStyle(sandbox).getPropertyValue(payload.property).trim();`,
    `    sandbox.remove();`,
    `    return { actual: computed.getPropertyValue(payload.property).trim(), resolved: resolved || tokenValue };`,
    `  }, { property, token });`,
    `}`,
    ``,
    `async function runVisualAssertion(targets, assertion) {`,
    `  if (assertion.aligned) {`,
    `    const boxes = [];`,
    `    for (const item of assertion.aligned.items) boxes.push(await requireBox(targets, item));`,
    `    const reference = axisValue(boxes[0], assertion.aligned.axis);`,
    `    for (let index = 1; index < boxes.length; index += 1) {`,
    `      const actual = axisValue(boxes[index], assertion.aligned.axis);`,
    `      expect(Math.abs(actual - reference), \`Expected \${assertion.aligned.items[index]} to align on \${assertion.aligned.axis}\`).toBeLessThanOrEqual(assertion.aligned.tolerance_px);`,
    `    }`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.spacing) {`,
    `    const fromBox = await requireBox(targets, assertion.spacing.from);`,
    `    const toBox = await requireBox(targets, assertion.spacing.to);`,
    `    const delta = assertion.spacing.axis === "x"`,
    `      ? toBox.x - (fromBox.x + fromBox.width)`,
    `      : toBox.y - (fromBox.y + fromBox.height);`,
    `    expect(delta, \`Expected spacing between \${assertion.spacing.from} and \${assertion.spacing.to} to be >= \${assertion.spacing.min_px}px\`).toBeGreaterThanOrEqual(assertion.spacing.min_px);`,
    `    expect(delta, \`Expected spacing between \${assertion.spacing.from} and \${assertion.spacing.to} to be <= \${assertion.spacing.max_px}px\`).toBeLessThanOrEqual(assertion.spacing.max_px);`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.size_range) {`,
    `    const box = await requireBox(targets, assertion.size_range.target);`,
    `    if (assertion.size_range.width?.min_px !== undefined) {`,
    `      expect(box.width, \`Expected \${assertion.size_range.target} width >= \${assertion.size_range.width.min_px}px\`).toBeGreaterThanOrEqual(assertion.size_range.width.min_px);`,
    `    }`,
    `    if (assertion.size_range.width?.max_px !== undefined) {`,
    `      expect(box.width, \`Expected \${assertion.size_range.target} width <= \${assertion.size_range.width.max_px}px\`).toBeLessThanOrEqual(assertion.size_range.width.max_px);`,
    `    }`,
    `    if (assertion.size_range.height?.min_px !== undefined) {`,
    `      expect(box.height, \`Expected \${assertion.size_range.target} height >= \${assertion.size_range.height.min_px}px\`).toBeGreaterThanOrEqual(assertion.size_range.height.min_px);`,
    `    }`,
    `    if (assertion.size_range.height?.max_px !== undefined) {`,
    `      expect(box.height, \`Expected \${assertion.size_range.target} height <= \${assertion.size_range.height.max_px}px\`).toBeLessThanOrEqual(assertion.size_range.height.max_px);`,
    `    }`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.inside) {`,
    `    const inner = await requireBox(targets, assertion.inside.inner);`,
    `    const outer = await requireBox(targets, assertion.inside.outer);`,
    `    const tolerance = assertion.inside.tolerance_px;`,
    `    expect(inner.x, \`Expected \${assertion.inside.inner} to stay inside \${assertion.inside.outer}\`).toBeGreaterThanOrEqual(outer.x - tolerance);`,
    `    expect(inner.y, \`Expected \${assertion.inside.inner} to stay inside \${assertion.inside.outer}\`).toBeGreaterThanOrEqual(outer.y - tolerance);`,
    `    expect(inner.x + inner.width, \`Expected \${assertion.inside.inner} to stay inside \${assertion.inside.outer}\`).toBeLessThanOrEqual(outer.x + outer.width + tolerance);`,
    `    expect(inner.y + inner.height, \`Expected \${assertion.inside.inner} to stay inside \${assertion.inside.outer}\`).toBeLessThanOrEqual(outer.y + outer.height + tolerance);`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.not_overlapping) {`,
    `    const a = await requireBox(targets, assertion.not_overlapping.a);`,
    `    const b = await requireBox(targets, assertion.not_overlapping.b);`,
    `    const tolerance = assertion.not_overlapping.tolerance_px;`,
    `    const overlaps = !(`,
    `      (a.x + a.width) <= (b.x + tolerance) ||`,
    `      (b.x + b.width) <= (a.x + tolerance) ||`,
    `      (a.y + a.height) <= (b.y + tolerance) ||`,
    `      (b.y + b.height) <= (a.y + tolerance)`,
    `    );`,
    `    expect(overlaps, \`Expected \${assertion.not_overlapping.a} and \${assertion.not_overlapping.b} not to overlap\`).toBe(false);`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.css_equals) {`,
    `    const value = await readCssValue(requireTarget(targets, assertion.css_equals.target), assertion.css_equals.property);`,
    `    expect(value, \`Expected \${assertion.css_equals.target} \${assertion.css_equals.property}\`).toBe(assertion.css_equals.equals);`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.css_matches) {`,
    `    const value = await readCssValue(requireTarget(targets, assertion.css_matches.target), assertion.css_matches.property);`,
    `    expect(value, \`Expected \${assertion.css_matches.target} \${assertion.css_matches.property} to match \${assertion.css_matches.regex}\`).toMatch(new RegExp(assertion.css_matches.regex));`,
    `    return;`,
    `  }`,
    ``,
    `  if (assertion.token_resolves) {`,
    `    const values = await resolveTokenValue(requireTarget(targets, assertion.token_resolves.target), assertion.token_resolves.property, assertion.token_resolves.token);`,
    `    expect(values.resolved, \`Expected \${assertion.token_resolves.token} to resolve for \${assertion.token_resolves.target}\`).not.toBe("");`,
    `    expect(values.actual, \`Expected \${assertion.token_resolves.target} \${assertion.token_resolves.property} to match \${assertion.token_resolves.token}\`).toBe(values.resolved);`,
    `    return;`,
    `  }`,
    ``,
    `  throw new Error("Unknown visual assertion");`,
    `}`,
    ``,
    `async function compareSnapshot(page, targets, mask, checkId, snapshot) {`,
    `  const baselinePath = baselinePathFor(checkId, snapshot.name);`,
    `  const artifacts = artifactPathsFor(checkId, snapshot.name);`,
    `  ensureDir(path.dirname(baselinePath));`,
    `  ensureDir(artifacts.root);`,
    ``,
    `  const screenshotOptions = { animations: "disabled", scale: "css", mask };`,
    `  const actualBuffer = snapshot.full_page`,
    `    ? await page.screenshot({ ...screenshotOptions, fullPage: true })`,
    `    : await requireTarget(targets, snapshot.target).screenshot(screenshotOptions);`,
    ``,
    `  if (process.env.SHIPFLOW_APPROVE_VISUAL === "1") {`,
    `    fs.writeFileSync(baselinePath, actualBuffer);`,
    `    return;`,
    `  }`,
    ``,
    `  if (!fs.existsSync(baselinePath)) {`,
    `    fs.writeFileSync(artifacts.actual, actualBuffer);`,
    `    fs.writeFileSync(artifacts.metrics, JSON.stringify({`,
    `      version: 1,`,
    `      status: "baseline_missing",`,
    `      check_id: checkId,`,
    `      snapshot: snapshot.name,`,
    `      baseline: path.relative(projectRoot, baselinePath).replaceAll("\\\\", "/"),`,
    `    }, null, 2));`,
    `    throw new Error(\`Visual baseline missing for \${checkId}/\${snapshot.name}: \${path.relative(projectRoot, baselinePath)}\`);`,
    `  }`,
    ``,
    `  const expectedBuffer = fs.readFileSync(baselinePath);`,
    `  fs.writeFileSync(artifacts.expected, expectedBuffer);`,
    `  fs.writeFileSync(artifacts.actual, actualBuffer);`,
    ``,
    `  const expected = PNG.sync.read(expectedBuffer);`,
    `  const actual = PNG.sync.read(actualBuffer);`,
    `  if (expected.width !== actual.width || expected.height !== actual.height) {`,
    `    fs.writeFileSync(artifacts.metrics, JSON.stringify({`,
    `      version: 1,`,
    `      status: "dimension_mismatch",`,
    `      check_id: checkId,`,
    `      snapshot: snapshot.name,`,
    `      expected: { width: expected.width, height: expected.height },`,
    `      actual: { width: actual.width, height: actual.height },`,
    `    }, null, 2));`,
    `    throw new Error(\`Visual snapshot dimensions changed for \${checkId}/\${snapshot.name}: expected \${expected.width}x\${expected.height}, got \${actual.width}x\${actual.height}\`);`,
    `  }`,
    ``,
    `  const diff = new PNG({ width: expected.width, height: expected.height });`,
    `  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: snapshot.per_pixel_threshold });`,
    `  fs.writeFileSync(artifacts.diff, PNG.sync.write(diff));`,
    ``,
    `  const totalPixels = expected.width * expected.height;`,
    `  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;`,
    `  const metrics = {`,
    `    version: 1,`,
    `    status: "compared",`,
    `    check_id: checkId,`,
    `    snapshot: snapshot.name,`,
    `    width: expected.width,`,
    `    height: expected.height,`,
    `    diff_pixels: diffPixels,`,
    `    diff_ratio: diffRatio,`,
    `    thresholds: {`,
    `      max_diff_ratio: snapshot.max_diff_ratio,`,
    `      max_diff_pixels: snapshot.max_diff_pixels ?? null,`,
    `      per_pixel_threshold: snapshot.per_pixel_threshold,`,
    `    },`,
    `  };`,
    `  fs.writeFileSync(artifacts.metrics, JSON.stringify(metrics, null, 2));`,
    ``,
    `  expect(diffRatio, \`Expected visual diff ratio for \${checkId}/\${snapshot.name} <= \${snapshot.max_diff_ratio}\`).toBeLessThanOrEqual(snapshot.max_diff_ratio);`,
    `  if (snapshot.max_diff_pixels !== undefined) {`,
    `    expect(diffPixels, \`Expected visual diff pixels for \${checkId}/\${snapshot.name} <= \${snapshot.max_diff_pixels}\`).toBeLessThanOrEqual(snapshot.max_diff_pixels);`,
    `  }`,
    `}`,
    ``,
    `async function runVisualChecks(page, checkId, targets, visual) {`,
    `  if (visual.context.wait_for_fonts) await waitForVisualFonts(page);`,
    `  const mask = (visual.context.mask || []).map(locator => {`,
    `    if (locator.testid) return page.getByTestId(locator.testid);`,
    `    if (locator.label) return page.getByLabel(locator.label);`,
    `    if (locator.name_regex) return page.getByRole(locator.role, { name: new RegExp(locator.name) });`,
    `    return page.getByRole(locator.role, { name: locator.name });`,
    `  });`,
    `  for (const assertion of visual.assertions || []) await runVisualAssertion(targets, assertion);`,
    `  for (const snapshot of visual.snapshots || []) await compareSnapshot(page, targets, mask, checkId, snapshot);`,
    `}`,
    ``,
  ].join("\n");
}

function targetExprMap(targets = {}) {
  const lines = [`{`];
  for (const [name, locator] of Object.entries(targets)) {
    lines.push(`    ${JSON.stringify(name)}: ${locatorExpr(locator)},`);
  }
  lines.push(`  }`);
  return lines.join("\n");
}

function visualRunnerExpr(check) {
  return [
    `  const visualTargets = ${targetExprMap(check.targets)};`,
    `  await runVisualChecks(page, ${JSON.stringify(check.id)}, visualTargets, ${JSON.stringify(check.visual)});`,
  ].join("\n");
}

export function genPlaywrightTest(check, fixturesMap) {
  const baseUrl = check.app.base_url;
  const title = `${check.id}: ${check.title}`;
  const mutationGuardConditions = check.assert.map(assertConditionExpr).filter(Boolean);
  const L = [];
  L.push(`import { test, expect } from "@playwright/test";`);
  if (usesStateRuntime(check)) {
    pushStateRuntime(L);
  }
  if (hasVisualChecks(check)) {
    L.push(`import fs from "node:fs";`);
    L.push(`import path from "node:path";`);
    L.push(`import { fileURLToPath } from "node:url";`);
    L.push(`import { PNG } from "pngjs";`);
    L.push(`import pixelmatch from "pixelmatch";`);
  }
  L.push(``);
  L.push(`const shipflowBaseUrl = process.env.SHIPFLOW_BASE_URL || ${JSON.stringify(baseUrl)};`);
  L.push(``);
  const useOptions = testUseOptions(check);
  if (useOptions) {
    L.push(`test.use({`);
    for (const option of useOptions) L.push(`  ${option},`);
    L.push(`});`);
    L.push(``);
  }
  if (hasVisualChecks(check)) {
    L.push(visualHelperModule());
  }
  L.push(`test(${JSON.stringify(title)}, async ({ page }) => {`);
  if (check.state) {
    L.push(`  resetShipFlowState(${JSON.stringify(check.state)});`);
  }
  L.push(`  await page.goto(shipflowBaseUrl);`);

  if (check.setup) {
    const fixture = fixturesMap?.get(check.setup);
    if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
    L.push(`  // setup: ${check.setup}`);
    for (const step of fixture.flow) {
      L.push(`  ${genRuntimeStep(step, "shipflowBaseUrl")}`);
    }
  }

  for (const step of check.flow) {
    L.push(`  ${genRuntimeStep(step, "shipflowBaseUrl")}`);
  }
  for (const a of check.assert) L.push(`  ${assertExpr(a)}`);
  if (hasVisualChecks(check)) L.push(visualRunnerExpr(check));
  L.push(`});`);
  L.push(``);

  if (hasInteractiveUiFlow(check.flow) && mutationGuardConditions.length > 0) {
    L.push(`test(${JSON.stringify(`${title} [mutation guard]`)}, async ({ page }) => {`);
    if (check.state) {
      L.push(`  resetShipFlowState(${JSON.stringify(check.state)});`);
    }
    L.push(`  await page.goto(shipflowBaseUrl);`);

    if (check.setup) {
      const fixture = fixturesMap?.get(check.setup);
      if (!fixture) throw new Error(`Unknown fixture "${check.setup}" referenced in ${check.id}`);
      L.push(`  // setup: ${check.setup}`);
      for (const step of fixture.flow) {
        L.push(`  ${genRuntimeStep(step, "shipflowBaseUrl")}`);
      }
    }

    for (const step of check.flow) {
      if (step.click || step.fill || step.select || step.hover) break;
      L.push(`  ${genRuntimeStep(step, "shipflowBaseUrl")}`);
    }

    L.push(`  const mutationGuardPasses = [`);
    for (const condition of mutationGuardConditions) {
      L.push(`    ${condition},`);
    }
    L.push(`  ].every(Boolean);`);
    L.push(`  expect(mutationGuardPasses).toBe(false);`);
    L.push(`});`);
    L.push(``);
  }

  return L.join("\n");
}

export function readUiFixtures(vpDir) {
  const fixturesDir = path.join(vpDir, "ui", "_fixtures");
  if (!fs.existsSync(fixturesDir)) return [];
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(fixturesDir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      return UiFixture.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/ui/_fixtures/${f}`, err);
      throw err;
    }
  });
}

export function readUiChecks(vpDir) {
  const uiDir = path.join(vpDir, "ui");
  if (!fs.existsSync(uiDir)) return [];
  const files = fs.readdirSync(uiDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map(f => {
    const full = path.join(uiDir, f);
    const raw = yaml.load(fs.readFileSync(full, "utf-8"));
    try {
      const parsed = UiCheck.parse(raw);
      parsed.__file = `vp/ui/${f}`;
      return parsed;
    } catch (err) {
      if (err instanceof z.ZodError) throw formatZodError(`vp/ui/${f}`, err);
      throw err;
    }
  });
}
