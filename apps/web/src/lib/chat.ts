import {
  CategorySchema,
  ConversationStatusSchema,
  HandoffReasonSchema,
  PrioritySchema,
  TicketStatusSchema,
  TicketTypeSchema,
} from '@nexo/domain';
import { z } from 'zod';

/**
 * Contrato das mensagens do chat, compartilhado entre servidor e navegador.
 * Os "blocos" são os elementos ricos do protótipo (cards de chamado, seleção,
 * opções rápidas); são validados ao sair do banco e ao chegar no navegador.
 */

export const MESSAGE_ROLES = ['employee', 'agent', 'analyst', 'system'] as const;
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** Resumo de chamado usado nos cards (sem dados de outros funcionários). */
export const TicketSummarySchema = z.object({
  id: z.string(),
  type: TicketTypeSchema,
  title: z.string(),
  description: z.string(),
  category: CategorySchema,
  priority: PrioritySchema,
  status: TicketStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  slaTarget: z.string(),
});
export type TicketSummary = z.infer<typeof TicketSummarySchema>;

export const QuickReplySchema = z.object({
  label: z.string().min(1).max(80),
  /** Texto enviado ao clicar; se ausente, envia o próprio rótulo. */
  value: z.string().max(500).optional(),
});
export type QuickReply = z.infer<typeof QuickReplySchema>;

export const MessageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ticket_list'), tickets: z.array(TicketSummarySchema), selectable: z.boolean() }),
  z.object({ type: z.literal('ticket_card'), ticket: TicketSummarySchema }),
  z.object({
    type: z.literal('quick_replies'),
    question: z.string().optional(),
    options: z.array(QuickReplySchema).min(1).max(6),
  }),
  z.object({ type: z.literal('article'), id: z.string(), title: z.string(), body: z.string() }),
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;

/** Uma ação visível do agent ("consultou seus chamados"), com detalhe opcional. */
export const AgentStepSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
  status: z.enum(['ok', 'error']).optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

/**
 * Registro da decisão do agent para uma resposta: o que entendeu, o que fez, com que
 * segurança e por quê. É a "visibilidade das decisões" do PRD.
 */
export const AgentTraceSchema = z.object({
  /** Quem respondeu: o modelo de IA ou o modo básico (sem IA). */
  engine: z.string(),
  intent: z.string().optional(),
  understood: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  steps: z.array(AgentStepSchema),
  durationMs: z.number().optional(),
});
export type AgentTrace = z.infer<typeof AgentTraceSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  role: MessageRoleSchema,
  authorName: z.string().nullable(),
  text: z.string(),
  blocks: z.array(MessageBlockSchema),
  trace: AgentTraceSchema.nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationViewSchema = z.object({
  id: z.string(),
  status: ConversationStatusSchema,
  employeeMessageCount: z.number().int(),
  messageLimit: z.number().int(),
  assignedAnalystName: z.string().nullable(),
  handoffReason: HandoffReasonSchema.nullable(),
  createdAt: z.string(),
});
export type ConversationView = z.infer<typeof ConversationViewSchema>;

export const ChatSnapshotSchema = z.object({
  conversation: ConversationViewSchema,
  messages: z.array(ChatMessageSchema),
});
export type ChatSnapshot = z.infer<typeof ChatSnapshotSchema>;

export const SendMessageInputSchema = z.object({
  text: z.string().trim().min(1, 'Escreva uma mensagem.').max(2000, 'Mensagem muito longa (máx. 2000 caracteres).'),
});
