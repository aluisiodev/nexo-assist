import type { AgentStep } from '../../lib/chat';
import {
  ResponderUnavailableError,
  type AgentContext,
  type AgentEmitter,
  type AgentReply,
  type AgentResponder,
} from './types';

/**
 * Plano B: tenta cada responder em ordem (ex.: Gemini → Groq → modo básico).
 * Uma falha de provedor passa para o próximo e fica registrada no "por quê?".
 */
export class FallbackResponder implements AgentResponder {
  readonly name: string;

  constructor(
    private readonly chain: readonly AgentResponder[],
    private readonly log: (message: string) => void = (m) => console.warn(`[agent] ${m}`),
  ) {
    if (chain.length === 0) throw new Error('A cadeia de responders está vazia');
    this.name = chain[0]!.name;
  }

  async respond(ctx: AgentContext, emit?: AgentEmitter): Promise<AgentReply> {
    const notes: AgentStep[] = [];
    for (let i = 0; i < this.chain.length; i++) {
      const responder = this.chain[i]!;
      const isLast = i === this.chain.length - 1;
      try {
        const reply = await responder.respond(ctx, emit);
        if (notes.length === 0) return reply;
        return {
          ...reply,
          messages: reply.messages.map((m) => ({ ...m, trace: { ...m.trace, steps: [...notes, ...m.trace.steps] } })),
        };
      } catch (err) {
        if (isLast || !(err instanceof ResponderUnavailableError)) throw err;
        const next = this.chain[i + 1]!;
        const note: AgentStep = {
          label: `${responder.name} indisponível, usei ${next.name}`,
          detail: err.message,
          status: 'error',
        };
        notes.push(note);
        emit?.({ type: 'step', step: note });
        this.log(`${responder.name} falhou (${err.message}); tentando ${next.name}`);
      }
    }
    throw new Error('inalcançável');
  }
}
