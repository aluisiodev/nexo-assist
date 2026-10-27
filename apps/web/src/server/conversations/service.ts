import {
  agentCanRespond,
  analystCanWrite,
  employeeCanSend,
  handoffDueAt,
  handoffTargetLabel,
  MAX_EMPLOYEE_MESSAGES_PER_SESSION,
  transition,
  type ConversationAction,
  type TransitionErrorCode,
} from '@nexo/domain';
import type { AgentTrace, ChatMessage, ChatSnapshot, ConversationView } from '../../lib/chat';
import type { AgentResponder, HandoffRequest, ServiceDeskAccess } from '../agent/types';
import type { SessionUser } from '../auth/sessions';
import type { Conversation, ConversationChanges, ConversationRepository } from './repository';

export type ConversationErrorCode =
  'not_found' | 'forbidden' | 'closed' | 'limit_reached' | 'conflict' | TransitionErrorCode;

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
  readonly clock?: () => Date;
  readonly log?: (message: string, extra?: unknown) => void;
}

const AGENT_NAME = 'Nexo Assist';

const TZ = 'America/Sao_Paulo';
const hhmm = (d: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
const day = (d: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ }).format(d);
/** "13:43" se for hoje; "28/10, 08:40" se for outro dia. */
const whenRelativeTo = (d: Date, now: Date): string => (day(d) === day(now) ? hhmm(d) : `${day(d)}, ${hhmm(d)}`);

/**
 * Orquestra o chat: guarda mensagens, respeita o estado da conversa (o agent fica mudo
 * quando está com um analista), aplica o limite de mensagens e executa transferências.
 * Não sabe se quem responde é o LLM ou o modo básico.
 */
export class ConversationService {
  private readonly repo: ConversationRepository;
  private readonly responder: AgentResponder;
  private readonly serviceDesk: ServiceDeskAccess;
  private readonly clock: () => Date;
  private readonly log: (message: string, extra?: unknown) => void;

  constructor(deps: ConversationServiceDeps) {
    this.repo = deps.repo;
    this.responder = deps.responder;
    this.serviceDesk = deps.serviceDesk;
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
   * Recebe uma mensagem do funcionário. Se a conversa está com o agent, pede a resposta;
   * se está com (ou aguardando) um analista, só guarda a mensagem.
   * Devolve as mensagens novas, na ordem.
   */
  async sendEmployeeMessage(
    user: SessionUser,
    text: string,
  ): Promise<{ conversation: ConversationView; messages: ChatMessage[] }> {
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

    const created: ChatMessage[] = [];
    const employeeMessage = await this.repo.appendMessage(
      conversation.id,
      { role: 'employee', authorId: user.employeeId, authorName: user.name, text },
      this.clock(),
    );
    created.push(employeeMessage);

    if (agentCanRespond(conversation.status)) {
      const history = await this.repo.listMessages(conversation.id);
      const reply = await this.safeRespond({
        conversation,
        user,
        history,
        text,
        messageId: employeeMessage.id,
        now: this.clock(),
      });
      for (const m of reply.messages) {
        created.push(
          await this.repo.appendMessage(
            conversation.id,
            {
              role: 'agent',
              authorId: null,
              authorName: AGENT_NAME,
              text: m.text,
              blocks: m.blocks ?? [],
              trace: m.trace,
            },
            this.clock(),
          ),
        );
      }
      if (reply.handoff) {
        const fresh = await this.mustFind(conversation.id);
        const result = await this.handoff(fresh, reply.handoff);
        created.push(...result.messages);
      }
    }

    conversation = await this.mustFind(conversation.id);
    if (conversation.employeeMessageCount >= MAX_EMPLOYEE_MESSAGES_PER_SESSION && conversation.status !== 'closed') {
      created.push(
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
    return { conversation: this.toView(conversation), messages: created };
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

  // ─── Internos ──────────────────────────────────────────────────────────────

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
  private async safeRespond(ctx: Parameters<AgentResponder['respond']>[0]) {
    const started = Date.now();
    try {
      return await this.responder.respond(ctx);
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
