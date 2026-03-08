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
shipflow draft     # Co-draft the verification pack
shipflow implement # Standard loop: validate, generate, implement, verify
shipflow gen       # Advanced: generate .gen/playwright/*.test.ts
shipflow verify    # Advanced: run generated tests and write evidence
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
