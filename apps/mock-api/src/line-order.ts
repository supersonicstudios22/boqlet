/**
 * Display ordering (mock-api.md "Line edits"): the mock owns it, the engine doesn't. After the
 * engine generates the lines, manual lines move after their `sortHint` line and edited lines after
 * their `sortAfter` line (`null`: first in their section of the first classification).
 */
import type { BoqLine, BoqResult } from "@ifc-boq/types";
import type { ManualItemRec, OverrideRec } from "./store.js";

export function applyLineOrder(result: BoqResult, overrides: OverrideRec[], items: ManualItemRec[]) {
  const lines = result.lines;
  const primary = Object.keys(lines.find((l) => Object.keys(l.codes).length)?.codes ?? {})[0];
  const section = (l: BoqLine) => (primary ? (l.codes[primary]?.path.map((p) => p.code).join("/") ?? "") : "");
  const moves: [string, string | null][] = [
    ...items.filter((i) => i.sortHint).map((i) => [i.item.id, i.sortHint!] as [string, string]),
    ...overrides.filter((o) => o.sortAfter !== undefined).map((o) => [o.lineKey, o.sortAfter!] as [string, string | null]),
  ];
  for (const [key, after] of moves) {
    const from = lines.findIndex((l) => l.key === key);
    if (from < 0) continue;
    const [line] = lines.splice(from, 1);
    if (!line) continue;
    const override = overrides.find((edit) => edit.lineKey === key && edit.sortAfter !== undefined);
    if (override) {
      line.overridden ??= { fields: [] };
      line.overridden.fields.push("order");
    }
    let to: number;
    if (after === null) {
      const first = lines.findIndex((l) => section(l) === section(line));
      to = first < 0 ? from : first;
    } else {
      const target = lines.findIndex((l) => l.key === after);
      to = target < 0 ? from : target + 1;
    }
    lines.splice(to, 0, line);
  }
}
