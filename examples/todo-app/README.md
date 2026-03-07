# Todo App — ShipFlow Example

This example demonstrates the full ShipFlow loop: **define specs → generate tests → AI implements → verify → loop until green**.

No human writes app code. The `src/` directory starts empty and is generated entirely by the AI.

## Structure

```
todo-app/
  shipflow.json              # ShipFlow config (model, srcDir, context)
  playwright.config.ts       # Playwright config (pre-existing)
  package.json               # Scripts and dependencies
  vp/                        # Verification Pack (human-written)
    ui/
      add-todo.yml           # Spec: add a todo item
      complete-todo.yml      # Spec: mark a todo as complete
      filter-todos.yml       # Spec: filter todos by status
      _fixtures/
        login.yml            # Reusable login flow
  src/                       # App code (AI-generated, starts empty)
  .gen/                      # Generated Playwright tests
  evidence/                  # Verification results
```

## Run the full loop

```bash
# Install dependencies
npm install
npx playwright install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run the full loop: gen → AI impl → verify → retry if needed
npm run shipflow:run
```

ShipFlow will:
1. Compile `vp/` specs into Playwright tests (`.gen/`)
2. Call Claude to generate the app code (`src/`)
3. Run Playwright to verify the implementation
4. If tests fail, feed errors back to Claude and retry
5. Stop when all tests pass (or after max iterations)

## Step by step (manual)

```bash
# 1. Generate tests from VP
npm run shipflow:gen

# 2. AI generates app code
npm run shipflow:impl

# 3. Verify the implementation
npm run shipflow:verify
```

## Configuration

`shipflow.json` controls the AI implementation:

```json
{
  "impl": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 16384,
    "maxIterations": 5,
    "srcDir": "src",
    "context": "Build a Node.js HTTP server..."
  }
}
```

| Field | Default | Description |
|---|---|---|
| `model` | `claude-sonnet-4-20250514` | Claude model for code generation |
| `maxTokens` | `16384` | Max output tokens per AI call |
| `maxIterations` | `5` | Max gen→impl→verify loops |
| `srcDir` | `src` | Directory the AI can write to |
| `context` | — | Project-specific instructions for the AI |
