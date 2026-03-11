export function usesStateRuntime(checkOrScenarios) {
  if (!checkOrScenarios) return false;
  if (Array.isArray(checkOrScenarios)) {
    return checkOrScenarios.some(item => Boolean(item?.state));
  }
  return Boolean(checkOrScenarios.state);
}

export function pushStateRuntime(lines) {
  lines.push(`import { DatabaseSync } from "node:sqlite";`);
  lines.push(``);
  lines.push(`function resetShipFlowState(state) {`);
  lines.push(`  if (!state) return;`);
  lines.push(`  if (state.kind === "sqlite") {`);
  lines.push(`    const db = new DatabaseSync(state.connection);`);
  lines.push(`    try {`);
  lines.push(`      db.exec("PRAGMA busy_timeout = 5000");`);
  lines.push(`      db.exec(state.reset_sql);`);
  lines.push(`    } finally {`);
  lines.push(`      db.close();`);
  lines.push(`    }`);
  lines.push(`    return;`);
  lines.push(`  }`);
  lines.push(`  throw new Error("Unsupported ShipFlow state kind: " + String(state.kind || "unknown"));`);
  lines.push(`}`);
  lines.push(``);
}
