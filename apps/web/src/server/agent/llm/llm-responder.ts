import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { AgentStep, AgentTrace, MessageBlock, QuickReply } from '../../../lib/chat';
import { toTicketSummary } from '../ticket-summary';
import {
  ResponderUnavailableError,
  type AgentContext,
  type AgentEmitter,
  type AgentReply,
  type AgentResponder,
  type HandoffRequest,
} from '../types';
import { toModelMessages } from './history';
import { buildInstructions } from './instructions';
import { NEXO_TOOLS, TURN_KEY } from './tools';
import { TurnState, type TurnDeps } from './turn';

type AgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export interface LlmResponderOptions {
  /** Nome exibido em "Respondido por", ex.: "Gemini (gemini-flash-lite-latest)". */
  readonly name: string;
  /** String do roteador do Mastra ("google/…", "groq/…") ou um modelo (testes). */
  readonly model: AgentModel;
  readonly deps: TurnDeps;
  readonly maxSteps?: number;
  readonly timeoutMs?: number;
}

/** Abaixo disso, sem outra ação, o agent pede ajuda a um analista (Anexo A). */
export const LOW_CONFIDENCE = 0.35;

/**
 * Agent com IA (Mastra). O modelo decide quais ferramentas usar; o código decide o
 * que é regra: cards a partir de dados reais, oferta de analista para chamado vencido
 * e transferência quando a confiança é baixa.
 */
export class LlmResponder implements AgentResponder {
  readonly name: string;
  private readonly agent: Agent;
  private readonly deps: TurnDeps;
  private readonly maxSteps: number;
  private readonly timeoutMs: number;

  constructor(opts: LlmResponderOptions) {
    this.name = opts.name;
    this.deps = opts.deps;
    this.maxSteps = opts.maxSteps ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.agent = new Agent({
      id: 'nexo-assist',
      name: 'Nexo Assist',
      instructions: ({ requestContext }) => buildInstructions(requestContext.get(TURN_KEY as never) as TurnState),
      model: opts.model,
      tools: NEXO_TOOLS,
    });
  }

  async respond(ctx: AgentContext, emit?: AgentEmitter): Promise<AgentReply> {
    const started = Date.now();
    const turn = new TurnState(ctx, this.deps, emit);
    const requestContext = new RequestContext();
    requestContext.set(TURN_KEY as never, turn as never);

    let text = '';
    let tokens: number | undefined;
    try {
      const output = await this.agent.stream(toModelMessages(ctx.history), {
        requestContext,
        maxSteps: this.maxSteps,
        // Para assim que a resposta final é entregue (sem um passo extra de texto).
        stopWhen: [() => turn.final !== null],
        toolChoice: 'required',
        modelSettings: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          maxRetries: 1,
          timeout: { totalMs: this.timeoutMs, stepMs: Math.min(this.timeoutMs, 25_000) },
        },
      });
      for await (const chunk of output.fullStream) {
        if (chunk.type === 'error') throw (chunk.payload as { error?: unknown }).error ?? new Error('erro no modelo');
      }
      text = (await output.text) ?? '';
      const usage = (await output.usage) as { totalTokens?: number } | undefined;
      tokens = usage?.totalTokens;
    } catch (err) {
      throw new ResponderUnavailableError(this.name, describeError(err), { cause: err });
    }

    const final = turn.final;
    if (!final && !text.trim()) {
      throw new ResponderUnavailableError(this.name, 'O modelo terminou sem resposta.');
    }

    const message = final?.message ?? text.trim();
    const blocks: MessageBlock[] = [];
    const steps: AgentStep[] = turn.steps;

    // Cards: só de chamados que as ferramentas devolveram neste turno (ou buscados agora,
    // com a privacidade aplicada pelo service desk).
    const shown = [];
    for (const id of final?.showTickets ?? []) {
      const key = id.trim().toUpperCase();
      const ticket = turn.tickets.get(key) ?? (await turn.sd.getTicket(key).catch(() => null));
      if (ticket) shown.push(ticket);
    }
    if (shown.length === 1) blocks.push({ type: 'ticket_card', ticket: toTicketSummary(shown[0]!) });
    if (shown.length > 1) blocks.push({ type: 'ticket_list', tickets: shown.map(toTicketSummary), selectable: true });

    const article = final?.showArticle ? turn.articles.get(final.showArticle) : undefined;
    if (article) blocks.push({ type: 'article', id: article.id, title: article.title, body: article.body });

    if (turn.draft) blocks.push({ type: 'ticket_draft', draft: turn.draft });

    const options: QuickReply[] = (final?.options ?? []).map((label) => ({ label }));
    // Regra: chamado vencido → oferecer analista (Anexo A), mesmo que o modelo esqueça.
    const overdue = shown.some((t) => t.sla.overdue);
    if (overdue && !turn.handoff && !options.some((o) => /analista/i.test(o.label))) {
      options.push({ label: 'Falar com um analista' });
      steps.push({ label: 'ofereceu um analista', detail: 'Regra: chamado com prazo vencido.' });
    }
    if (!turn.draft && (options.length > 0 || final?.question)) {
      if (options.length > 0)
        blocks.push({ type: 'quick_replies', question: final?.question, options: options.slice(0, 4) });
    }

    // Regra: sem segurança e sem outra ação → pede ajuda a um analista.
    let handoff: HandoffRequest | undefined = turn.handoff ?? undefined;
    let reply = message;
    if (!handoff && !turn.draft && final && final.confidence < LOW_CONFIDENCE) {
      handoff = {
        reason: 'low_confidence',
        group: 'N1',
        confidence: final.confidence,
        summary: `O agent não teve segurança para decidir (confiança ${Math.round(final.confidence * 100)}%). Entendeu: ${final.understood}. Última mensagem: "${ctx.text}"`,
      };
      steps.push({
        label: 'pediu ajuda a um analista',
        detail: `Confiança ${Math.round(final.confidence * 100)}%, abaixo de ${LOW_CONFIDENCE * 100}%.`,
      });
      reply = `${message}\n\nComo não tenho segurança para resolver isso sozinho, chamei um analista para ajudar.`;
    }

    const trace: AgentTrace = {
      engine: this.name,
      ...(final
        ? {
            intent: final.intent,
            understood: final.understood,
            confidence: final.confidence,
            reasoning: final.reasoning,
          }
        : { reasoning: 'O modelo respondeu sem registrar a decisão.' }),
      steps,
      durationMs: Date.now() - started,
      ...(tokens !== undefined ? { tokens } : {}),
    };

    return { messages: [{ text: reply, blocks, trace }], ...(handoff ? { handoff } : {}) };
  }
}

/** Mensagem curta e sem dados sensíveis para o registro de decisões. */
function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: number; status?: number; name?: string; message?: string };
    const status = e.statusCode ?? e.status;
    if (status === 429) return 'limite de uso do provedor atingido (429)';
    if (status === 401 || status === 403) return `chave do provedor recusada (${status})`;
    if (status && status >= 500) return `provedor fora do ar (${status})`;
    if (e.name?.includes('Timeout')) return 'tempo de resposta esgotado';
    if (e.message?.match(/api key/i)) return 'chave do provedor ausente ou inválida';
    if (e.message) return e.message.slice(0, 160);
  }
  return 'falha desconhecida do provedor';
}
