"""Merge additive Boqlet routes with the signed Narudzbe release routes."""
import json
import sys
from pathlib import Path

baseline, additions = (json.loads(Path(name).read_text()) for name in sys.argv[1:])
for category, added in additions["http"].items():
    existing = baseline["http"][category]
    if collisions := existing.keys() & added.keys():
        raise SystemExit(f"Existing route names: {sorted(collisions)}")
    existing.update(added)
print(json.dumps(baseline, indent=2))
