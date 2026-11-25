-- Review A-43: the published version a draft started from. Publishing a draft whose base is no longer the latest
-- version merges (dictionaries) or is refused as draft_stale, so a version published past an open draft (a
-- promoted name answer) is never dropped. Existing drafts get the latest version published before they started.
ALTER TABLE preset_versions ADD COLUMN base_version_id uuid REFERENCES preset_versions(id) ON DELETE SET NULL;

UPDATE preset_versions d SET base_version_id = (
    SELECT v.id FROM preset_versions v
    WHERE v.preset_id = d.preset_id AND v.status = 'published' AND v.published_at <= d.created_at
    ORDER BY v.number DESC LIMIT 1)
WHERE d.status = 'draft';
