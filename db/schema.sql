-- Reception Visitor & Delivery Log — PostgreSQL 14+
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- ───────── ENUMs ─────────
CREATE TYPE visit_status    AS ENUM ('pre_booked', 'checked_in', 'checked_out', 'cancelled', 'no_show');
CREATE TYPE delivery_status AS ENUM ('received', 'notified', 'picked_up', 'returned');
CREATE TYPE delivery_type   AS ENUM ('package', 'envelope', 'pallet', 'food', 'flowers', 'other');

-- ───────── Shared trigger ─────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ───────── users (hosts / employees) ─────────
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        TEXT        NOT NULL,
  email            CITEXT      NOT NULL UNIQUE,
  phone            TEXT,
  department       TEXT,
  slack_webhook_url TEXT,          -- optional per-host webhook (else global fallback)
  teams_webhook_url TEXT,
  slack_user_id    TEXT,           -- for <@U123> mentions
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_active_name ON users (is_active, lower(full_name));
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────── visitors (people, deduped by email when present) ─────────
CREATE TABLE visitors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT        NOT NULL,
  company     TEXT,
  email       CITEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT visitors_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX uq_visitors_email ON visitors (email) WHERE email IS NOT NULL;
CREATE INDEX idx_visitors_name ON visitors (lower(full_name));
CREATE TRIGGER trg_visitors_updated BEFORE UPDATE ON visitors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────── visits (pre-bookings + live log) ─────────
CREATE TABLE visits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id     UUID         NOT NULL REFERENCES visitors(id) ON DELETE RESTRICT,
  host_id        UUID         NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  status         visit_status NOT NULL DEFAULT 'pre_booked',
  qr_token       TEXT         NOT NULL UNIQUE,      -- random, unguessable; encoded in emailed QR
  purpose        TEXT,
  photo_url      TEXT,                              -- S3 object key or URL
  expected_at    TIMESTAMPTZ,                       -- pre-booking window start
  checked_in_at  TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT visits_time_order_chk
    CHECK (checked_out_at IS NULL OR (checked_in_at IS NOT NULL AND checked_out_at >= checked_in_at))
);
CREATE INDEX idx_visits_visitor        ON visits (visitor_id);
CREATE INDEX idx_visits_host_status    ON visits (host_id, status);
CREATE INDEX idx_visits_status_expected ON visits (status, expected_at);
CREATE INDEX idx_visits_on_site        ON visits (checked_in_at DESC) WHERE status = 'checked_in';
CREATE TRIGGER trg_visits_updated BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────── deliveries ─────────
CREATE TABLE deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID            NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  carrier       TEXT            NOT NULL,           -- UPS, FedEx, DHL, Amazon, USPS, Other...
  type          delivery_type   NOT NULL DEFAULT 'package',
  status        delivery_status NOT NULL DEFAULT 'received',
  photo_url     TEXT,
  notes         TEXT,
  received_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
  picked_up_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_deliveries_recipient_status ON deliveries (recipient_id, status);
CREATE INDEX idx_deliveries_received_at      ON deliveries (received_at DESC);
CREATE INDEX idx_deliveries_uncollected      ON deliveries (received_at) WHERE status IN ('received','notified');
CREATE TRIGGER trg_deliveries_updated BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
