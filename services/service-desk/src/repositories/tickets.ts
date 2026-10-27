import type { Client, InStatement, InValue, Row } from '@libsql/client';
import {
  OPEN_STATUSES,
  TicketEventSchema,
  TicketSchema,
  type ActorType,
  type Ticket,
  type TicketEvent,
  type TicketEventKind,
  type TicketListFilter,
} from '@nexo/domain';
import { integer, nullableText, text } from '../db/rows';

const COLUMNS = [
  'id', 'type', 'category', 'title', 'description', 'priority', 'priority_reason', 'impact', 'status',
  'requester_id', 'assigned_group', 'assignee_id', 'source', 'created_at', 'updated_at', 'sla_reference_at',
  'resolved_at',
].join(', ');

function toTicket(row: Row): Ticket {
  return TicketSchema.parse({
    id: text(row, 'id'),
    type: text(row, 'type'),
    category: text(row, 'category'),
    title: text(row, 'title'),
    description: text(row, 'description'),
    priority: text(row, 'priority'),
    priorityReason: nullableText(row, 'priority_reason'),
    impact: text(row, 'impact'),
    status: text(row, 'status'),
    requesterId: text(row, 'requester_id'),
    assignedGroup: nullableText(row, 'assigned_group'),
    assigneeId: nullableText(row, 'assignee_id'),
    source: text(row, 'source'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    slaReferenceAt: text(row, 'sla_reference_at'),
    resolvedAt: nullableText(row, 'resolved_at'),
  });
}

function toEvent(row: Row): TicketEvent {
  return TicketEventSchema.parse({
    id: integer(row, 'id'),
    ticketId: text(row, 'ticket_id'),
    at: text(row, 'at'),
    actorType: text(row, 'actor_type'),
    actorId: nullableText(row, 'actor_id'),
    kind: text(row, 'kind'),
    body: nullableText(row, 'body'),
  });
}

export interface EventActor {
  readonly type: ActorType;
  readonly id: string | null;
}

export interface NewEvent {
  readonly kind: TicketEventKind;
  readonly body: string | null;
  readonly actor: EventActor;
}

export type NewTicket = Omit<Ticket, 'id'>;

/** Campos que podem mudar depois da abertura. Mapeados explicitamente para colunas. */
export interface TicketChanges {
  status?: Ticket['status'];
  assignedGroup?: Ticket['assignedGroup'];
  assigneeId?: Ticket['assigneeId'];
  slaReferenceAt?: Ticket['slaReferenceAt'];
  resolvedAt?: Ticket['resolvedAt'];
}

const CHANGE_COLUMNS: Record<keyof TicketChanges, string> = {
  status: 'status',
  assignedGroup: 'assigned_group',
  assigneeId: 'assignee_id',
  slaReferenceAt: 'sla_reference_at',
  resolvedAt: 'resolved_at',
};

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

export class TicketRepository {
  constructor(private readonly db: Client) {}

  async findById(id: string): Promise<Ticket | null> {
    const rs = await this.db.execute({ sql: `SELECT ${COLUMNS} FROM tickets WHERE id = ?`, args: [id] });
    const row = rs.rows[0];
    return row ? toTicket(row) : null;
  }

  async list(params: { requesterId?: string; filter: TicketListFilter; limit?: number }): Promise<Ticket[]> {
    const where: string[] = [];
    const args: InValue[] = [];
    if (params.requesterId !== undefined) {
      where.push('requester_id = ?');
      args.push(params.requesterId);
    }
    if (params.filter === 'open') {
      where.push(`status IN (${placeholders(OPEN_STATUSES.length)})`);
      args.push(...OPEN_STATUSES);
    } else if (params.filter === 'closed') {
      where.push(`status NOT IN (${placeholders(OPEN_STATUSES.length)})`);
      args.push(...OPEN_STATUSES);
    }
    args.push(params.limit ?? 100);
    const rs = await this.db.execute({
      sql: `SELECT ${COLUMNS} FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY updated_at DESC LIMIT ?`,
      args,
    });
    return rs.rows.map(toTicket);
  }

  async listEvents(ticketId: string): Promise<TicketEvent[]> {
    const rs = await this.db.execute({
      sql: 'SELECT id, ticket_id, at, actor_type, actor_id, kind, body FROM ticket_events WHERE ticket_id = ? ORDER BY id',
      args: [ticketId],
    });
    return rs.rows.map(toEvent);
  }

  /**
   * Cria o chamado numa única transação: gera o número (INC-/REQ-), grava o chamado e o
   * evento de abertura. Sem transação interativa para funcionar igual em arquivo e em memória.
   */
  async create(data: NewTicket, event: NewEvent): Promise<Ticket> {
    const seq = data.type;
    const nextId = `(SELECT ? || '-' || value FROM sequences WHERE name = ?)`;
    const statements: InStatement[] = [
      { sql: 'INSERT OR IGNORE INTO sequences (name, value) VALUES (?, 0)', args: [seq] },
      { sql: 'UPDATE sequences SET value = value + 1 WHERE name = ?', args: [seq] },
      {
        sql: `INSERT INTO tickets (${COLUMNS}) VALUES (${nextId}, ${placeholders(16)})`,
        args: [
          seq, seq,
          data.type, data.category, data.title, data.description, data.priority, data.priorityReason, data.impact,
          data.status, data.requesterId, data.assignedGroup, data.assigneeId, data.source, data.createdAt,
          data.updatedAt, data.slaReferenceAt, data.resolvedAt,
        ],
      },
      {
        sql: `INSERT INTO ticket_events (ticket_id, at, actor_type, actor_id, kind, body) VALUES (${nextId}, ?, ?, ?, ?, ?)`,
        args: [seq, seq, data.createdAt, event.actor.type, event.actor.id, event.kind, event.body],
      },
      { sql: `SELECT ? || '-' || value AS id FROM sequences WHERE name = ?`, args: [seq, seq] },
    ];
    const results = await this.db.batch(statements, 'write');
    const idRow = results.at(-1)?.rows[0];
    if (!idRow) throw new Error('Falha ao gerar o número do chamado');
    const created = await this.findById(text(idRow, 'id'));
    if (!created) throw new Error('Chamado criado não encontrado');
    return created;
  }

  /** Aplica mudanças e registra o evento correspondente, atomicamente. */
  async update(id: string, changes: TicketChanges, event: NewEvent, at: string): Promise<Ticket> {
    const sets = ['updated_at = ?'];
    const args: InValue[] = [at];
    for (const key of Object.keys(changes) as (keyof TicketChanges)[]) {
      const value = changes[key];
      if (value === undefined) continue;
      sets.push(`${CHANGE_COLUMNS[key]} = ?`);
      args.push(value);
    }
    await this.db.batch(
      [
        { sql: `UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`, args: [...args, id] },
        {
          sql: 'INSERT INTO ticket_events (ticket_id, at, actor_type, actor_id, kind, body) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id, at, event.actor.type, event.actor.id, event.kind, event.body],
        },
      ],
      'write',
    );
    const updated = await this.findById(id);
    if (!updated) throw new Error(`Chamado ${id} sumiu durante a atualização`);
    return updated;
  }

  /** Usado pelo seed: grava um chamado com número já definido. */
  async insertWithId(ticket: Ticket, events: readonly (NewEvent & { at: string })[]): Promise<void> {
    await this.db.batch(
      [
        {
          sql: `INSERT INTO tickets (${COLUMNS}) VALUES (${placeholders(17)})`,
          args: [
            ticket.id, ticket.type, ticket.category, ticket.title, ticket.description, ticket.priority,
            ticket.priorityReason, ticket.impact, ticket.status, ticket.requesterId, ticket.assignedGroup,
            ticket.assigneeId, ticket.source, ticket.createdAt, ticket.updatedAt, ticket.slaReferenceAt,
            ticket.resolvedAt,
          ],
        },
        ...events.map((e) => ({
          sql: 'INSERT INTO ticket_events (ticket_id, at, actor_type, actor_id, kind, body) VALUES (?, ?, ?, ?, ?, ?)',
          args: [ticket.id, e.at, e.actor.type, e.actor.id, e.kind, e.body],
        })),
      ],
      'write',
    );
  }

  async setSequence(name: string, value: number): Promise<void> {
    await this.db.execute({
      sql: 'INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
      args: [name, value],
    });
  }
}
