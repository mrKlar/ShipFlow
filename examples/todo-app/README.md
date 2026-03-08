# Todo App — ShipFlow Example

This example demonstrates the normal ShipFlow loop: **define verifications → `shipflow implement` → green**.

No human writes app code. The `src/` directory starts empty and is generated entirely by the AI.

## Structure

```
todo-app/
  shipflow.json              # ShipFlow config
  playwright.config.ts       # Playwright config
  package.json               # Dependencies
  vp/                        # Verification Pack (human-written)
    ui/
      add-todo.yml           # Verification: add a todo item
      complete-todo.yml      # Verification: mark a todo as complete
      filter-todos.yml       # Verification: filter todos by status
    technical/
      ci-stack.yml           # Verification: local technical stack stays in place
      _fixtures/
        login.yml            # Reusable login flow
  src/                       # App code (AI-generated, starts empty)
  .gen/                      # Generated Playwright tests
  evidence/                  # Verification results
```

## Quick start

```bash
# Install dependencies
npm install
npx playwright install

# Initialize ShipFlow
shipflow init
```

Then open the project in Claude Code and run:

```
/shipflow-implement
```

## Manual steps

```bash
shipflow draft     # Analyze the repo and propose starter VP files
shipflow implement # Normal loop: doctor → lint → gen → implement → verify
shipflow gen       # Compile vp/ → .gen/playwright/*.test.ts
shipflow verify    # Run tests → evidence/*.json
```

## Configuration

`shipflow.json`:

```json
{
  "impl": {
    "srcDir": "src",
    "context": "Node.js HTTP server, built-in modules only"
  }
}
```
