import { describe, expect, it } from "vitest";
import { recordLabel } from "./format";

describe("recordLabel", () => {
  it("uses human-readable member and file fields before the unnamed fallback", () => {
    expect(recordLabel({ displayName: "试点运营成员" })).toBe("试点运营成员");
    expect(recordLabel({ filename: "履约证据.pdf" })).toBe("履约证据.pdf");
    expect(recordLabel({})).toBe("未命名记录");
  });
});
