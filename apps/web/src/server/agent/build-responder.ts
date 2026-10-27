import type { AiBudget } from '../limits/ai-budget';
import { BasicResponder } from './basic-responder';
import { BudgetedResponder } from './budgeted-responder';
import { FallbackResponder } from './fallback-responder';
import { LlmResponder } from './llm/llm-responder';
import type { TurnDeps } from './llm/turn';
import { RoutedResponder } from './routed-responder';
import type { AgentResponder } from './types';

export type LlmProvider = 'google' | 'groq' | 'none';

export interface ResponderConfig {
  readonly provider: LlmProvider;
  readonly fallbackProvider: LlmProvider;
  readonly googleModel: string;
  readonly groqModel: string;
  readonly hasGoogleKey: boolean;
  readonly hasGroqKey: boolean;
}

/**
 * Monta quem responde: atalhos por regras → IA principal → IA reserva → modo básico.
 * Provedores sem chave são ignorados, então sem nenhuma chave o app funciona no modo
 * básico. As chaves ficam só no ambiente (o Mastra as lê de GOOGLE_GENERATIVE_AI_API_KEY
 * e GROQ_API_KEY).
 */
export function buildResponder(
  config: ResponderConfig,
  deps: TurnDeps,
  budget?: AiBudget,
): { responder: AgentResponder; chain: string[] } {
  const basic = new BasicResponder(deps.serviceDesk);
  const make = (p: LlmProvider): AgentResponder | null => {
    if (p === 'google' && config.hasGoogleKey) {
      return new LlmResponder({ name: `Gemini (${config.googleModel})`, model: `google/${config.googleModel}`, deps });
    }
    if (p === 'groq' && config.hasGroqKey) {
      // No Groq, 'required' faz o provedor recusar respostas em texto (erro 400).
      return new LlmResponder({
        name: `Groq (${config.groqModel})`,
        model: `groq/${config.groqModel}`,
        deps,
        toolChoice: 'auto',
        // Modelos gpt-oss "pensam" antes de responder; esforço baixo = mais rápido e barato.
        ...(config.groqModel.includes('gpt-oss') ? { providerOptions: { groq: { reasoningEffort: 'low' } } } : {}),
      });
    }
    return null;
  };

  const ais = [...new Set([config.provider, config.fallbackProvider])]
    .map(make)
    .filter((r): r is AgentResponder => r !== null);
  if (ais.length === 0) return { responder: basic, chain: [basic.name] };

  const chain = new FallbackResponder([...ais, basic]);
  // A cota só conta respostas que passam pela IA; atalhos por regras não gastam nada.
  const ai = budget && budget.dailyLimit > 0 ? new BudgetedResponder(chain, basic, budget) : chain;
  return { responder: new RoutedResponder(basic, ai), chain: [...ais.map((a) => a.name), basic.name] };
}
