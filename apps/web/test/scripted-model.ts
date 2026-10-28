import type { Agent } from '@mastra/core/agent';
import { MockLanguageModelV3 } from 'ai/test';

type AgentModel = ConstructorParameters<typeof Agent>[0]['model'];

/**
 * Modelo de IA simulado para testes: cada chamada ao modelo consome o próximo "passo"
 * do roteiro (chamar ferramentas ou responder texto). Permite testar o agent de verdade
 * (Mastra, ferramentas, regras) sem rede, sem chave e sem custo.
 */
export type ScriptStep =
  | { readonly tools: readonly { readonly name: string; readonly args: Record<string, unknown> }[] }
  | { readonly text: string }
  | { readonly error: Error; readonly once?: boolean };

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

export function scriptedModel(script: readonly ScriptStep[]) {
  const steps = [...script];
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    provider: 'teste',
    modelId: 'roteiro',
    doStream: async (options) => {
      prompts.push(options.prompt);
      const step = steps[0] ?? { text: '(fim do roteiro)' };
      // Falha "persistente": o provedor continua fora do ar mesmo com novas tentativas.
      // Com `once`, a falha acontece uma vez só (ex.: chamada malformada que se resolve ao repetir).
      if ('error' in step) {
        if (step.once) steps.shift();
        throw step.error;
      }
      steps.shift();
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if ('text' in step) {
        parts.push(
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: step.text },
          { type: 'text-end', id: 't1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        );
      } else {
        step.tools.forEach((t, i) =>
          parts.push({
            type: 'tool-call',
            toolCallId: `call-${prompts.length}-${i}`,
            toolName: t.name,
            input: JSON.stringify(t.args),
          }),
        );
        parts.push({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage });
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(p as never);
            controller.close();
          },
        }),
      };
    },
  });
  // O mock do AI SDK implementa a mesma especificação (v3) que o Mastra aceita.
  return { model: model as unknown as AgentModel, prompts, remaining: () => steps.length };
}
