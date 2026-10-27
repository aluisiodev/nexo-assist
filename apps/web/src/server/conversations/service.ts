import {
  agentCanRespond,
  analystCanWrite,
  employeeCanSend,
  handoffDueAt,
  handoffTargetLabel,
  MAX_EMPLOYEE_MESSAGES_PER_SESSION,
  normalizeText,
  PRIORITY_LABELS,
  transition,
  type ConversationAction,
  type TicketView,
  type TransitionErrorCode,
} from '@nexo/domain';
import { ServiceDeskError } from '@nexo/service-desk-client';
import type {
  AgentTrace,
  ChatActionResult,
  ChatMessage,
  ChatSnapshot,
  ConversationView,
  MessageBlock,
} from '../../lib/chat';
import { toTicketSummary } from '../agent/ticket-summary';
import type { AgentEmitter, AgentResponder, HandoffRequest, ServiceDeskAccess } from '../agent/types';
import type { SessionUser } from '../auth/sessions';
import type { Draft } from '../drafts/repository';
import type { DraftService } from '../drafts/service';
import type { Conversation, ConversationChanges, ConversationRepository } from './repository';

export type ConversationErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'closed'
  | 'limit_reached'
  | 'conflict'
  | 'draft_not_pending'
  | 'service_desk_unavailable'
  | TransitionErrorCode;

/** Erro de regra da conversa, com status HTTP para as rotas. */
export class ConversationError extends Error {
  constructor(
    readonly code: ConversationErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ConversationError';
  }
}

export interface ConversationServiceDeps {
  readonly repo: ConversationRepository;
  readonly responder: AgentResponder;
  readonly serviceDesk: ServiceDeskAccess;
  readonly drafts: DraftService;
  readonly clock?: () => Date;
  readonly log?: (message: string, extra?: unknown) => void;
}

/** Eventos de progresso de uma mensagem (para o streaming na rota). */
export type SendEvent = { readonly type: 'message'; readonly message: ChatMessage } | Parameters<AgentEmitter>[0];

const AGENT_NAME = 'Nexo Assist';
const RULES_ENGINE = 'regras do service desk (sem IA)';
const HISTORY_LIMIT = 16;

/**
 * Respostas curtas e inequívocas a um rascunho pendente ("sim, pode abrir", "cancela").
 * Só frases compostas por estas palavras contam; qualquer outra coisa vai para a IA.
 */
const AFFIRM_START = new Set([
  'sim',
  's',
  'confirmo',
  'confirmar',
  'confirmado',
  'pode',
  'ok',
  'okay',
  'isso',
  'correto',
  'perfeito',
  'manda',
  'segue',
  'claro',
  'beleza',
  'certo',
  'exato',
]);
const AFFIRM_WORDS = new Set([
  ...AFFIRM_START,
  'abrir',
  'abre',
  'criar',
  'cria',
  'seguir',
  'mandar',
  'registrar',
  'enviar',
  'mesmo',
  'esta',
  'tudo',
  'por',
  'favor',
  'obrigado',
  'obrigada',
  'pfv',
  'pf',
  'ai',
  'la',
  'chamado',
]);
const CANCEL_START = new Set(['cancela', 'cancelar', 'cancele', 'desisti', 'esquece', 'deixa']);

function shortReply(normalized: string, start: Set<string>, words: Set<string>): boolean {
  const parts = normalized.split(' ').filter(Boolean);
  return (
    parts.length > 0 && parts.length <= 6 && start.has(parts[0]!) && parts.every((w) => words.has(w) || start.has(w))
  );
}
const isAffirmative = (n: string) => shortReply(n, AFFIRM_START, AFFIRM_WORDS);
const isCancel = (n: string) =>
  shortReply(n, CANCEL_START, new Set(['o', 'rascunho', 'pra', 'la', 'nao', 'precisa', 'por', 'favor', 'isso']));

const TZ = 'America/Sao_Paulo';
const hhmm = (d: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
const day = (d: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ }).format(d);
/** "13:43" se for hoje; "28/10, 08:40" se for outro dia. */
const whenRelativeTo = (d: Date, now: Date): string => (day(d) === day(now) ? hhmm(d) : `${day(d)}, ${hhmm(d)}`);

/**
 * Orquestra o chat: guarda mensagens, respeita o estado da conversa (o agent fica mudo
 * quando está com um analista), aplica o limite de mensagens, executa transferências e
 * transforma rascunhos confirmados em chamados. Não sabe se quem responde é a IA ou
 * o modo básico.
 */
