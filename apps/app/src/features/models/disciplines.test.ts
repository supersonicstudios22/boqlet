import { describe, expect, it } from "vitest";
import { disciplineOptions, federationKeys } from "./disciplines";

/** Batch 2 leftover (TF-128): the model form offers the disciplines Java accepts, not a fixed list. */
describe("model disciplines", () => {
  it("are the federation settings' discipline keys", () => {
    expect(federationKeys([{ disciplines: { architecture: {}, structure: {} } }, { disciplines: { facade: {} } }, null, { other: 1 }])).toEqual(["architecture", "facade", "structure"]);
  });
  it("a refusal's details.allowed wins, then the federation keys, then the defaults while loading", () => {
    expect(disciplineOptions({ allowed: ["architecture", "facade"], federation: ["architecture"] })).toEqual(["architecture", "facade"]);
    expect(disciplineOptions({ federation: ["architecture", "facade"] })).toEqual(["architecture", "facade"]);
    expect(disciplineOptions({})).toEqual(["architecture", "structure", "mep"]);
  });
  it("keeps a model's own discipline visible", () => {
    expect(disciplineOptions({ federation: ["architecture"], current: "unknown" })).toEqual(["architecture", "unknown"]);
    expect(disciplineOptions({ federation: ["architecture"], current: "detect" })).toEqual(["architecture"]);
  });
});
