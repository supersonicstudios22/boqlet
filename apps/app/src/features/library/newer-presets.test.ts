import { describe, expect, it } from "vitest";
import { newerPatch, presetNotices, type PresetInputInfo } from "./newer-presets";

const info = (over: Partial<PresetInputInfo>): PresetInputInfo => ({ versionId: "v1", presetId: "p", kind: "rule_set", layer: "org", name: "Firm rules", archived: false, number: 1, ...over });

/** Review A-44: "Use version n" changes only the input that holds the older version. */
describe("newer preset versions", () => {
  const ids = { ruleSetVersionId: "r1", classificationVersionIds: ["c1", "c2"], dictionaryVersionIds: ["d1", "d2"], federationVersionId: null };

  it("swaps the one version, keeping order and other inputs", () => {
    expect(newerPatch(ids, info({ versionId: "r1", latestVersionId: "r2", newerVersionAvailable: 2 }))).toEqual({ ruleSetVersionId: "r2" });
    expect(newerPatch(ids, info({ kind: "classification", versionId: "c1", latestVersionId: "c9" }))).toEqual({ classificationVersionIds: ["c9", "c2"] });
    expect(newerPatch(ids, info({ kind: "dictionary", versionId: "d2", latestVersionId: "d1" }))).toEqual({ dictionaryVersionIds: ["d1"] });
    expect(newerPatch(ids, info({ kind: "federation", versionId: "f1", latestVersionId: "f2" }))).toEqual({ federationVersionId: "f2" });
  });

  it("nothing to do without a newer version; notices are the newer and the archived ones", () => {
    expect(newerPatch(ids, info({}))).toEqual({});
    const list = [info({ versionId: "a" }), info({ versionId: "b", newerVersionAvailable: 3 }), info({ versionId: "c", archived: true })];
    expect(presetNotices(list).map((p) => p.versionId)).toEqual(["b", "c"]);
    expect(presetNotices(undefined)).toEqual([]);
  });
});
