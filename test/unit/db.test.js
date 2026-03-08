import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DbCheck } from "../../lib/schema/db-check.zod.js";
import { dbAssertExpr, genDbSpec } from "../../lib/gen-db.js";

const base = {
  id: "users-check",
  title: "Users exist",
  severity: "blocker",
  app: { kind: "db", engine: "sqlite", connection: "./test.db" },
  query: "SELECT * FROM users",
};

describe("DbCheck schema", () => {
  it("accepts valid DB check", () => {
    const r = DbCheck.parse({ ...base, assert: [{ row_count: 1 }] });
    assert.equal(r.id, "users-check");
    assert.equal(r.app.engine, "sqlite");
  });

  it("accepts postgresql engine", () => {
    const r = DbCheck.parse({
      ...base,
      app: { kind: "db", engine: "postgresql", connection: "postgresql://localhost/test" },
      assert: [],
    });
    assert.equal(r.app.engine, "postgresql");
  });

  it("accepts setup_sql", () => {
    const r = DbCheck.parse({
      ...base,
      setup_sql: "INSERT INTO users VALUES ('test');",
      assert: [],
    });
    assert.equal(r.setup_sql, "INSERT INTO users VALUES ('test');");
  });

  it("accepts all assert types", () => {
    const r = DbCheck.parse({
      ...base,
      assert: [
        { row_count: 3 },
        { cell_equals: { row: 0, column: "name", equals: "Alice" } },
        { cell_matches: { row: 1, column: "email", matches: "@test\\.com$" } },
        { column_contains: { column: "name", value: "Bob" } },
      ],
    });
    assert.equal(r.assert.length, 4);
  });

  it("rejects negative row_count", () => {
    assert.throws(() => {
      DbCheck.parse({ ...base, assert: [{ row_count: -1 }] });
    });
  });

  it("rejects unsupported engine", () => {
    assert.throws(() => {
      DbCheck.parse({
        ...base,
        app: { kind: "db", engine: "oracle", connection: "x" },
        assert: [],
      });
    });
  });

  it("rejects unknown assert", () => {
    assert.throws(() => {
      DbCheck.parse({ ...base, assert: [{ unknown: true }] });
    });
  });
});

describe("dbAssertExpr", () => {
  it("generates row_count", () => {
    assert.equal(dbAssertExpr({ row_count: 3 }), "expect(rows).toHaveLength(3);");
  });

  it("generates cell_equals", () => {
    const r = dbAssertExpr({ cell_equals: { row: 0, column: "name", equals: "Alice" } });
    assert.ok(r.includes('rows[0]["name"]'));
    assert.ok(r.includes('.toBe("Alice")'));
  });

  it("generates cell_matches", () => {
    const r = dbAssertExpr({ cell_matches: { row: 1, column: "email", matches: "@test" } });
    assert.ok(r.includes("rows[1]"));
    assert.ok(r.includes("toMatch"));
  });

  it("generates column_contains", () => {
    const r = dbAssertExpr({ column_contains: { column: "name", value: "Bob" } });
    assert.ok(r.includes("rows.some"));
    assert.ok(r.includes('"name"'));
    assert.ok(r.includes('"Bob"'));
  });

  it("throws on unknown assert", () => {
    assert.throws(() => dbAssertExpr({ unknown: {} }), /Unknown DB assert/);
  });
});

describe("genDbSpec", () => {
  it("generates sqlite test with helpers", () => {
    const check = { ...base, assert: [{ row_count: 1 }] };
    const spec = genDbSpec(check);
    assert.ok(spec.includes('import { execFileSync }'));
    assert.ok(spec.includes("sqlite3"));
    assert.ok(spec.includes("-json"));
    assert.ok(spec.includes("function query(sql)"));
    assert.ok(spec.includes("toHaveLength(1)"));
  });

  it("generates postgresql test with json_agg wrapper", () => {
    const check = {
      ...base,
      app: { kind: "db", engine: "postgresql", connection: "postgresql://localhost/test" },
      assert: [{ row_count: 2 }],
    };
    const spec = genDbSpec(check);
    assert.ok(spec.includes("psql"));
    assert.ok(spec.includes("json_agg"));
    assert.ok(spec.includes("row_to_json"));
  });

  it("generates setup_sql execution", () => {
    const check = {
      ...base,
      setup_sql: "INSERT INTO users VALUES ('x');",
      assert: [],
    };
    const spec = genDbSpec(check);
    assert.ok(spec.includes("exec("));
    assert.ok(spec.includes("INSERT INTO users"));
  });

  it("generates cell assertions", () => {
    const check = {
      ...base,
      assert: [
        { cell_equals: { row: 0, column: "name", equals: "Alice" } },
        { cell_matches: { row: 0, column: "email", matches: "@test" } },
      ],
    };
    const spec = genDbSpec(check);
    assert.ok(spec.includes('rows[0]["name"]'));
    assert.ok(spec.includes("toMatch"));
  });
});
