import { randomUUID } from 'node:crypto';
import type { Client, InValue, Row } from '@libsql/client';
import {
  ClosedBySchema,
  ConversationStatusSchema,
  HandoffReasonSchema,
  SupportGroupSchema,
  type ClosedBy,
  type ConversationStatus,
  type HandoffReason,
  type SupportGroup,
} from '@nexo/domain';
import { z } from 'zod';
import {
  AgentTraceSchema,
  MessageBlockSchema,
  type AgentTrace,
  type ChatMessage,
  type MessageBlock,
  type MessageRole,
} from '../../lib/chat';
import { integer, nullableNumber, nullableText, text } from '../db/rows';

export interface Conversation {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeEmail: string;
  readonly employeeDepartment: string;
  readonly status: ConversationStatus;
  readonly assignedAnalystId: string | null;
  readonly assignedAnalystName: string | null;
  readonly handoffReason: HandoffReason | null;
  readonly handoffSummary: string | null;
  readonly handoffGroup: SupportGroup | null;
  readonly handoffConfidence: number | null;
  readonly handoffTicketId: string | null;
  readonly handoffAt: string | null;
  readonly closedBy: ClosedBy | null;
  readonly closedAt: string | null;
  readonly employeeMessageCount: number;
  readonly lastMessageAt: string;
  readonly lastMessagePreview: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ConversationOwner {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly department: string;
}

export interface NewMessage {
  readonly role: MessageRole;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly text: string;
  readonly blocks?: readonly MessageBlock[];
  readonly trace?: AgentTrace | null;
}

/** Campos alterados numa mudança de estado. */
export type ConversationChanges = Partial<
  Pick<
    Conversation,
    | 'status'
    | 'assignedAnalystId'
    | 'assignedAnalystName'
    | 'handoffReason'
    | 'handoffSummary'
    | 'handoffGroup'
    | 'handoffConfidence'
    | 'handoffTicketId'
    | 'handoffAt'
    | 'closedBy'
    | 'closedAt'
  >
>;

const CHANGE_COLUMNS: Record<keyof ConversationChanges, string> = {
  status: 'status',
  assignedAnalystId: 'assigned_analyst_id',
  assignedAnalystName: 'assigned_analyst_name',
  handoffReason: 'handoff_reason',
  handoffSummary: 'handoff_summary',
  handoffGroup: 'handoff_group',
  handoffConfidence: 'handoff_confidence',
  handoffTicketId: 'handoff_ticket_id',
  handoffAt: 'handoff_at',
  closedBy: 'closed_by',
  closedAt: 'closed_at',
};

const nullableEnum = <T extends z.ZodType>(schema: T, value: string | null): z.output<T> | null =>
  value === null ? null : schema.parse(value);

function toConversation(row: Row): Conversation {
  return {
    id: text(row, 'id'),
    employeeId: text(row, 'employee_id'),
    employeeName: text(row, 'employee_name'),
    employeeEmail: text(row, 'employee_email'),
    employeeDepartment: text(row, 'employee_department'),
    status: ConversationStatusSchema.parse(text(row, 'status')),
    assignedAnalystId: nullableText(row, 'assigned_analyst_id'),
    assignedAnalystName: nullableText(row, 'assigned_analyst_name'),
    handoffReason: nullableEnum(HandoffReasonSchema, nullableText(row, 'handoff_reason')),
    handoffSummary: nullableText(row, 'handoff_summary'),
    handoffGroup: nullableEnum(SupportGroupSchema, nullableText(row, 'handoff_group')),
    handoffConfidence: nullableNumber(row, 'handoff_confidence'),
    handoffTicketId: nullableText(row, 'handoff_ticket_id'),
    handoffAt: nullableText(row, 'handoff_at'),
    closedBy: nullableEnum(ClosedBySchema, nullableText(row, 'closed_by')),
    closedAt: nullableText(row, 'closed_at'),
    employeeMessageCount: integer(row, 'employee_message_count'),
    lastMessageAt: text(row, 'last_message_at'),
    lastMessagePreview: nullableText(row, 'last_message_preview'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    version: integer(row, 'version'),
  };
}

const BlocksSchema = z.array(MessageBlockSchema);

function toMessage(row: Row): ChatMessage {
  const role = text(row, 'role');
  const trace = nullableText(row, 'trace');
  return {
    id: text(row, 'id'),
    seq: integer(row, 'seq'),
    role: role === 'employee' || role === 'agent' || role === 'analyst' ? role : 'system',
    authorName: nullableText(row, 'author_name'),
    text: text(row, 'text'),
    blocks: BlocksSchema.parse(JSON.parse(text(row, 'blocks'))),
    trace: trace === null ? null : AgentTraceSchema.parse(JSON.parse(trace)),
    createdAt: text(row, 'created_at'),
  };
}

const preview = (s: string): string => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

export class ConversationRepository {
  constructor(private readonly db: Client) {}

  async findById(id: string): Promise<Conversation | null> {
    const rs = await this.db.execute({ sql: 'SELECT * FROM conversations WHERE id = ?', args: [id] });
    const row = rs.rows[0];
    return row ? toConversation(row) : null;
  }

  /** A conversa em aberto mais recente do funcionário (para "continuar de onde parei"). */
  async findActiveByEmployee(employeeId: string): Promise<Conversation | null> {
    const rs = await this.db.execute({
      sql: `SELECT * FROM conversations WHERE employee_id = ? AND status != 'closed'
            ORDER BY created_at DESC LIMIT 1`,
      args: [employeeId],
    });
    const row = rs.rows[0];
    return row ? toConversation(row) : null;
  }

  async create(owner: ConversationOwner, now: Date): Promise<Conversation> {
    const id = `c_${randomUUID()}`;
    const at = now.toISOString();
    await this.db.execute({
      sql: `INSERT INTO conversations (id, employee_id, employee_name, employee_email, employee_department, status,
              last_message_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'agent', ?, ?, ?)`,
      args: [id, owner.id, owner.name, owner.email, owner.department, at, at, at],
    });
    const created = await this.findById(id);
    if (!created) throw new Error('Conversa criada não encontrada');
    return created;
  }

  /** Grava uma mensagem e atualiza o resumo da conversa, atomicamente. */
  async appendMessage(conversationId: string, message: NewMessage, now: Date): Promise<ChatMessage> {
    const id = randomUUID();
    const at = now.toISOString();
    const countIncrement = message.role === 'employee' ? 1 : 0;
    await this.db.batch(
      [
        {
          sql: `INSERT INTO messages (id, conversation_id, role, author_id, author_name, text, blocks, trace, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            id,
            conversationId,
            message.role,
            message.authorId,
            message.authorName,
            message.text,
            JSON.stringify(message.blocks ?? []),
            message.trace ? JSON.stringify(message.trace) : null,
            at,
          ],
        },
        {
          sql: `UPDATE conversations
                SET last_message_at = ?, last_message_preview = ?, updated_at = ?,
                    employee_message_count = employee_message_count + ?
                WHERE id = ?`,
          args: [at, preview(message.text), at, countIncrement, conversationId],
        },
      ],
      'write',
    );
    const rs = await this.db.execute({ sql: 'SELECT * FROM messages WHERE id = ?', args: [id] });
    const row = rs.rows[0];
    if (!row) throw new Error('Mensagem gravada não encontrada');
    return toMessage(row);
  }

  async listMessages(conversationId: string, afterSeq = 0, limit = 500): Promise<ChatMessage[]> {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM messages WHERE conversation_id = ? AND seq > ? ORDER BY seq LIMIT ?',
      args: [conversationId, afterSeq, limit],
    });
    return rs.rows.map(toMessage);
  }

  /**
   * Aplica uma mudança de estado só se ninguém mudou a conversa desde que ela foi lida
   * (controle otimista por `version`). Devolve null em caso de conflito.
   */
  async update(current: Conversation, changes: ConversationChanges, now: Date): Promise<Conversation | null> {
    const sets = ['version = version + 1', 'updated_at = ?'];
    const args: InValue[] = [now.toISOString()];
    for (const key of Object.keys(changes) as (keyof ConversationChanges)[]) {
      const value = changes[key];
      if (value === undefined) continue;
      sets.push(`${CHANGE_COLUMNS[key]} = ?`);
      args.push(value);
    }
    const rs = await this.db.execute({
      sql: `UPDATE conversations SET ${sets.join(', ')} WHERE id = ? AND version = ?`,
      args: [...args, current.id, current.version],
    });
    if (rs.rowsAffected === 0) return null;
    return this.findById(current.id);
  }
}
