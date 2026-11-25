-- Review A-45 (DEC-45): which org presets new projects start from is an explicit choice, no longer "starred".
-- One rule set per org (the unique index); classifications and dictionaries may be several, as starring allowed.
-- Today's effective choice is kept: the most recently updated starred rule set (ProjectPresets before V25),
-- every starred classification and dictionary. Starring stays as a favourite marker.
ALTER TABLE presets ADD COLUMN org_default boolean NOT NULL DEFAULT false;

UPDATE presets p SET org_default = true
WHERE p.layer = 'org' AND p.kind IN ('classification', 'dictionary') AND p.starred AND NOT p.archived
  AND p.latest_published_version_id IS NOT NULL;

UPDATE presets p SET org_default = true
WHERE p.id IN (
    SELECT DISTINCT ON (org_id) id FROM presets
    WHERE layer = 'org' AND kind = 'rule_set' AND starred AND NOT archived AND latest_published_version_id IS NOT NULL
    ORDER BY org_id, updated_at DESC, id);

CREATE UNIQUE INDEX presets_one_default_rule_set ON presets (org_id) WHERE org_default AND kind = 'rule_set';
