-- Interface preferences that follow the user to every browser (Q55, TF-109): GET /me preferences, PATCH /me.
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}';
