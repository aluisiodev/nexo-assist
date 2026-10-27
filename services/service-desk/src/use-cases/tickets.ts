import {
  canReopen,
  isOpenStatus,
  textSimilarity,
  toTicketView,
  type AddCommentInput,
  type BusinessCalendar,
  type ChangeStatusInput,
  type CreateTicketInputSchema,
  type ReopenTicketInput,
  type SimilarTicket,
  type Ticket,
  type TicketListFilter,
  type TicketView,
  type TransferTicketInput,
} from '@nexo/domain';
import type { z } from 'zod';
import type { Actor, Repositories } from '../context';
import { conflict, forbidden, notFound } from '../errors';
import type { EventActor, TicketChanges } from '../repositories/tickets';

/**
 * Casos de uso do serviço de chamados. Cada função recebe o contexto (repositórios,
 * relógio, ator) e aplica as regras do Anexo A que pertencem ao sistema de chamados:
 * privacidade, duplicidade, reabertura e prazos. As rotas HTTP só traduzem entrada/saída.
 */
export interface UseCaseContext {
  readonly repos: Repositories;
  readonly now: Date;
  readonly actor: Actor;
  readonly calendar?: BusinessCalendar | undefined;
}

/** Acima disso, um chamado novo é considerado duplicado de um aberto. */
export const DUPLICATE_BLOCK_THRESHOLD = 0.8;
/** Acima disso, o chamado aparece como candidato a duplicado/reabertura. */
export const SIMILAR_SUGGEST_THRESHOLD = 0.4;
const CATEGORY_BONUS = 0.15;

const isAnalyst = (actor: Actor) => actor.employee.role === 'analyst';

function eventActor(actor: Actor): EventActor {
  if (actor.viaAgent) return { type: 'agent', id: actor.employee.id };
  return { type: isAnalyst(actor) ? 'analyst' : 'employee', id: actor.employee.id };
}

const view = (ctx: UseCaseContext, ticket: Ticket): TicketView => toTicketView(ticket, ctx.now, ctx.calendar);

/**
 * Busca um chamado respeitando a privacidade: funcionário só vê os próprios.
 * Responde "não encontrado" (e não "proibido") para não revelar que o número existe.
 */
async function loadVisible(ctx: UseCaseContext, id: string): Promise<Ticket> {
  const ticket = await ctx.repos.tickets.findById(id.trim().toUpperCase());
  if (!ticket || (!isAnalyst(ctx.actor) && ticket.requesterId !== ctx.actor.employee.id)) {
    throw notFound(`Chamado ${id} não encontrado.`);
  }
  return ticket;
}

