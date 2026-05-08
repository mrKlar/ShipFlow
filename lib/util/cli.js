import path from "node:path";

export function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      flags[arg.slice(2)] = true;
      continue;
    }
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    if (flags[key] === undefined) flags[key] = val;
    else if (Array.isArray(flags[key])) flags[key].push(val);
    else flags[key] = [flags[key], val];
  }
  return flags;
}

export function ensureArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function flagListAsArray(flags, name) {
  return ensureArray(flags[name])
    .flatMap(v => String(v).split(","))
    .map(s => s.trim())
    .filter(Boolean);
}

export function relPath(cwd, file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}
