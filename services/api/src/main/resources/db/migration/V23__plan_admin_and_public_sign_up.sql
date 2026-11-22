-- P57: the platform admin configures plans (limits, features, price, order, the default), the
-- platform's currency and public sign-up; sign-up and password-reset links are emailed.

ALTER TABLE plans
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN position integer NOT NULL DEFAULT 0,
    ADD COLUMN price_amount numeric(14, 2) CHECK (price_amount >= 0),
    ADD COLUMN price_period text CHECK (price_period IN ('month', 'year')),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT plans_price_whole CHECK ((price_amount IS NULL) = (price_period IS NULL));

UPDATE plans SET position = CASE id WHEN 'free' THEN 0 WHEN 'professional' THEN 10 WHEN 'team' THEN 20
    WHEN 'enterprise' THEN 30 ELSE 100 END;

-- The free plan is for one person with one org (P57): one seat, and one owned org on it per person.
UPDATE plans SET entitlements = entitlements || '{"seats":1,"ownedOrgsPerUser":1}'::jsonb WHERE id = 'free';

CREATE TABLE platform_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
    public_sign_up boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings DEFAULT VALUES;

-- An emailed link: its token is derived from the nonce with the server's signing secret, so the
-- outbox never stores a token. Operator-issued links (ops/pilot/issue-setup-link.sh) have none.
ALTER TABLE native_setup_links ADD COLUMN nonce uuid;

-- Sign-up and reset emails belong to no org.
ALTER TABLE email_outbox ALTER COLUMN org_id DROP NOT NULL;
