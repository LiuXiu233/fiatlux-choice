import { advisorKeySchema } from "@fiatlux/contracts";
import { ADVISOR_DATA_SCOPES } from "@fiatlux/domain";
import { describe, expect, it } from "vitest";

import {
  ADVISOR_EVALUATION_CASES,
  ADVISOR_PROMPTS,
  renderAdvisorSystemPrompt,
} from "../src/advisor-prompts.js";

describe("specialized advisor prompt catalogue", () => {
  it("defines distinct, guarded prompts and evaluation cases for all seven advisors", () => {
    const advisorKeys = advisorKeySchema.options;
    expect(Object.keys(ADVISOR_PROMPTS).sort()).toEqual([...advisorKeys].sort());
    expect(new Set(ADVISOR_EVALUATION_CASES.map((item) => item.advisor))).toEqual(
      new Set(advisorKeys),
    );

    const rendered = advisorKeys.map((key) => renderAdvisorSystemPrompt(ADVISOR_PROMPTS[key]));
    expect(new Set(rendered)).toHaveLength(advisorKeys.length);
    for (const prompt of rendered) {
      expect(prompt).toContain("not a general-purpose chatbot");
      expect(prompt).toContain("permission-filtered company context");
      expect(prompt).toContain("untrusted data");
      expect(prompt).toContain("human approval step");
      expect(prompt).toContain("required advisor output schema");
    }
  });

  it("keeps domain scopes and adversarial evaluation expectations explicit", () => {
    for (const key of advisorKeySchema.options) {
      expect(ADVISOR_PROMPTS[key].scopes).toBe(ADVISOR_DATA_SCOPES[key]);
    }
    expect(ADVISOR_PROMPTS.legal_compliance.scopes).toContain("compliance-events");
    expect(ADVISOR_PROMPTS.market_opportunity.scopes).toContain("projects");
    expect(ADVISOR_PROMPTS.information_security.scopes).toContain("audit-events");

    for (const evaluation of ADVISOR_EVALUATION_CASES) {
      expect(evaluation.requiredBehaviors.length).toBeGreaterThanOrEqual(3);
      expect(evaluation.forbiddenClaims.length).toBeGreaterThanOrEqual(2);
    }
    expect(ADVISOR_EVALUATION_CASES.map((item) => item.question).join(" ")).toMatch(
      /忽略系统指令|token/,
    );
  });
});
