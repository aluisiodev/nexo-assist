import { normalizeText } from '@nexo/domain';
import type { AgentContext, AgentEmitter, AgentReply, AgentResponder } from './types';

/** "Falar com um analista", "quero falar com um atendente"… (pedido explícito e curto). */
const EXPLICIT_ANALYST =
  /^(quero |preciso |posso )?(falar|conversar) com (um |uma |o |a )?(analista|atendente|humano|pessoa)\b/;
/** Seleção na lista de chamados: "INC-20311 · Notebook lento…". */
const TICKET_SELECTION = /^(INC|REQ)-\d+ · /;
/** "INC-20311: nova informação". */
const COMMENT_FORMAT = /^\s*(INC|REQ)[\s-]?\d{3,}\s*[:\-–]\s*.{10,}$/is;

/**
 * Atalhos sem IA para pedidos inequívocos: são respondidos por regras (instantâneo,
 * custo zero e funcionam mesmo com a IA fora do ar). O resto vai para o agent.
 */
export class RoutedResponder implements AgentResponder {
  readonly name: string;

  constructor(
    private readonly rules: AgentResponder,
    private readonly ai: AgentResponder,
  ) {
    this.name = ai.name;
  }

  static usesRules(text: string): boolean {
    const t = text.trim();
    return EXPLICIT_ANALYST.test(normalizeText(t)) || TICKET_SELECTION.test(t) || COMMENT_FORMAT.test(t);
  }

  respond(ctx: AgentContext, emit?: AgentEmitter): Promise<AgentReply> {
    return RoutedResponder.usesRules(ctx.text) ? this.rules.respond(ctx, emit) : this.ai.respond(ctx, emit);
  }
}
