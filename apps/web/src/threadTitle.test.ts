import { describe, expect, it } from "vitest";

import { buildThreadTitle } from "./threadTitle";

describe("buildThreadTitle", () => {
  it("trims whitespace", () => {
    expect(buildThreadTitle("  hello  ")).toBe("hello");
  });
  it("truncates with ellipsis when over max", () => {
    expect(buildThreadTitle("abcdefghij", 5)).toBe("abcd\u2026");
  });
  it("shortens a single file mention to basename", () => {
    expect(buildThreadTitle("Fix bug in @apps/web/src/ChatView.tsx")).toBe("Fix bug in @ChatView.tsx");
  });
  it("shortens multiple file mentions", () => {
    expect(buildThreadTitle("Move @src/utils/foo.ts to @src/lib/bar.ts")).toBe("Move @foo.ts to @bar.ts");
  });
  it("shortens before truncating", () => {
    const title = "Refactor @apps/web/src/components/ChatView.tsx and update tests";
    const result = buildThreadTitle(title, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("@ChatView.tsx");
  });
  it("leaves single-segment mentions unchanged", () => {
    expect(buildThreadTitle("Fix @README")).toBe("Fix @README");
  });
});
