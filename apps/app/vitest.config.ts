import { createRequire } from "node:module";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// On Windows a shell can hand over the cwd with a lower-case drive letter ("c:\..."), and Vitest
// then loads `vitest` twice ("Cannot read properties of undefined (reading 'config')").
const root = __dirname.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
/** The app's own React, wherever npm put it (hoisted to the workspace root or in the app's node_modules). */
const own = (name: string) => path.dirname(createRequire(path.join(root, "package.json")).resolve(`${name}/package.json`));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.join(root, "src") },
      // One React for the app and the packages its tests render (next-intl, use-intl): the app's own.
      { find: /^react$/, replacement: own("react") },
      { find: /^react\/(.*)$/, replacement: path.join(own("react"), "$1") },
      { find: /^react-dom$/, replacement: own("react-dom") },
      { find: /^react-dom\/(.*)$/, replacement: path.join(own("react-dom"), "$1") },
    ],
  },
  test: {
    // Hoisted to the workspace root: transformed here, so their React imports get the aliases above.
    server: { deps: { inline: ["next-intl", "use-intl", "@tanstack/react-virtual"] } },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    environment: "node",
    testTimeout: 30_000,
  },
});