export class ConversationService {
  private readonly repo: ConversationRepository;
  private readonly responder: AgentResponder;
  private readonly serviceDesk: ServiceDeskAccess;
  private readonly drafts: DraftService;
  private readonly clock: () => Date;
  private readonly log: (message: string, extra?: unknown) => void;

  constructor(deps: ConversationServiceDeps) {
    this.repo = deps.repo;
    this.responder = deps.responder;
    this.serviceDesk = deps.serviceDesk;
    this.drafts = deps.drafts;
    this.clock = deps.clock ?? (() => new Date());
    this.log = deps.log ?? ((m, e) => console.warn(`[conversas] ${m}`, e ?? ''));
  }

  toView(c: Conversation): ConversationView {
    return {
      id: c.id,
      status: c.status,
      employeeMessageCount: c.employeeMessageCount,
      messageLimit: MAX_EMPLOYEE_MESSAGES_PER_SESSION,
      assignedAnalystName: c.assignedAnalystName,
      handoffReason: c.handoffReason,
      createdAt: c.createdAt,
    };
  }

  // ─── Funcionário ───────────────────────────────────────────────────────────

  /** Conversa em aberto do funcionário; cria uma se não houver ("continuar de onde parei"). */
  async getOrStart(user: SessionUser): Promise<Conversation> {
    const active = await this.repo.findActiveByEmployee(user.employeeId);
    if (active) return active;
    return this.repo.create(
      { id: user.employeeId, name: user.name, email: user.email, department: user.department },
      this.clock(),
    );
  }

  async snapshotFor(user: SessionUser, afterSeq = 0): Promise<ChatSnapshot> {
    const conversation = await this.getOrStart(user);
    return {
      conversation: this.toView(conversation),
      messages: await this.repo.listMessages(conversation.id, afterSeq),
    };
  }

  /** Encerra a conversa atual (se houver) e começa outra, zerando o limite de mensagens. */
  async startNew(user: SessionUser): Promise<ChatSnapshot> {
    const active = await this.repo.findActiveByEmployee(user.employeeId);
    if (active) await this.applyAction(active, { type: 'close', by: 'employee' }, 'Conversa encerrada por você.');
    return this.snapshotFor(user);
  }

  /**
   * Recebe uma mensagem do funcionário. Se a conversa está com o agent, gera a resposta
   * (emitindo o progresso); se está com (ou aguardando) um analista, só guarda a mensagem.
   * Devolve as mensagens novas ou alteradas, na ordem.
   */
  async sendEmployeeMessage(
    user: SessionUser,
    text: string,
    onEvent?: (e: SendEvent) => void,
  ): Promise<ChatActionResult> {
    let conversation = await this.getOrStart(user);
    const allowed = employeeCanSend(conversation.status, conversation.employeeMessageCount);
    if (!allowed.ok) {
      throw allowed.reason === 'limit_reached'
        ? new ConversationError(
            'limit_reached',
            `Você chegou ao limite de ${MAX_EMPLOYEE_MESSAGES_PER_SESSION} mensagens desta sessão. Inicie uma nova conversa.`,
            429,
          )
        : new ConversationError('closed', 'Esta conversa foi encerrada.', 409);
    }

    const out: ChatMessage[] = [];
    const employeeMessage = await this.repo.appendMessage(
      conversation.id,
      { role: 'employee', authorId: user.employeeId, authorName: user.name, text },
      this.clock(),
    );
    out.push(employeeMessage);
    onEvent?.({ type: 'message', message: employeeMessage });

    if (agentCanRespond(conversation.status)) {
      const pending = await this.drafts.drafts.findPending(conversation.id);
      const normalized = normalizeText(text);

      if (pending && isAffirmative(normalized)) {
        // Confirmação por texto ("sim, pode abrir"): sem IA, a regra é inequívoca.
        out.push(...(await this.settleDraft(user, conversation, pending, 'confirm')));
      } else if (pending && isCancel(normalized)) {
        out.push(...(await this.settleDraft(user, conversation, pending, 'cancel')));
      } else {
        const history = await this.repo.listRecentMessages(conversation.id, HISTORY_LIMIT);
        const reply = await this.safeRespond(
          {
            conversation,
            user,
            history,
            text,
            messageId: employeeMessage.id,
            now: this.clock(),
            pendingDraft: pending?.view ?? null,
          },
          onEvent,
        );
        for (const m of reply.messages) {
          const saved = await this.appendAgent(conversation.id, m.text, m.blocks ?? [], m.trace);
          for (const b of saved.blocks)
            if (b.type === 'ticket_draft') await this.drafts.drafts.attachMessage(b.draft.id, saved.id);
          out.push(saved);
        }
        if (reply.handoff) {
          const result = await this.handoff(await this.mustFind(conversation.id), reply.handoff);
          out.push(...result.messages);
        }
      }
    }

    conversation = await this.mustFind(conversation.id);
    if (conversation.employeeMessageCount >= MAX_EMPLOYEE_MESSAGES_PER_SESSION && conversation.status !== 'closed') {
      out.push(
        await this.repo.appendMessage(
          conversation.id,
          {
            role: 'system',
            authorId: null,
            authorName: null,
            text: `Limite de ${MAX_EMPLOYEE_MESSAGES_PER_SESSION} mensagens desta sessão atingido. Para continuar, inicie uma nova conversa.`,
          },
          this.clock(),
        ),
      );
    }
    return { conversation: this.toView(conversation), messages: out };
  }

