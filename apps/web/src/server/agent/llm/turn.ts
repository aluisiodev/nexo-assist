import type { ArticleHit, TicketView } from '@nexo/domain';
import type { ActorServiceDeskClient } from '@nexo/service-desk-client';
import type { AgentStep, DraftView } from '../../../lib/chat';
import type { DraftService } from '../../drafts/service';
import type { AgentContext, AgentEmitter, HandoffRequest, ServiceDeskAccess } from '../types';

/** Resposta final que o modelo entrega pela ferramenta `responder`. */
export interface FinalAnswer {
  readonly message: string;
  readonly intent: string;
  readonly understood: string;
  readonly confidence: number;
  readonly reasoning: string;
  readonly showTickets: readonly string[];
  readonly showArticle: string | undefined;
  readonly question: string | undefined;
  readonly options: readonly string[];
}

export interface TurnDeps {
  readonly serviceDesk: ServiceDeskAccess;
  readonly drafts: DraftService;
}

/**
 * Estado de um turno do agent (uma mensagem do funcionário → uma resposta).
 * As ferramentas registram aqui o que fizeram; o código monta os cards a partir
 * destes dados (nunca do texto do modelo), então o modelo não consegue inventar
 * chamados nem mostrar dados de outra pessoa.
 */
export class TurnState {
  readonly steps: AgentStep[] = [];
  readonly tickets = new Map<string, TicketView>();
  readonly articles = new Map<string, ArticleHit>();
  readonly sd: ActorServiceDeskClient;
  draft: DraftView | null = null;
  handoff: HandoffRequest | null = null;
  final: FinalAnswer | null = null;

  constructor(
    readonly ctx: AgentContext,
    readonly deps: TurnDeps,
    private readonly emit?: AgentEmitter,
  ) {
    this.sd = deps.serviceDesk.forActor(ctx.user.employeeId, {
      onRetry: (info) =>
        this.step({
          label: 'sistema de chamados instável, tentei de novo',
          detail: `${info.reason} em ${info.method} ${info.path}`,
          status: 'error',
        }),
    });
  }

  step(step: AgentStep): void {
    this.steps.push(step);
    this.emit?.({ type: 'step', step });
  }

  remember(tickets: readonly TicketView[]): void {
    for (const t of tickets) this.tickets.set(t.id, t);
  }
}
