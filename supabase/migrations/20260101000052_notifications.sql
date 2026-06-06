-- 20260101000052_notifications.sql
-- Notification system: in-app inbox, per-user prefs, outbox deliveries,
-- SES bounce/complaint suppression. Idempotent.

CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  is_platform     boolean NOT NULL DEFAULT false,
  category        text NOT NULL,
  title           text NOT NULL,
  body            text,
  link_url        text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   uuid NOT NULL,
  category  text NOT NULL,
  in_app    boolean NOT NULL DEFAULT true,
  email     boolean NOT NULL DEFAULT true,
  sms       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         text NOT NULL,
  to_address      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text,
  external_id     text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deliveries_drain
  ON notification_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS suppression_list (
  address    text PRIMARY KEY,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
