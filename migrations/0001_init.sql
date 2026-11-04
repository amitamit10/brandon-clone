CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX chats_expires_at ON chats (expires_at);

CREATE TABLE chat_chunks (
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  summary_json TEXT,
  PRIMARY KEY (chat_id, idx)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  persona TEXT NOT NULL,
  language TEXT NOT NULL,
  me TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT,
  question TEXT,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  content_json TEXT,
  error TEXT,
  share_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX reports_chat_id ON reports (chat_id);

CREATE TABLE rate (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
