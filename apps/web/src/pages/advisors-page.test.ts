import { describe, expect, it } from "vitest";

import { advisorAvailableScopes, promptAllowedScopes } from "./advisors-page";

describe("advisor prompt scope controls", () => {
  it("only offers scopes allowed by the active prompt version", () => {
    expect(
      promptAllowedScopes(
        ["compliance-items", "compliance-events", "obligations", "risks"],
        ["compliance-items", "obligations", "risks"],
      ),
    ).toEqual(["compliance-items", "obligations", "risks"]);
  });

  it("keeps the declared scopes while older servers omit prompt scope metadata", () => {
    expect(promptAllowedScopes(["tasks", "projects"])).toEqual(["tasks", "projects"]);
  });

  it("also removes scopes the current role cannot read", () => {
    expect(
      advisorAvailableScopes(
        ["risks", "compliance-items", "audit-events"],
        ["risks", "compliance-items", "audit-events"],
        ["risks", "compliance-items"],
      ),
    ).toEqual(["risks", "compliance-items"]);
  });
});
