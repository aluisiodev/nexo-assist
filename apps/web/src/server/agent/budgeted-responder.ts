import type { AiBudget } from '../limits/ai-budget';
import type { AgentContext, AgentEmitter, AgentReply, AgentResponder } from './types';

/**
 * Usa a IA enquanto houver cota no dia; depois, responde no modo básico em vez de
 * bloquear o funcionário. A troca aparece no "por quê?".
 */
export class BudgetedResponder implements AgentResponder {
  readonly name: string;

  constructor(
    private readonly ai: AgentResponder,
    private readonly fallback: AgentResponder,
    private readonly budget: AiBudget,
  ) {
    this.name = ai.name;
  }

  async respond(ctx: AgentContext, emit?: AgentEmitter): Promise<AgentReply> {
    if (await this.budget.tryConsume()) return this.ai.respond(ctx, emit);

    const note = {
      label: 'cota diária de IA atingida, respondi no modo básico',
      detail: `Limite de ${this.budget.dailyLimit} respostas com IA por dia (AI_DAILY_CALL_LIMIT).`,
      status: 'error' as const,
    };
    emit?.({ type: 'step', step: note });
    const reply = await this.fallback.respond(ctx, emit);
    return {
      ...reply,
      messages: reply.messages.map((m) => ({ ...m, trace: { ...m.trace, steps: [note, ...m.trace.steps] } })),
    };
  }
}
