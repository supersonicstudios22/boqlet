/**
 * Whether this browser can draw the 3D view (WebGL 2 or 1). Without it the viewer says so and lists the
 * elements instead of failing (nfr.md, TF-106).
 */
export function hasWebGL(doc: Pick<Document, "createElement"> = document): boolean {
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
