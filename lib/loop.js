import { gen } from "./gen.js";
import { verify } from "./verify.js";
import { impl } from "./impl.js";
import { readConfig } from "./impl.js";

export async function run({ cwd }) {
  const config = readConfig(cwd);
  const maxIterations = config.impl?.maxIterations || 5;

  console.log("=== ShipFlow run: generating tests from VP ===\n");
  await gen({ cwd });

  let errors = null;

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`\n=== ShipFlow run: iteration ${i}/${maxIterations} — impl ===\n`);
    await impl({ cwd, errors });

    console.log(`\n=== ShipFlow run: iteration ${i}/${maxIterations} — verify ===\n`);
    const { exitCode, output } = await verify({ cwd, capture: true });

    if (exitCode === 0) {
      console.log(`\n=== ShipFlow run: PASS — all checks green (iteration ${i}) ===\n`);
      return 0;
    }

    errors = output;
    console.log(`\n=== ShipFlow run: FAIL — iteration ${i}, ${maxIterations - i} retries left ===\n`);
  }

  console.error(`\n=== ShipFlow run: FAILED after ${maxIterations} iterations ===\n`);
  return 1;
}
