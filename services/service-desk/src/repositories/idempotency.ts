import type { Client } from '@libsql/client';
import { integer, text } from '../db/rows';

export interface StoredResponse {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;
}

export class IdempotencyRepository {
  constructor(private readonly db: Client) {}

  async find(key: string, actorId: string): Promise<StoredResponse | null> {
    const rs = await this.db.execute({
      sql: 'SELECT method, path, status, body FROM idempotency_keys WHERE key = ? AND actor_id = ?',
      args: [key, actorId],
    });
    const row = rs.rows[0];
    if (!row) return null;
    return { method: text(row, 'method'), path: text(row, 'path'), status: integer(row, 'status'), body: text(row, 'body') };
  }

  async save(key: string, actorId: string, response: StoredResponse, at: string): Promise<void> {
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO idempotency_keys (key, actor_id, method, path, status, body, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [key, actorId, response.method, response.path, response.status, response.body, at],
    });
  }
}