  /** Botão "Confirmar" do card de rascunho. */
  async confirmDraft(user: SessionUser, draftId: string): Promise<ChatActionResult> {
    return this.draftAction(user, draftId, 'confirm');
  }

  /** Botão "Cancelar" do card de rascunho. */
  async cancelDraft(user: SessionUser, draftId: string): Promise<ChatActionResult> {
    return this.draftAction(user, draftId, 'cancel');
  }

  /** Transfere para um analista: muda o estado, avisa na conversa e transfere o chamado relacionado. */
  async handoff(
    conversation: Conversation,
    request: HandoffRequest,
  ): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
    const now = this.clock();
    const updated = await this.applyAction(
      conversation,
      { type: 'transfer', reason: request.reason, summary: request.summary },
      null,
      {
        handoffReason: request.reason,
        handoffSummary: request.summary,
        handoffGroup: request.group,
        handoffConfidence: request.confidence ?? null,
        handoffTicketId: request.ticketId ?? null,
        handoffAt: now.toISOString(),
      },
    );

    if (request.ticketId) {
      try {
        await this.serviceDesk
          .forActor(conversation.employeeId)
          .transferTicket(
            request.ticketId,
            { group: request.group, summary: request.summary },
            `handoff-${conversation.id}-${request.ticketId}`,
          );
      } catch (err) {
        // A conversa já está na fila; o chamado pode ser transferido pelo analista depois.
        this.log(`não foi possível transferir o chamado ${request.ticketId}`, err);
      }
    }

