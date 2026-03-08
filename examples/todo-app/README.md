# Todo App — ShipFlow Example

This example demonstrates the full ShipFlow loop: **define verifications → generate tests → AI implements → verify → loop until green**.

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
/shipflow-impl
```

## Manual steps

```bash
shipflow gen       # Compile vp/ → .gen/playwright/*.test.ts
shipflow verify    # Run tests → evidence/run.json
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
