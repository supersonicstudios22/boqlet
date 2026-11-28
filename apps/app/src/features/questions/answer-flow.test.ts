import { describe, expect, it } from "vitest";
import type { Decision } from "@/api/hooks/decisions";
import { byOthers } from "./answer-flow";

const decision = (by?: string): Decision => ({
  id: "d", projectId: "p", questionId: "q", kind: "unknown_name", answer: "concrete", decidedAt: "2026-11-23T10:00:00Z",
  ...(by ? { decidedBy: { id: by, name: by } } : {}),
});

describe("review C-17: replacing a colleague's answer is asked first", () => {
  it("knows when a decision was someone else's", () => {
    expect(byOthers([decision("erin")], "ana")).toBe(true);
    expect(byOthers([decision("ana"), undefined], "ana")).toBe(false);
    expect(byOthers([undefined, decision()], "ana")).toBe(false);
    expect(byOthers([], "ana")).toBe(false);
  });
});
