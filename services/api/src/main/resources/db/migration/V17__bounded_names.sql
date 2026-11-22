-- TF-174: the contract now caps names (a person's name at 120 characters, other names and labels at
-- 200). Values stored before the cap are cut to it, so one oversized name can't make every response
-- that embeds it huge. A person's name is embedded in decisions, audit rows, uploads and comments and
-- has three write paths (PATCH /me, set-password, provider sign-in), so the database also refuses one
-- longer than an email address (a person without a name is named by their email, up to 254
-- characters). The previous image keeps working; only a name it would store over that is refused.
UPDATE users SET name = left(name, 120) WHERE char_length(name) > 120 AND name <> email;
ALTER TABLE users ADD CONSTRAINT users_name_length CHECK (char_length(name) <= 254);

UPDATE orgs SET name = left(name, 200) WHERE char_length(name) > 200;
UPDATE projects SET name = left(name, 200) WHERE char_length(name) > 200;
UPDATE presets SET name = left(name, 200) WHERE char_length(name) > 200;
UPDATE models SET name = left(name, 200) WHERE char_length(name) > 200;
UPDATE boqs SET name = left(name, 200) WHERE char_length(name) > 200;
UPDATE share_links SET label = left(label, 200) WHERE char_length(label) > 200;
