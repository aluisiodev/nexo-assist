/**
 * Esquema do "sistema legado" de chamados. Idempotente (IF NOT EXISTS), aplicado na
 * inicialização, então os dados sobrevivem a reinícios.
 */
export const SCHEMA_SQL = /* sql */ `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  department    TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('employee', 'analyst')),
  support_group TEXT CHECK (support_group IN ('N1', 'N2'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('INC', 'REQ')),
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  priority         TEXT NOT NULL,
  priority_reason  TEXT,
  impact           TEXT NOT NULL,
  status           TEXT NOT NULL,
  requester_id     TEXT NOT NULL REFERENCES employees(id),
  assigned_group   TEXT,
  assignee_id      TEXT REFERENCES employees(id),
  source           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  sla_reference_at TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets (requester_id, status);

CREATE TABLE IF NOT EXISTS ticket_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id),
  at         TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id   TEXT,
  kind       TEXT NOT NULL,
  body       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events (ticket_id, id);

CREATE TABLE IF NOT EXISTS articles (
  id       TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  body     TEXT NOT NULL,
  category TEXT NOT NULL,
  tags     TEXT NOT NULL -- JSON array
);

CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Respostas já dadas a POSTs com Idempotency-Key: um retry após queda não duplica nada.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  status     INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, actor_id)
);
`;

/** Tabelas na ordem segura para apagar (filhas antes das mães). */
export const TABLES_DROP_ORDER = [
  'idempotency_keys',
  'ticket_events',
  'tickets',
  'articles',
  'sequences',
  'employees',
] as const;
