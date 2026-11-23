// Is UX-002 a React StrictMode (dev) artefact? Copy of useRefocusWhenLost (apps/app/src/lib/focus.ts), mounted with and without StrictMode.
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, requestAnimationFrame: dom.window.requestAnimationFrame, cancelAnimationFrame: dom.window.cancelAnimationFrame, HTMLElement: dom.window.HTMLElement });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const req = require("module").createRequire(require("path").resolve("apps/app/package.json"));
const React = req("react"); const { createRoot } = req("react-dom/client"); const act = React.act ?? (async (f) => { await f(); await new Promise(r => setTimeout(r, 50)); });
console.log("react", React.version, "NODE_ENV", process.env.NODE_ENV ?? "(unset=development build)");
function focusLost() { const el = document.activeElement; return !el || el === document.body || !el.isConnected; }
function useRefocusWhenLost(target, deps) {
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const id = requestAnimationFrame(() => { if (!focusLost()) return; const el = target.current; if (el) el.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(id);
  }, deps);
}
function Header() { const ref = React.useRef(null); useRefocusWhenLost(ref, ["complete"]); return React.createElement("button", { ref, id: "generate" }, "Generate again"); }
(async () => {
  for (const strict of [false, true]) {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Header)) : React.createElement(Header)));
    await new Promise((r) => setTimeout(r, 100));
    console.log(`StrictMode=${strict}: activeElement after mount =`, document.activeElement.id || document.activeElement.tagName);
    await act(async () => root.unmount()); host.remove(); document.body.focus?.();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
})();
