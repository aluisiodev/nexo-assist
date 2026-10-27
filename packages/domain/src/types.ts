import { z } from 'zod';

/**
 * Vocabulário do service desk (Anexo A do PRD).
 * Os valores internos são estáveis e sem acento; os rótulos ficam nos mapas *_LABELS.
 */

// ─── Tipo de chamado ─────────────────────────────────────────────────────────
export const TICKET_TYPES = ['INC', 'REQ'] as const;
export const TicketTypeSchema = z.enum(TICKET_TYPES);
export type TicketType = z.infer<typeof TicketTypeSchema>;
export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  INC: 'Incidente',
  REQ: 'Requisição',
};

// ─── Categoria ───────────────────────────────────────────────────────────────
export const CATEGORIES = ['acesso', 'rede_vpn', 'hardware', 'software', 'email', 'outros'] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;
export const CATEGORY_LABELS: Record<Category, string> = {
  acesso: 'Acesso',
  rede_vpn: 'Rede e VPN',
  hardware: 'Hardware',
  software: 'Software',
  email: 'E-mail',
  outros: 'Outros',
};

// ─── Prioridade ──────────────────────────────────────────────────────────────
export const PRIORITIES = ['critica', 'alta', 'media', 'baixa'] as const;
export const PrioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof PrioritySchema>;
export const PRIORITY_LABELS: Record<Priority, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

// ─── Quem é afetado (impacto) ────────────────────────────────────────────────
export const IMPACTS = ['individual', 'equipe', 'empresa', 'desconhecido'] as const;
export const ImpactSchema = z.enum(IMPACTS);
export type Impact = z.infer<typeof ImpactSchema>;
export const IMPACT_LABELS: Record<Impact, string> = {
  individual: 'Somente você',
  equipe: 'Sua equipe',
  empresa: 'Toda a empresa',
  desconhecido: 'Não informado',
};

// ─── Status ──────────────────────────────────────────────────────────────────
export const TICKET_STATUSES = [
  'aguardando_analista',
  'em_andamento',
  'aguardando_usuario',
  'aprovado',
  'resolvido',
  'fechado',
] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  aguardando_analista: 'Aguardando analista',
  em_andamento: 'Em andamento',
  aguardando_usuario: 'Aguardando você',
  aprovado: 'Aprovado',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
};

