import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/api/client", () => ({ api: { POST: (...args: unknown[]) => post(...args) } }));

const { renamePresetParam, sampleItemText } = await import("./item-texts");

describe("item texts through the engine (review B-13)", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockImplementation((_path: string, { body }: { body: { items: { template: string }[] } }) =>
      Promise.resolve({ data: { results: body.items.map((i) => ({ text: i.template, pieces: [{ text: i.template }] })) } }),
    );
  });

  it("a page of item texts asked for together is one call, answered in order", async () => {
    const got = await Promise.all(["a {x}", "b", "c"].map((template) => sampleItemText({ template })));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe("/presets/item-texts/sample");
    expect(got.map((s) => s.text)).toEqual(["a {x}", "b", "c"]);
  });

  it("more than one call's worth is split at 500", async () => {
    await Promise.all(Array.from({ length: 501 }, (_, i) => sampleItemText({ template: `t${i}` })));
    expect(post.mock.calls.map((c) => (c[1] as { body: { items: unknown[] } }).body.items.length)).toEqual([500, 1]);
  });

  it("a failed call fails every item in it", async () => {
    post.mockResolvedValueOnce({ error: { code: "engine_unavailable" } });
    await expect(sampleItemText({ template: "x" })).rejects.toEqual({ code: "engine_unavailable" });
  });

  it("a slot rename returns the engine's document", async () => {
    post.mockResolvedValueOnce({ data: { doc: { params: { depth: {} } }, changes: 1 } });
    expect(await renamePresetParam({ params: { a: {} } }, "a", "depth")).toEqual({ params: { depth: {} } });
    expect(post).toHaveBeenCalledWith("/presets/rename-param", { body: { doc: { params: { a: {} } }, from: "a", to: "depth" } });
  });
});
