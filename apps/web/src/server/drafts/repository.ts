import type { Client, Row } from '@libsql/client';
import {
  DraftViewSchema,
  type DraftKind,
  type DraftStatus,
  type DraftView,
  type NewTicketDraft,
  type TicketUpdateDraft,
} from '../../lib/chat';
import { nullableText, text } from '../db/rows';

export interface Draft {
  readonly view: DraftView;
  readonly conversationId: string;
  readonly employeeId: string;
  readonly messageId: string | null;
}

export type NewDraft =
  | { readonly kind: 'create'; readonly data: NewTicketDraft }
  | { readonly kind: 'comment' | 'reopen'; readonly data: TicketUpdateDraft };

/** Os números começam em D-381, como no protótipo. */
const DRAFT_NUMBER_OFFSET = 380;

function toDraft(row: Row): Draft {
  const view = DraftViewSchema.parse({
    id: text(row, 'id'),
    kind: text(row, 'kind'),
    status: text(row, 'status'),
    ticketId: nullableText(row, 'ticket_id'),
    data: JSON.parse(text(row, 'data')) as unknown,
  });
  return {
    view,
    conversationId: text(row, 'conversation_id'),
    employeeId: text(row, 'employee_id'),
    messageId: nullableText(row, 'message_id'),
  };
}

export class DraftRepository {
  constructor(private readonly db: Client) {}

  /** Cria um rascunho pendente e marca os anteriores da conversa como substituídos. */
  async create(conversationId: string, employeeId: string, draft: NewDraft, now: Date): Promise<Draft> {
    const at = now.toISOString();
    const results = await this.db.batch(
      [
        {
          sql: `UPDATE ticket_drafts SET status = 'superseded', updated_at = ?
                WHERE conversation_id = ? AND status = 'pending'`,
          args: [at, conversationId],
        },
        {
          sql: `INSERT INTO ticket_drafts (conversation_id, employee_id, kind, data, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
          args: [conversationId, employeeId, draft.kind, JSON.stringify(draft.data), at, at],
        },
        {
          sql: `UPDATE ticket_drafts SET id = 'D-' || (seq + ${DRAFT_NUMBER_OFFSET}) WHERE seq = last_insert_rowid()`,
          args: [],
        },
        { sql: 'SELECT * FROM ticket_drafts WHERE seq = last_insert_rowid()', args: [] },
      ],
      'write',
    );
    const row = results.at(-1)?.rows[0];
    if (!row) throw new Error('Rascunho criado não encontrado');
    return toDraft(row);
  }

  async findById(id: string): Promise<Draft | null> {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM ticket_drafts WHERE id = ?',
      args: [id.trim().toUpperCase()],
    });
    const row = rs.rows[0];
    return row ? toDraft(row) : null;
  }

  /** O rascunho pendente mais recente da conversa, se houver. */
  async findPending(conversationId: string): Promise<Draft | null> {
    const rs = await this.db.execute({
      sql: `SELECT * FROM ticket_drafts WHERE conversation_id = ? AND status = 'pending' ORDER BY seq DESC LIMIT 1`,
      args: [conversationId],
    });
    const row = rs.rows[0];
    return row ? toDraft(row) : null;
  }

  async attachMessage(id: string, messageId: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE ticket_drafts SET message_id = ? WHERE id = ?', args: [messageId, id] });
  }

  /** Muda o status só se o rascunho ainda estiver pendente (evita confirmar duas vezes). */
  async settle(
    id: string,
    status: Exclude<DraftStatus, 'pending'>,
    ticketId: string | null,
    now: Date,
  ): Promise<boolean> {
    const rs = await this.db.execute({
      sql: `UPDATE ticket_drafts SET status = ?, ticket_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      args: [status, ticketId, now.toISOString(), id],
    });
    return rs.rowsAffected === 1;
  }

  async setTicketId(id: string, ticketId: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE ticket_drafts SET ticket_id = ? WHERE id = ?', args: [ticketId, id] });
  }

  /** Devolve o rascunho para pendente (quando a criação no service desk falha). */
  async reopen(id: string, now: Date): Promise<void> {
    await this.db.execute({
      sql: `UPDATE ticket_drafts SET status = 'pending', ticket_id = NULL, updated_at = ? WHERE id = ?`,
      args: [now.toISOString(), id],
    });
  }
}

export type { DraftKind };