function resolveRequester(ctx: UseCaseContext, requesterId: string | undefined): string {
  if (requesterId === undefined || requesterId === ctx.actor.employee.id) return ctx.actor.employee.id;
  if (!isAnalyst(ctx.actor)) throw forbidden('Você só pode consultar e abrir chamados seus.');
  return requesterId;
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export async function listTickets(
  ctx: UseCaseContext,
  params: { filter: TicketListFilter; requesterId?: string | undefined },
): Promise<TicketView[]> {
  const requesterId =
    params.requesterId === undefined && isAnalyst(ctx.actor) ? undefined : resolveRequester(ctx, params.requesterId);
  const tickets = await ctx.repos.tickets.list({ filter: params.filter, ...(requesterId ? { requesterId } : {}) });
  return tickets.map((t) => view(ctx, t));
}

export async function getTicket(ctx: UseCaseContext, id: string): Promise<TicketView> {
  return view(ctx, await loadVisible(ctx, id));
}

export async function getTicketEvents(ctx: UseCaseContext, id: string) {
  const ticket = await loadVisible(ctx, id);
  return ctx.repos.tickets.listEvents(ticket.id);
}

/**
 * Candidatos a duplicidade para um problema descrito em texto livre: chamados abertos
 * (atualizar em vez de duplicar) e resolvidos há até 7 dias (podem ser reabertos).
 */
export async function findSimilarTickets(
  ctx: UseCaseContext,
  params: { text: string; category?: string | undefined; requesterId?: string | undefined },
): Promise<SimilarTicket[]> {
  const requesterId = resolveRequester(ctx, params.requesterId);
  const tickets = await ctx.repos.tickets.list({ requesterId, filter: 'all', limit: 200 });
  const matches: SimilarTicket[] = [];
  for (const ticket of tickets) {
    const open = isOpenStatus(ticket.status);
    if (!open && !canReopen(ticket, ctx.now)) continue;
    let score = textSimilarity(params.text, `${ticket.title} ${ticket.description}`);
    if (params.category !== undefined && params.category === ticket.category) score += CATEGORY_BONUS;
    score = Math.min(1, Math.round(score * 100) / 100);
    if (score < SIMILAR_SUGGEST_THRESHOLD) continue;
    matches.push({ ticket: view(ctx, ticket), score, reason: open ? 'open_duplicate' : 'reopenable' });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ─── Comandos ────────────────────────────────────────────────────────────────

export type CreateTicketCommand = z.output<typeof CreateTicketInputSchema>;

export async function createTicket(ctx: UseCaseContext, input: CreateTicketCommand): Promise<TicketView> {
  const requesterId = resolveRequester(ctx, input.requesterId);
  const requester = await ctx.repos.employees.findById(requesterId);
  if (!requester) throw notFound(`Funcionário ${requesterId} não encontrado.`);

  if (!input.confirmedNotDuplicate) {
    const duplicates = (
      await findSimilarTickets(ctx, {
        text: `${input.title} ${input.description}`,
        category: input.category,
        requesterId,
      })
    ).filter((m) => m.reason === 'open_duplicate' && m.score >= DUPLICATE_BLOCK_THRESHOLD);
    const best = duplicates[0];
    if (best) {
      throw conflict(
        'possible_duplicate',
        `Já existe o chamado ${best.ticket.id} aberto sobre um problema parecido. Atualize-o em vez de abrir outro.`,
        { ticketId: best.ticket.id, score: best.score },
      );
    }
  }

  const at = ctx.now.toISOString();
  const ticket = await ctx.repos.tickets.create(
    {
      type: input.type,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      priorityReason: input.priorityReason ?? null,
      impact: input.impact,
      status: 'aguardando_analista',
      requesterId,
      assignedGroup: 'N1',
      assigneeId: null,
      source: isAnalyst(ctx.actor) && !ctx.actor.viaAgent ? 'analyst' : input.source,
      createdAt: at,
      updatedAt: at,
      slaReferenceAt: at,
      resolvedAt: null,
    },
    { kind: 'created', body: null, actor: eventActor(ctx.actor) },
  );
  return view(ctx, ticket);
}

/**
 * Complementa um chamado aberto. Se o suporte esperava uma resposta do funcionário,
 * o chamado volta para a fila e o prazo recomeça. Resposta de analista também reinicia
 * o prazo (o SLA vale para cada atualização).
 */
export async function addComment(ctx: UseCaseContext, id: string, input: AddCommentInput): Promise<TicketView> {
  const ticket = await loadVisible(ctx, id);
  if (!isOpenStatus(ticket.status)) {
    throw conflict(
      'ticket_closed',
      canReopen(ticket, ctx.now)
        ? `O chamado ${ticket.id} está resolvido. Ele pode ser reaberto (até 7 dias após a resolução).`
        : `O chamado ${ticket.id} está encerrado. Abra um novo chamado.`,
      { canReopen: canReopen(ticket, ctx.now) },
    );
  }
  const at = ctx.now.toISOString();
  const changes: TicketChanges = {};
  if (isAnalyst(ctx.actor) && !ctx.actor.viaAgent) {
    changes.slaReferenceAt = at;
  } else if (ticket.status === 'aguardando_usuario') {
    changes.status = 'aguardando_analista';
    changes.slaReferenceAt = at;
  }
  const updated = await ctx.repos.tickets.update(
    ticket.id,
    changes,
    { kind: 'comment', body: input.body, actor: eventActor(ctx.actor) },
    at,
  );
  return view(ctx, updated);
}

export async function reopenTicket(ctx: UseCaseContext, id: string, input: ReopenTicketInput): Promise<TicketView> {
  const ticket = await loadVisible(ctx, id);
  if (ticket.status !== 'resolvido') {
    throw conflict('not_resolved', `O chamado ${ticket.id} não está resolvido, então não precisa ser reaberto.`);
  }
  if (!canReopen(ticket, ctx.now)) {
    throw conflict(
      'reopen_window_expired',
      `O chamado ${ticket.id} foi resolvido há mais de 7 dias. Abra um novo chamado.`,
    );
  }
  const at = ctx.now.toISOString();
  const updated = await ctx.repos.tickets.update(
    ticket.id,
    { status: 'aguardando_analista', resolvedAt: null, slaReferenceAt: at, assigneeId: null },
    { kind: 'reopened', body: input.reason, actor: eventActor(ctx.actor) },
    at,
  );
  return view(ctx, updated);
}

/** Encaminha para um grupo de analistas, levando o resumo do caso. */
export async function transferTicket(ctx: UseCaseContext, id: string, input: TransferTicketInput): Promise<TicketView> {
  const ticket = await loadVisible(ctx, id);
  if (!isOpenStatus(ticket.status)) {
    throw conflict('ticket_closed', `O chamado ${ticket.id} não está aberto; não há o que transferir.`);
  }
  const at = ctx.now.toISOString();
  const updated = await ctx.repos.tickets.update(
    ticket.id,
    {
      assignedGroup: input.group,
      assigneeId: null,
      ...(ticket.status === 'aguardando_usuario' ? { status: 'aguardando_analista' as const } : {}),
    },
    { kind: 'transferred', body: `Transferido para ${input.group}. ${input.summary}`, actor: eventActor(ctx.actor) },
    at,
  );
  return view(ctx, updated);
}

/** Mudança de status feita por analista (assumir, pedir informação, resolver…). */
export async function changeTicketStatus(
  ctx: UseCaseContext,
  id: string,
  input: ChangeStatusInput,
): Promise<TicketView> {
  if (!isAnalyst(ctx.actor)) throw forbidden('Apenas analistas podem mudar o status de um chamado.');
  const ticket = await loadVisible(ctx, id);
  if (ticket.status === input.status) return view(ctx, ticket);

  const at = ctx.now.toISOString();
  const changes: TicketChanges = { status: input.status, slaReferenceAt: at };
  if (input.status === 'resolvido') changes.resolvedAt = at;
  else if (isOpenStatus(input.status)) changes.resolvedAt = null;
  if (input.status === 'em_andamento') changes.assigneeId = ctx.actor.employee.id;

  const updated = await ctx.repos.tickets.update(
    ticket.id,
    changes,
    {
      kind: 'status_changed',
      body: input.note ?? `Status: ${ticket.status} → ${input.status}`,
      actor: eventActor(ctx.actor),
    },
    at,
  );
  return view(ctx, updated);
}