    const due = handoffDueAt(request.reason, now);
    const messages = [
      await this.repo.appendMessage(
        conversation.id,
        {
          role: 'system',
          authorId: null,
          authorName: null,
          text: `Transferida para Suporte ${request.group} · ${hhmm(now)}. Um analista fala com você em até ${handoffTargetLabel(request.reason)} (até ${whenRelativeTo(due, now)}).`,
        },
        now,
      ),
    ];
    return { conversation: updated, messages };
  }

  // ─── Analista ──────────────────────────────────────────────────────────────

  async assume(analyst: SessionUser, conversationId: string): Promise<Conversation> {
    const c = await this.mustFind(conversationId);
    return this.applyAction(
      c,
      { type: 'assume', analystId: analyst.employeeId },
      `${analyst.name} assumiu · agent pausado · ${hhmm(this.clock())}`,
      { assignedAnalystName: analyst.name },
    );
  }

  async returnToAgent(analyst: SessionUser, conversationId: string): Promise<Conversation> {
    const c = await this.mustFind(conversationId);
    return this.applyAction(
      c,
      { type: 'return_to_agent', analystId: analyst.employeeId },
      `${analyst.name} devolveu a conversa ao Nexo Assist · ${hhmm(this.clock())}`,
      { assignedAnalystName: null },
    );
  }

  async closeByAnalyst(analyst: SessionUser, conversationId: string): Promise<Conversation> {
    const c = await this.mustFind(conversationId);
    return this.applyAction(
      c,
      { type: 'close', by: 'analyst', analystId: analyst.employeeId },
      `Atendimento encerrado por ${analyst.name} · ${hhmm(this.clock())}`,
    );
  }

  async sendAnalystMessage(analyst: SessionUser, conversationId: string, text: string): Promise<ChatMessage> {
    const c = await this.mustFind(conversationId);
    if (!analystCanWrite(c, analyst.employeeId)) {
      throw new ConversationError('not_assigned', 'Assuma o atendimento para responder.', 409);
    }
    return this.repo.appendMessage(
      c.id,
      { role: 'analyst', authorId: analyst.employeeId, authorName: analyst.name, text },
      this.clock(),
    );
  }

  // ─── Rascunhos ─────────────────────────────────────────────────────────────

  private async draftAction(
    user: SessionUser,
    draftId: string,
    action: 'confirm' | 'cancel',
  ): Promise<ChatActionResult> {
    const draft = await this.drafts.drafts.findById(draftId);
    // Rascunho de outra pessoa: "não encontrado", como no service desk.
    if (!draft || draft.employeeId !== user.employeeId) {
      throw new ConversationError('not_found', 'Rascunho não encontrado.', 404);
    }
    const conversation = await this.mustFind(draft.conversationId);
    if (conversation.status === 'closed') throw new ConversationError('closed', 'Esta conversa foi encerrada.', 409);
    const messages = await this.settleDraft(user, conversation, draft, action);
    return { conversation: this.toView(await this.mustFind(conversation.id)), messages };
  }

  /**
   * Confirma ou cancela um rascunho. Na confirmação, o código (não a IA) grava no
   * service desk, com o número do rascunho como chave de idempotência: um clique
   * duplo ou um retry após queda nunca cria dois chamados.
   */
  private async settleDraft(
    user: SessionUser,
    conversation: Conversation,
    draft: Draft,
    action: 'confirm' | 'cancel',
  ): Promise<ChatMessage[]> {
    const now = this.clock();
    if (draft.view.status !== 'pending') {
      throw new ConversationError('draft_not_pending', 'Este rascunho não está mais aguardando confirmação.', 409);
    }
    const out: ChatMessage[] = [];

    if (action === 'cancel') {
      if (!(await this.drafts.drafts.settle(draft.view.id, 'cancelled', null, now))) {
        throw new ConversationError('draft_not_pending', 'Este rascunho não está mais aguardando confirmação.', 409);
      }
      const card = await this.drafts.refreshBlock(this.drafts.withStatus(draft, 'cancelled', null));
      if (card) out.push(card);
      out.push(
        await this.appendAgent(
          conversation.id,
          'Tudo bem, cancelei o rascunho. Se precisar, é só me contar o que está acontecendo.',
          [],
          this.rulesTrace('cancelar_rascunho', `O funcionário cancelou o rascunho ${draft.view.id}.`, [
            { label: `cancelou o rascunho ${draft.view.id}` },
          ]),
        ),
      );
      return out;
    }

    // Trava o rascunho antes de chamar o service desk (evita confirmação dupla).
    if (!(await this.drafts.drafts.settle(draft.view.id, 'confirmed', null, now))) {
      throw new ConversationError('draft_not_pending', 'Este rascunho já foi confirmado.', 409);
    }
    const sd = this.serviceDesk.forActor(user.employeeId);
    let ticket: TicketView;
    try {
      if (draft.view.kind === 'create') {
        const d = draft.view.data;
        ticket = await sd.createTicket(
          {
            type: d.type,
            category: d.category,
            title: d.title,
            description: d.description,
            priority: d.priority,
            priorityReason: d.priorityReason,
            impact: d.impact,
            source: 'agent',
            // A duplicidade já foi verificada ao montar o rascunho.
            confirmedNotDuplicate: true,
          },
          draft.view.id,
        );
      } else if (draft.view.kind === 'comment') {
        ticket = await sd.addComment(draft.view.data.ticketId, { body: draft.view.data.text }, draft.view.id);
      } else {
        ticket = await sd.reopenTicket(draft.view.data.ticketId, { reason: draft.view.data.text }, draft.view.id);
      }
    } catch (err) {
      await this.drafts.drafts.reopen(draft.view.id, now);
      if (err instanceof ServiceDeskError && err.kind === 'unavailable') {
        throw new ConversationError(
          'service_desk_unavailable',
          'O sistema de chamados está fora do ar agora. Seu rascunho continua salvo: tente confirmar de novo em instantes.',
          503,
        );
      }
      if (err instanceof ServiceDeskError && err.kind === 'conflict') {
        throw new ConversationError('conflict', err.message, 409);
      }
      throw err;
    }

    await this.drafts.drafts.setTicketId(draft.view.id, ticket.id);
    const card = await this.drafts.refreshBlock(this.drafts.withStatus(draft, 'confirmed', ticket.id));
    if (card) out.push(card);

    const due = ticket.sla.dueAt ? ` Um analista responde até ${whenRelativeTo(new Date(ticket.sla.dueAt), now)}.` : '';
    const text =
      draft.view.kind === 'create'
        ? `Pronto: abri o ${ticket.id} com prioridade ${PRIORITY_LABELS[ticket.priority].toLowerCase()}.${due}`
        : draft.view.kind === 'comment'
          ? `Pronto, adicionei a informação ao ${ticket.id}. O analista vê isso no histórico do chamado.`
          : `Pronto, reabri o ${ticket.id}.${due}`;
    const verb = draft.view.kind === 'create' ? 'criou' : draft.view.kind === 'comment' ? 'atualizou' : 'reabriu';
    out.push(
      await this.appendAgent(
        conversation.id,
        text,
        [{ type: 'ticket_card', ticket: toTicketSummary(ticket) }],
        this.rulesTrace('confirmar_rascunho', `O funcionário confirmou o rascunho ${draft.view.id}.`, [
          { label: `${verb} o ${ticket.id}`, detail: `Rascunho ${draft.view.id} confirmado.` },
        ]),
      ),
    );

    // Anexo A: caso crítico vai direto para um analista.
    if (draft.view.kind === 'create' && ticket.priority === 'critica') {
      const result = await this.handoff(await this.mustFind(conversation.id), {
        reason: 'critical',
        group: 'N2',
        ticketId: ticket.id,
        confidence: 1,
        summary: `Chamado crítico ${ticket.id}: ${ticket.title}. ${ticket.description}`,
      });
      out.push(...result.messages);
    }
    return out;
  }

  private rulesTrace(intent: string, understood: string, steps: AgentTrace['steps']): AgentTrace {
    return {
      engine: RULES_ENGINE,
      intent,
      understood,
      confidence: 1,
      reasoning: 'Ação explícita do funcionário: o código grava no service desk só depois da confirmação (Anexo A).',
      steps,
    };
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  private appendAgent(conversationId: string, text: string, blocks: readonly MessageBlock[], trace: AgentTrace) {
    return this.repo.appendMessage(
      conversationId,
      { role: 'agent', authorId: null, authorName: AGENT_NAME, text, blocks, trace },
      this.clock(),
    );
  }

  private async mustFind(id: string): Promise<Conversation> {
    const c = await this.repo.findById(id);
    if (!c) throw new ConversationError('not_found', 'Conversa não encontrada.', 404);
    return c;
  }

  /** Valida a ação na máquina de estados e grava com controle de concorrência. */
  private async applyAction(
    c: Conversation,
    action: ConversationAction,
    systemNote: string | null,
    extra: ConversationChanges = {},
  ): Promise<Conversation> {
    const result = transition(c, action);
    if (!result.ok) throw new ConversationError(result.code, result.message, 409);
    const now = this.clock();
    const changes: ConversationChanges = {
      ...extra,
      status: result.next.status,
      assignedAnalystId: result.next.assignedAnalystId,
      ...(result.next.status === 'closed' && action.type === 'close'
        ? { closedBy: action.by, closedAt: now.toISOString() }
        : {}),
    };
    const updated = await this.repo.update(c, changes, now);
    if (!updated) {
      throw new ConversationError('conflict', 'A conversa mudou enquanto você agia. Atualize e tente de novo.', 409);
    }
    if (systemNote) {
      await this.repo.appendMessage(c.id, { role: 'system', authorId: null, authorName: null, text: systemNote }, now);
    }
    return updated;
  }

  /** O responder nunca derruba o chat: uma falha vira uma resposta honesta com opção de analista. */
  private async safeRespond(ctx: Parameters<AgentResponder['respond']>[0], emit?: AgentEmitter) {
    const started = Date.now();
    try {
      return await this.responder.respond(ctx, emit);
    } catch (err) {
      this.log('falha ao gerar resposta', err);
      const trace: AgentTrace = {
        engine: this.responder.name,
        intent: 'erro',
        confidence: 0,
        reasoning: 'Falha inesperada ao gerar a resposta; nada foi alterado.',
        steps: [
          { label: 'falhou ao responder', detail: err instanceof Error ? err.message : String(err), status: 'error' },
        ],
        durationMs: Date.now() - started,
      };
      return {
        messages: [
          {
            text: 'Tive um problema para responder agora. Pode tentar de novo? Se preferir, chamo um analista.',
            blocks: [{ type: 'quick_replies' as const, options: [{ label: 'Falar com um analista' }] }],
            trace,
          },
        ],
      };
    }
  }
}
