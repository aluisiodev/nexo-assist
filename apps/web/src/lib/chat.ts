import {
  CategorySchema,
  ConversationStatusSchema,
  HandoffReasonSchema,
  ImpactSchema,
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

export const DRAFT_KINDS = ['create', 'comment', 'reopen'] as const;
export const DraftKindSchema = z.enum(DRAFT_KINDS);
export type DraftKind = z.infer<typeof DraftKindSchema>;

export const DRAFT_STATUSES = ['pending', 'confirmed', 'cancelled', 'superseded'] as const;
export const DraftStatusSchema = z.enum(DRAFT_STATUSES);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/** Dados de um chamado novo, já classificados pelo código (prioridade e prazo). */
export const NewTicketDraftSchema = z.object({
  type: TicketTypeSchema,
  category: CategorySchema,
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  priorityReason: z.string(),
  impact: ImpactSchema,
  /** Prazo da primeira resposta se o chamado for criado agora. */
  dueAt: z.string(),
  slaTarget: z.string(),
});
export type NewTicketDraft = z.infer<typeof NewTicketDraftSchema>;

/** Atualização (complemento ou reabertura) de um chamado existente. */
export const TicketUpdateDraftSchema = z.object({
  ticketId: z.string(),
  ticketTitle: z.string(),
  text: z.string(),
});
export type TicketUpdateDraft = z.infer<typeof TicketUpdateDraftSchema>;

/**
 * Rascunho mostrado para confirmação. Nada é gravado no service desk antes de o
 * funcionário confirmar (Anexo A: "só cria ou atualiza depois da confirmação").
 */
export const DraftViewSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('create'),
    status: DraftStatusSchema,
    ticketId: z.string().nullable(),
    data: NewTicketDraftSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.enum(['comment', 'reopen']),
    status: DraftStatusSchema,
    ticketId: z.string().nullable(),
    data: TicketUpdateDraftSchema,
  }),
]);
export type DraftView = z.infer<typeof DraftViewSchema>;

export const MessageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ticket_list'), tickets: z.array(TicketSummarySchema), selectable: z.boolean() }),
  z.object({ type: z.literal('ticket_card'), ticket: TicketSummarySchema }),
  z.object({
    type: z.literal('quick_replies'),
    question: z.string().optional(),
    options: z.array(QuickReplySchema).min(1).max(6),
  }),
  z.object({ type: z.literal('article'), id: z.string(), title: z.string(), body: z.string() }),
  z.object({ type: z.literal('ticket_draft'), draft: DraftViewSchema }),
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
  /** Ferramentas que a IA chamou, na ordem (ex.: buscar_central_ajuda → responder). */
  tools: z.array(z.string()).optional(),
  durationMs: z.number().optional(),
  /** Tokens gastos na resposta (custo por conversa). */
  tokens: z.number().optional(),
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

/** Eventos enviados ao navegador enquanto a resposta é gerada (NDJSON). */
export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: ChatMessageSchema }),
  z.object({ type: z.literal('step'), step: AgentStepSchema }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('done'), conversation: ConversationViewSchema, messages: z.array(ChatMessageSchema) }),
  z.object({ type: z.literal('error'), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const ChatActionResultSchema = z.object({
  conversation: ConversationViewSchema,
  messages: z.array(ChatMessageSchema),
});
export type ChatActionResult = z.infer<typeof ChatActionResultSchema>;