/** Status em que o chamado ainda está "aberto" (conta para duplicidade). */
export const OPEN_STATUSES: readonly TicketStatus[] = [
  'aguardando_analista',
  'em_andamento',
  'aguardando_usuario',
  'aprovado',
];
export function isOpenStatus(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Status em que o prazo está correndo contra o suporte. */
export const SLA_RUNNING_STATUSES: readonly TicketStatus[] = ['aguardando_analista', 'em_andamento', 'aprovado'];

// ─── Grupos de suporte e atores ──────────────────────────────────────────────
export const SUPPORT_GROUPS = ['N1', 'N2'] as const;
export const SupportGroupSchema = z.enum(SUPPORT_GROUPS);
export type SupportGroup = z.infer<typeof SupportGroupSchema>;

export const EMPLOYEE_ROLES = ['employee', 'analyst'] as const;
export const EmployeeRoleSchema = z.enum(EMPLOYEE_ROLES);
export type EmployeeRole = z.infer<typeof EmployeeRoleSchema>;

export const ACTOR_TYPES = ['employee', 'analyst', 'agent', 'system'] as const;
export const ActorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const TICKET_SOURCES = ['agent', 'portal', 'analyst'] as const;
export const TicketSourceSchema = z.enum(TICKET_SOURCES);
export type TicketSource = z.infer<typeof TicketSourceSchema>;

export const TICKET_EVENT_KINDS = ['created', 'comment', 'status_changed', 'transferred', 'reopened'] as const;
export const TicketEventKindSchema = z.enum(TICKET_EVENT_KINDS);
export type TicketEventKind = z.infer<typeof TicketEventKindSchema>;

// ─── Entidades ───────────────────────────────────────────────────────────────
const IsoDate = z.iso.datetime();

export const EmployeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  department: z.string().min(1),
  role: EmployeeRoleSchema,
  supportGroup: SupportGroupSchema.nullable(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const TicketSchema = z.object({
  id: z.string().regex(/^(INC|REQ)-\d+$/),
  type: TicketTypeSchema,
  category: CategorySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  priority: PrioritySchema,
  /** Por que esta prioridade foi escolhida (transparência). */
  priorityReason: z.string().nullable(),
  impact: ImpactSchema,
  status: TicketStatusSchema,
  requesterId: z.string().min(1),
  assignedGroup: SupportGroupSchema.nullable(),
  assigneeId: z.string().nullable(),
  source: TicketSourceSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  /** Início da contagem do prazo atual (abertura, última resposta do suporte ou reabertura). */
  slaReferenceAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const SlaInfoSchema = z.object({
  /** Quando vence o prazo atual; null se o prazo estiver pausado ou encerrado. */
  dueAt: IsoDate.nullable(),
  overdue: z.boolean(),
  /** Ex.: "4 horas úteis". */
  target: z.string(),
  /** Prazo não corre (chamado aguardando o funcionário, resolvido ou fechado). */
  paused: z.boolean(),
});
export type SlaInfo = z.infer<typeof SlaInfoSchema>;

/** Chamado como é devolvido pela API: com prazo e reabertura já calculados. */
export const TicketViewSchema = TicketSchema.extend({
  sla: SlaInfoSchema,
  canReopen: z.boolean(),
});
export type TicketView = z.infer<typeof TicketViewSchema>;

export const TicketEventSchema = z.object({
  id: z.number().int(),
  ticketId: z.string(),
  at: IsoDate,
  actorType: ActorTypeSchema,
  actorId: z.string().nullable(),
  kind: TicketEventKindSchema,
  body: z.string().nullable(),
});
export type TicketEvent = z.infer<typeof TicketEventSchema>;

export const ArticleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  category: CategorySchema,
  tags: z.array(z.string()),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ArticleHitSchema = ArticleSchema.extend({ score: z.number() });
export type ArticleHit = z.infer<typeof ArticleHitSchema>;

export const SIMILAR_REASONS = ['open_duplicate', 'reopenable'] as const;
export const SimilarTicketSchema = z.object({
  ticket: TicketViewSchema,
  score: z.number(),
  /** open_duplicate: atualizar em vez de abrir outro; reopenable: resolvido há até 7 dias. */
  reason: z.enum(SIMILAR_REASONS),
});
export type SimilarTicket = z.infer<typeof SimilarTicketSchema>;

// ─── Entradas das operações ──────────────────────────────────────────────────
export const CreateTicketInputSchema = z.object({
  type: TicketTypeSchema,
  category: CategorySchema,
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(4000),
  priority: PrioritySchema,
  priorityReason: z.string().trim().max(500).optional(),
  impact: ImpactSchema,
  /** Só analistas podem abrir em nome de outra pessoa. */
  requesterId: z.string().min(1).optional(),
  source: TicketSourceSchema.default('agent'),
  /**
   * O serviço recusa (409) um chamado quase idêntico a outro aberto do mesmo funcionário.
   * Só envie true depois que o funcionário confirmar que é um problema diferente.
   */
  confirmedNotDuplicate: z.boolean().default(false),
});
export type CreateTicketInput = z.input<typeof CreateTicketInputSchema>;

export const AddCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

export const ReopenTicketInputSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});
export type ReopenTicketInput = z.infer<typeof ReopenTicketInputSchema>;

export const TransferTicketInputSchema = z.object({
  group: SupportGroupSchema,
  /** Resumo do caso para o analista não precisar perguntar tudo de novo. */
  summary: z.string().trim().min(10).max(2000),
});
export type TransferTicketInput = z.infer<typeof TransferTicketInputSchema>;

export const ChangeStatusInputSchema = z.object({
  status: TicketStatusSchema,
  note: z.string().trim().max(2000).optional(),
});
export type ChangeStatusInput = z.infer<typeof ChangeStatusInputSchema>;

export const TICKET_LIST_FILTERS = ['open', 'closed', 'all'] as const;
export const TicketListFilterSchema = z.enum(TICKET_LIST_FILTERS);
export type TicketListFilter = z.infer<typeof TicketListFilterSchema>;
