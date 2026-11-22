import { describe, expect, it } from "vitest";
import { hasWebGL } from "./webgl";

/** TF-106: the viewer knows when the browser has no WebGL (it then lists the elements instead). */
const docWith = (getContext: (kind: string) => unknown) => ({ createElement: () => ({ getContext }) }) as unknown as Document;

describe("hasWebGL", () => {
  it("is true with WebGL 2 or WebGL 1", () => {
    expect(hasWebGL(docWith((k) => (k === "webgl2" ? {} : null)))).toBe(true);
    expect(hasWebGL(docWith((k) => (k === "webgl" ? {} : null)))).toBe(true);
  });
  it("is false without either, or when asking throws", () => {
    expect(hasWebGL(docWith(() => null))).toBe(false);
    expect(
      hasWebGL(
        docWith(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(false);
  });
});
