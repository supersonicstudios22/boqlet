# check-blueprint.py - mechanical coverage check of docs/review/BLUEPRINT.md and PROGRESS.md (written by the
# review's consolidator). Run after editing the blueprint:
#   engine/.venv/Scripts/python docs/review/tools/check-blueprint.py   (Linux: engine/.venv/bin/python)
# Exit 0 when every check passes.
"""Mechanical checks of docs/review/BLUEPRINT.md (and PROGRESS.md).

  - every item traces to at least one finding id, VER id or FM row
  - every item is in exactly one work package, and its heading names that package
  - every package's items exist; prerequisites exist, appear earlier (phase order), no cycle
  - every item dependency is an existing item in the same package or in a (transitive) prerequisite package
  - the coverage table lists all 186 findings + VER-001..007, each mapped to items (or rejected: CAS-030, CAS-032)
  - the coverage table lists FM-01..FM-123; every non-built row is mapped to an item, a non-goal or the deferral
  - the coverage table agrees with the items' Sources lines
  - PROGRESS.md lists every package with a known status (todo, in progress, done, blocked)
Exit 0 when everything passes.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REVIEW = HERE.parent  # docs/review/tools -> docs/review
bp = (REVIEW / "BLUEPRINT.md").read_text(encoding="utf-8")
progress = (REVIEW / "PROGRESS.md").read_text(encoding="utf-8")

FINDING_RE = re.compile(r"\b(?:ENG|PRD|CAS|QS|LEAD|UX|VER)-\d{3}\b")
FM_RE = re.compile(r"\bFM-\d{2,3}\b")
ITEM_RE = re.compile(r"\b[ABCD]-\d{2}\b")
errors: list[str] = []

# ---- items
items: dict[str, dict] = {}
cur = None
for line in bp.splitlines():
    m = re.match(r"^#### ([ABCD]-\d{2}) · (.+?)\s+\((WP-[A-D]\d+[a-z]?)\)\s*$", line)
    if m:
        if m.group(1) in items:
            errors.append(f"duplicate item heading {m.group(1)}")
        cur = m.group(1)
        items[cur] = {"wp": m.group(3), "sources": None, "deps": None, "fields": set()}
        continue
    if line.startswith("#### ") or line.startswith("### ") or line.startswith("## "):
        cur = None
        continue
    if cur:
        f = re.match(r"^- \*\*(.+?):\*\*", line)
        if f:
            items[cur]["fields"].add(f.group(1))
        if line.startswith("- **Sources:**"):
            items[cur]["sources"] = line
        if line.startswith("- **Effort:**"):
            items[cur]["deps"] = line

REQUIRED = {"Sources", "Problem", "Why it matters", "Change and approach", "Files", "Acceptance", "Tests", "Effort"}
for iid, it in items.items():
    missing = REQUIRED - it["fields"]
    if missing:
        errors.append(f"{iid}: missing fields {sorted(missing)}")
    src = it["sources"] or ""
    if not (FINDING_RE.search(src) or FM_RE.search(src)):
        errors.append(f"{iid}: no finding/VER/FM id in Sources")
    if it["deps"] is None or "**Depends on:**" not in it["deps"] or "**Risk:**" not in it["deps"]:
        errors.append(f"{iid}: Effort line lacks Depends on / Risk")

# ---- work packages
wps: dict[str, dict] = {}
wp_order: list[str] = []
cur = None
for line in bp.splitlines():
    # A split package carries a letter (WP-C2b, BLUEPRINT.md 6.1 step 5).
    m = re.match(r"^#### (WP-[A-D]\d+[a-z]?) · (.+?)\s*$", line)
    if m:
        cur = m.group(1)
        if cur in wps:
            errors.append(f"duplicate package {cur}")
        wps[cur] = {"items": [], "req": [], "fields": set()}
        wp_order.append(cur)
        continue
    if line.startswith("#### ") or line.startswith("### ") or line.startswith("## "):
        cur = None
        continue
    if cur:
        f = re.match(r"^- \*\*(.+?):\*\*", line)
        if f:
            wps[cur]["fields"].add(f.group(1))
        if line.startswith("- **Items:**"):
            wps[cur]["items"] = ITEM_RE.findall(line)
        if line.startswith("- **Requires:**"):
            wps[cur]["req"] = re.findall(r"WP-[A-D]\d+[a-z]?", line)

WP_REQUIRED = {"Items", "Requires", "Touches", "Entry check", "Exit check", "Expected baseline changes"}
for w, d in wps.items():
    missing = WP_REQUIRED - d["fields"]
    if missing:
        errors.append(f"{w}: missing fields {sorted(missing)}")
    for i in d["items"]:
        if i not in items:
            errors.append(f"{w}: item {i} does not exist")
    for r in d["req"]:
        if r not in wps:
            errors.append(f"{w}: prerequisite {r} does not exist")
        elif wp_order.index(r) >= wp_order.index(w):
            errors.append(f"{w}: prerequisite {r} is not earlier in the order")
    if w[3] != wp_order[wp_order.index(w)][3]:
        pass

membership: dict[str, list[str]] = {}
for w, d in wps.items():
    for i in d["items"]:
        membership.setdefault(i, []).append(w)
for iid, it in items.items():
    ws = membership.get(iid, [])
    if len(ws) != 1:
        errors.append(f"{iid}: in {len(ws)} packages {ws}")
    elif ws[0] != it["wp"]:
        errors.append(f"{iid}: heading says {it['wp']} but listed in {ws[0]}")
    if iid[0] != it["wp"][3]:
        errors.append(f"{iid}: phase letter differs from its package {it['wp']}")

# cycles (also implied by 'earlier') and transitive closure
def closure(w, seen=None):
    seen = set() if seen is None else seen
    for r in wps.get(w, {}).get("req", []):
        if r not in seen:
            seen.add(r)
            closure(r, seen)
    return seen

for w in wps:
    if w in closure(w):
        errors.append(f"{w}: prerequisite cycle")

# item dependencies
for iid, it in items.items():
    dep_text = (it["deps"] or "").split("**Depends on:**", 1)[-1].split("**Risk:**", 1)[0]
    for d in ITEM_RE.findall(dep_text):
        if d == iid:
            continue
        if d not in items:
            errors.append(f"{iid}: depends on unknown item {d}")
            continue
        wi, wd = it["wp"], items[d]["wp"]
        if wd != wi and wd not in closure(wi):
            errors.append(f"{iid} ({wi}) depends on {d} ({wd}), which is not a prerequisite package")
        elif wd == wi and list(items).index(d) > list(items).index(iid):
            errors.append(f"{iid} depends on {d}, listed later in the same package")

# ---- coverage table
cov = bp.split("## 7. Coverage", 1)
if len(cov) != 2:
    errors.append("no coverage section")
    cov_text = ""
else:
    cov_text = cov[1]
rows = {}
for line in cov_text.splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if cells and (FINDING_RE.fullmatch(cells[0]) or FM_RE.fullmatch(cells[0])):
        rows[cells[0]] = cells

# Every finding id that has a row in a persona report's findings table (first cell of a table row).
index = sorted({m.group(1) for f in sorted(REVIEW.glob("0[1-6]-*.md"))
                for m in re.finditer(r"^\|\s*\**((?:ENG|PRD|CAS|QS|LEAD|UX)-\d{3})\**\s*\|",
                                     f.read_text(encoding="utf-8"), re.M)})
expected_findings = index + [f"VER-{n:03d}" for n in range(1, 8)]
if len(index) != 186:
    errors.append(f"findings index has {len(index)} ids, expected 186")
src_tokens: dict[str, set] = {}
for iid, it in items.items():
    for t in set(FINDING_RE.findall(it["sources"] or "")) | set(FM_RE.findall(it["sources"] or "")):
        src_tokens.setdefault(t, set()).add(iid)
rejected = []
for fid in expected_findings:
    r = rows.get(fid)
    if not r:
        errors.append(f"coverage: {fid} missing")
        continue
    target = r[-1]
    if target.startswith("rejected"):
        rejected.append(fid)
        continue
    mapped = set(ITEM_RE.findall(target))
    if not mapped:
        errors.append(f"coverage: {fid} mapped to no item ({target})")
    elif mapped != src_tokens.get(fid, set()):
        errors.append(f"coverage: {fid} table {sorted(mapped)} != sources {sorted(src_tokens.get(fid, set()))}")
    for m in mapped:
        if m not in items:
            errors.append(f"coverage: {fid} → unknown item {m}")
if sorted(rejected) != ["CAS-030", "CAS-032"]:
    errors.append(f"coverage: rejected set is {rejected}, expected CAS-030, CAS-032")

fm_missing = 0
for n in range(1, 124):
    fid = f"FM-{n:02d}" if n < 100 else f"FM-{n}"
    r = rows.get(fid)
    if not r:
        errors.append(f"coverage: {fid} missing")
        fm_missing += 1
        continue
    status, target = r[2].lower(), r[3]
    mapped = set(ITEM_RE.findall(target))
    nonbuilt = not status.startswith("built") or status.startswith("built (simplified)")
    if "unmapped" in target.lower():
        errors.append(f"coverage: {fid} unmapped")
    if nonbuilt and not mapped and not target.startswith("non-goal") and "deferred" not in target:
        errors.append(f"coverage: {fid} ({status}) has no item")
    if mapped and mapped != src_tokens.get(fid, set()):
        errors.append(f"coverage: {fid} table {sorted(mapped)} != sources {sorted(src_tokens.get(fid, set()))}")

# ---- PROGRESS.md
for w in wps:
    m = re.search(rf"^\| {re.escape(w)} \|[^|]*\| (\w[\w ]*) \|", progress, re.M)
    if not m:
        errors.append(f"PROGRESS.md: {w} missing")
    elif m.group(1).strip() not in ("todo", "in progress", "done", "blocked"):
        errors.append(f"PROGRESS.md: {w} status {m.group(1)!r} (todo, in progress, done or blocked)")
for word in ["review/blueprint"]:
    if word in bp or word in progress:
        errors.append(f"mention of {word!r} remains")

# ---- report
by_phase = {p: sum(1 for i in items if i[0] == p) for p in "ABCD"}
wp_phase = {p: sum(1 for w in wps if w[3] == p) for p in "ABCD"}
print(f"items: {len(items)} (A {by_phase['A']}, B {by_phase['B']}, C {by_phase['C']}, D {by_phase['D']})")
print(f"work packages: {len(wps)} (A {wp_phase['A']}, B {wp_phase['B']}, C {wp_phase['C']}, D {wp_phase['D']})")
print(f"findings in coverage: {sum(1 for f in expected_findings if f in rows)}/{len(expected_findings)} "
      f"(186 report findings + 7 VER); rejected: {', '.join(sorted(rejected))}")
print(f"FM rows in coverage: {sum(1 for n in range(1,124) if (f'FM-{n:02d}' if n < 100 else f'FM-{n}') in rows)}/123")
dec = sorted(set(re.findall(r"^\| (DEC-\d{2,3}) \|", bp, re.M)), key=lambda d: int(d[4:]))
print(f"decisions logged: {len(dec)} ({dec[0]}…{dec[-1]})" if dec else "decisions logged: 0")
if errors:
    print(f"\nFAIL: {len(errors)} problem(s)")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nOK: all checks passed")
