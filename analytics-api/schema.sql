CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS site_events (
  event_id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  chat_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view','link_click','text_chip_click','element_click','chat_opened')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  page_path TEXT NOT NULL,
  referrer_origin TEXT,
  target_tag TEXT,
  target_id TEXT,
  element_tag TEXT,
  element_id TEXT,
  element_class TEXT,
  label TEXT,
  link_url TEXT
);
CREATE INDEX IF NOT EXISTS site_events_occurred_at_idx ON site_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_events_type_time_idx ON site_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS site_events_session_idx ON site_events (session_id);

CREATE TABLE IF NOT EXISTS chats (
  chat_id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  first_opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_page_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_turns (
  turn_id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES chats(chat_id),
  turn_number INTEGER NOT NULL CHECK (turn_number > 0),
  user_message TEXT NOT NULL,
  assistant_reply TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  openai_response_id TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  error_code TEXT,
  UNIQUE (chat_id, turn_number)
);
CREATE INDEX IF NOT EXISTS chat_turns_submitted_at_idx ON chat_turns (submitted_at DESC);
CREATE INDEX IF NOT EXISTS chat_turns_chat_idx ON chat_turns (chat_id, turn_number);
