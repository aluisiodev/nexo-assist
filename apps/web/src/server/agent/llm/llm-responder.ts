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
import { NEXO_TOOLS, ResponderInputSchema, toFinalAnswer, TURN_KEY } from './tools';
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
  /**
   * 'required' obriga o modelo a sempre usar uma ferramenta (garante o registro da
   * decisão). Nem todo provedor aceita bem: no Groq, usar 'auto'.
   */
  readonly toolChoice?: 'required' | 'auto';
  /** Opções específicas do provedor (ex.: esforço de raciocínio no Groq). */
  readonly providerOptions?: Record<string, Record<string, string>>;
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
  private readonly toolChoice: 'required' | 'auto';
  private readonly providerOptions: Record<string, Record<string, string>> | undefined;

  constructor(opts: LlmResponderOptions) {
    this.name = opts.name;
    this.deps = opts.deps;
    this.maxSteps = opts.maxSteps ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.toolChoice = opts.toolChoice ?? 'required';
    this.providerOptions = opts.providerOptions;
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
    const tools: string[] = [];
    try {
      const output = await this.agent.stream(toModelMessages(ctx.history), {
        requestContext,
        maxSteps: this.maxSteps,
        // Para assim que a resposta final é entregue (sem um passo extra de texto).
        stopWhen: [() => turn.final !== null],
        toolChoice: this.toolChoice,
        ...(this.providerOptions ? { providerOptions: this.providerOptions } : {}),
        modelSettings: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          maxRetries: 1,
          timeout: { totalMs: this.timeoutMs, stepMs: Math.min(this.timeoutMs, 25_000) },
        },
      });
      for await (const chunk of output.fullStream) {
        if (chunk.type === 'error') throw (chunk.payload as { error?: unknown }).error ?? new Error('erro no modelo');
        if (chunk.type === 'tool-call') tools.push((chunk.payload as { toolName: string }).toolName);
      }
      text = (await output.text) ?? '';
      const usage = (await output.usage) as { totalTokens?: number } | undefined;
      tokens = usage?.totalTokens;
    } catch (err) {
      await this.discard(turn);
      throw new ResponderUnavailableError(this.name, describeError(err), { cause: err });
    }

    // Alguns modelos (ex.: gpt-oss no Groq) escrevem a resposta final no texto em vez de
    // chamar a ferramenta. Lemos a decisão de lá para não perdê-la.
    if (!turn.final && text.trim()) {
      const salvaged = salvageFinalAnswer(text);
      if (salvaged) {
        turn.final = salvaged;
        turn.steps.push({
          label: 'leu a decisão escrita no texto',
          detail: 'O modelo escreveu a resposta no texto em vez de chamar a ferramenta "responder".',
        });
      }
    }

    // Sem decisão registrada, a resposta não vai para o funcionário: não há "por quê?"
    // para mostrar e o texto pode afirmar algo que nenhuma ferramenta fez. O turno é
    // desfeito e a cadeia de reserva tenta o próximo (outra IA ou o modo básico).
    const final = turn.final;
    if (!final) {
      await this.discard(turn);
      throw new ResponderUnavailableError(
        this.name,
        text.trim()
          ? 'o modelo respondeu sem registrar a decisão; a resposta foi descartada'
          : 'o modelo terminou sem resposta',
      );
    }

    const message = final.message;
    const blocks: MessageBlock[] = [];
    const steps: AgentStep[] = turn.steps;

    // Cards: só de chamados que as ferramentas devolveram neste turno (ou buscados agora,
    // com a privacidade aplicada pelo service desk).
    const shown = [];
    for (const id of final.showTickets) {
      const key = id.trim().toUpperCase();
      const ticket = turn.tickets.get(key) ?? (await turn.sd.getTicket(key).catch(() => null));
      if (ticket) shown.push(ticket);
    }
    if (shown.length === 1) blocks.push({ type: 'ticket_card', ticket: toTicketSummary(shown[0]!) });
    if (shown.length > 1) blocks.push({ type: 'ticket_list', tickets: shown.map(toTicketSummary), selectable: true });

    const article = final.showArticle ? turn.articles.get(final.showArticle) : undefined;
    if (article) blocks.push({ type: 'article', id: article.id, title: article.title, body: article.body });

    if (turn.draft) blocks.push({ type: 'ticket_draft', draft: turn.draft });

    const options: QuickReply[] = final.options.map((label) => ({ label }));
    // Regra: chamado vencido → oferecer analista (Anexo A), mesmo que o modelo esqueça.
    const overdue = shown.some((t) => t.sla.overdue);
    if (overdue && !turn.handoff && !options.some((o) => /analista/i.test(o.label))) {
      options.push({ label: 'Falar com um analista' });
      steps.push({ label: 'ofereceu um analista', detail: 'Regra: chamado com prazo vencido.' });
    }
    if (!turn.draft && options.length > 0) {
      blocks.push({ type: 'quick_replies', question: final.question, options: options.slice(0, 4) });
    }

    // Regra: sem segurança e sem outra ação → pede ajuda a um analista.
    let handoff: HandoffRequest | undefined = turn.handoff ?? undefined;
    let reply = message;
    if (!handoff && !turn.draft && final.confidence < LOW_CONFIDENCE) {
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
      intent: final.intent,
      understood: final.understood,
      confidence: final.confidence,
      reasoning: final.reasoning,
      steps,
      tools,
      durationMs: Date.now() - started,
      ...(tokens !== undefined ? { tokens } : {}),
    };

    return { messages: [{ text: reply, blocks, trace }], ...(handoff ? { handoff } : {}) };
  }

  /**
   * Desfaz o que o turno gravou antes de falhar: o rascunho montado nunca chegou ao
   * funcionário, então não pode ficar pendente (um "sim" depois confirmaria algo que ele
   * não viu). O rascunho que estava pendente antes do turno volta a valer.
   */
  private async discard(turn: TurnState): Promise<void> {
    if (!turn.draft) return;
    await this.deps.drafts
      .discard(turn.draft.id, turn.ctx.pendingDraft ?? null, turn.ctx.now)
      .catch((err: unknown) => console.warn('[agent] não consegui desfazer o rascunho', turn.draft?.id, err));
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

/**
 * Lê a decisão que o modelo escreveu no texto em vez de chamar `responder`. Aceita os
 * dois formatos vistos no gpt-oss: um objeto JSON e uma lista "chave: valor" (com ou
 * sem acento nas chaves). Só aceita se todos os campos obrigatórios passarem no schema.
 */
export function salvageFinalAnswer(text: string): ReturnType<typeof toFinalAnswer> | null {
  for (const raw of [jsonFields(text), keyValueFields(text)]) {
    if (!raw) continue;
    // null → ausente (o schema usa campos opcionais); chaves sem acento, como no schema.
    const cleaned = Object.fromEntries(
      Object.entries(raw)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [plainKey(k), v]),
    );
    const parsed = ResponderInputSchema.safeParse(cleaned);
    if (parsed.success) return toFinalAnswer(parsed.data);
  }
  return null;
}

const plainKey = (key: string) =>
  key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function jsonFields(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw: unknown = JSON.parse(text.slice(start, end + 1));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Chaves da ferramenta `responder`, com as variações de acento que o modelo usa. */
const KEY_PATTERN =
  /(?<![\p{L}_])["']?(mensagem|inten[cç][aã]o|entendimento|confian[cç]a|motivo|mostrar_chamados|mostrar_artigo|pergunta|op[cç][oõ]es)["']?\s*:/giu;

/** `confianca: 0.98 entendimento: "..." opcoes: ["a", "b"]` → objeto. */
function keyValueFields(text: string): Record<string, unknown> | null {
  const matches = [...text.matchAll(KEY_PATTERN)];
  if (matches.length < 2) return null;
  const out: Record<string, unknown> = {};
  matches.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = matches[i + 1]?.index ?? text.length;
    out[m[1]!] = parseValue(text.slice(from, to));
  });
  return out;
}

function parseValue(raw: string): unknown {
  const value = raw
    .trim()
    .replace(/[,;}]+$/, '')
    .trim();
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value.replace(/^["“']|["”']$/g, '').trim();
  }
}
