/**
 * Banco do app (separado do banco do service desk): sessões de login, conversas,
 * mensagens e o estado de cada conversa. Sobrevive a reinícios.
 */
export const APP_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash     TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL,
  employee_name  TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  department     TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('employee', 'analyst')),
  support_group  TEXT,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS conversations (
  id                     TEXT PRIMARY KEY,
  employee_id            TEXT NOT NULL,
  employee_name          TEXT NOT NULL,
  employee_email         TEXT NOT NULL,
  employee_department    TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('agent', 'waiting_analyst', 'with_analyst', 'closed')),
  assigned_analyst_id    TEXT,
  assigned_analyst_name  TEXT,
  handoff_reason         TEXT,
  handoff_summary        TEXT,
  handoff_group          TEXT,
  handoff_confidence     REAL,
  handoff_ticket_id      TEXT,
  handoff_at             TEXT,
  closed_by              TEXT,
  closed_at              TEXT,
  employee_message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at        TEXT NOT NULL,
  last_message_preview   TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  -- Controle de concorrência otimista: dois analistas não assumem a mesma conversa.
  version                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conversations_employee ON conversations (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_queue ON conversations (status, last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('employee', 'agent', 'analyst', 'system')),
  author_id       TEXT,
  author_name     TEXT,
  text            TEXT NOT NULL,
  blocks          TEXT NOT NULL DEFAULT '[]', -- JSON: cards, opções rápidas…
  trace           TEXT,                       -- JSON: decisão do agent
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, seq);
`;
