import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DbCheck } from "../../lib/schema/db-check.zod.js";
import { dbAssertExpr, genDbTest } from "../../lib/gen-db.js";

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

describe("genDbTest", () => {
  it("generates sqlite test with helpers", () => {
    const check = { ...base, assert: [{ row_count: 1 }] };
    const code = genDbTest(check);
    assert.ok(code.includes('import { execFileSync }'));
    assert.ok(code.includes("sqlite3"));
    assert.ok(code.includes("-json"));
    assert.ok(code.includes("function query(sql)"));
    assert.ok(code.includes("toHaveLength(1)"));
  });

  it("generates postgresql test with json_agg wrapper", () => {
    const check = {
      ...base,
      app: { kind: "db", engine: "postgresql", connection: "postgresql://localhost/test" },
      assert: [{ row_count: 2 }],
    };
    const code = genDbTest(check);
    assert.ok(code.includes("psql"));
    assert.ok(code.includes("json_agg"));
    assert.ok(code.includes("row_to_json"));
  });

  it("generates setup_sql execution", () => {
    const check = {
      ...base,
      setup_sql: "INSERT INTO users VALUES ('x');",
      assert: [],
    };
    const code = genDbTest(check);
    assert.ok(code.includes("exec("));
    assert.ok(code.includes("INSERT INTO users"));
  });

  it("generates cell assertions", () => {
    const check = {
      ...base,
      assert: [
        { cell_equals: { row: 0, column: "name", equals: "Alice" } },
        { cell_matches: { row: 0, column: "email", matches: "@test" } },
      ],
    };
    const code = genDbTest(check);
    assert.ok(code.includes('rows[0]["name"]'));
    assert.ok(code.includes("toMatch"));
  });
});
