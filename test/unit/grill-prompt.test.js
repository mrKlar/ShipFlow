import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGrillPrompt,
  buildLocalGrillTemplate,
  roleGuidance,
  GRILL_ROLES,
} from "../../lib/grill-prompt.js";

describe("grill-prompt", () => {
  it("buildLocalGrillTemplate returns at least 3 questions and 1 finding", () => {
    const t = buildLocalGrillTemplate({ intent: "anything", role: "general" });
    assert.ok(t.questions.length >= 3);
    assert.ok(t.findings.length >= 1);
    assert.equal(Array.isArray(t.proposed_decisions), true);
  });

  it("buildGrillPrompt embeds the intent and role and the JSON contract", () => {
    const prompt = buildGrillPrompt({ intent: "Build retroactive points refund", role: "security" });
    assert.match(prompt, /retroactive points refund/);
    assert.match(prompt, /Active role lens: security/);
    assert.match(prompt, /Return ONLY valid JSON/);
    assert.match(prompt, /proposed_decisions/);
  });

  it("roleGuidance covers all GRILL_ROLES with non-empty must_ask", () => {
    for (const role of GRILL_ROLES) {
      const g = roleGuidance(role);
      assert.ok(g.summary, `role ${role} missing summary`);
      assert.ok(Array.isArray(g.must_ask) && g.must_ask.length >= 3, `role ${role} must_ask too small`);
      assert.ok(g.finding_focus, `role ${role} missing finding_focus`);
    }
  });

  it("buildGrillPrompt for security includes trust boundary phrasing", () => {
    const prompt = buildGrillPrompt({ intent: "Add data export consent", role: "security" });
    assert.match(prompt, /trust boundary/i);
    assert.match(prompt, /abuse case/i);
    assert.match(prompt, /Active role lens: security/);
  });

  it("buildGrillPrompt for product includes outcome and non-goal phrasing", () => {
    const prompt = buildGrillPrompt({ intent: "Add filter sidebar", role: "product" });
    assert.match(prompt, /outcome/i);
    assert.match(prompt, /NOT to support/i);
  });

  it("buildLocalGrillTemplate for risk produces risk-flavored questions", () => {
    const t = buildLocalGrillTemplate({ intent: "Bulk-delete inactive users", role: "risk" });
    assert.ok(t.questions.length >= 3);
    const joined = t.questions.map(q => q.question).join(" ");
    assert.match(joined, /irreversible|rollback|blast radius|monitoring/i);
  });

  it("buildGrillPrompt with parent context embeds prior questions and findings", () => {
    const parent = {
      questions: [{ id: "q-prior", topic: "outcome", question: "Old Q?" }],
      findings: [{ id: "f-prior", kind: "assumption", text: "Old assumption" }],
      proposed_decisions: [],
    };
    const prompt = buildGrillPrompt({ intent: "Follow-up scope", role: "qa", parent });
    assert.match(prompt, /Prior session context/);
    assert.match(prompt, /Old Q\?/);
    assert.match(prompt, /Old assumption/);
  });

  it("roleGuidance falls back to general for unknown roles", () => {
    const g = roleGuidance("captain");
    const general = roleGuidance("general");
    assert.deepEqual(g, general);
  });

  it("GrillQuestion / GrillFinding ids must be kebab-case (matches the prompt contract)", async () => {
    const { GrillQuestion, GrillFinding } = await import("../../lib/schema/grill.zod.js");
    // Valid kebab passes
    assert.doesNotThrow(() => GrillQuestion.parse({
      id: "q-outcome", topic: "outcome", question: "Q?",
    }));
    assert.doesNotThrow(() => GrillFinding.parse({
      id: "f-edge-1", kind: "edge_case", text: "T",
    }));
    // Spaces, uppercase, leading/trailing dashes all rejected
    assert.throws(() => GrillQuestion.parse({ id: "q 1", topic: "t", question: "?" }));
    assert.throws(() => GrillQuestion.parse({ id: "Q-1", topic: "t", question: "?" }));
    assert.throws(() => GrillFinding.parse({ id: "-bad", kind: "risk", text: "T" }));
    assert.throws(() => GrillFinding.parse({ id: "bad-", kind: "risk", text: "T" }));
  });
});
