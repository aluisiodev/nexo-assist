import {
  ArticleHitSchema,
  ArticleSchema,
  EmployeeSchema,
  SimilarTicketSchema,
  TicketEventSchema,
  TicketViewSchema,
  type AddCommentInput,
  type Category,
  type ChangeStatusInput,
  type CreateTicketInput,
  type ReopenTicketInput,
  type TicketListFilter,
  type TransferTicketInput,
} from '@nexo/domain';
import { z } from 'zod';
import { isTransientStatus, kindFromStatus, ServiceDeskError } from './errors';

export interface RetryInfo {
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: string;
  readonly method: string;
  readonly path: string;
}

export interface ServiceDeskClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Tempo máximo por tentativa. */
  readonly timeoutMs?: number;
  /** Tentativas extras após a primeira, só para falhas transitórias. */
  readonly maxRetries?: number;
  /** Base do backoff exponencial. */
  readonly baseDelayMs?: number;
  /** Teto de espera entre tentativas (inclusive vindo de Retry-After). */
  readonly maxDelayMs?: number;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** Observabilidade: chamado antes de cada nova tentativa (o agent registra isso no trace). */
  readonly onRetry?: (info: RetryInfo) => void;
}

interface RequestOptions {
  readonly actorId?: string;
  readonly viaAgent?: boolean;
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

const TicketEnvelope = z.object({ ticket: TicketViewSchema });

/**
 * Cliente do service desk legado.
 *
 * - Timeout por tentativa e retry com backoff exponencial + jitter em 502/503/504,
 *   timeout e erro de rede, respeitando Retry-After.
 * - GET sempre pode repetir. POST só repete com Idempotency-Key, que o serviço usa
 *   para não executar a mesma operação duas vezes. Por isso os métodos de escrita exigem
 *   a chave (ex.: id do rascunho confirmado).
 * - Toda resposta é validada contra o contrato (zod) antes de chegar ao agent.
 */
export function createServiceDeskClient(options: ServiceDeskClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  function backoff(attempt: number, retryAfterHeader: string | null): number {
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const fromHeader = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 0;
    const exponential = baseDelayMs * 2 ** (attempt - 1);
    const jitter = exponential * 0.25 * random();
    return Math.min(maxDelayMs, Math.max(fromHeader, exponential + jitter));
  }

  async function request<S extends z.ZodType>(
    schema: S,
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions = {},
  ): Promise<z.output<S>> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = { accept: 'application/json', 'x-api-key': options.apiKey };
    if (opts.actorId) headers['x-actor-id'] = opts.actorId;
    if (opts.viaAgent) headers['x-actor-via'] = 'agent';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';

    const canRetry = method === 'GET' || opts.idempotencyKey !== undefined;
    const attemptsAllowed = canRetry ? maxRetries + 1 : 1;
    let lastProblem = '';

    for (let attempt = 1; attempt <= attemptsAllowed; attempt++) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers,
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastProblem =
          err instanceof Error && err.name === 'TimeoutError' ? `timeout de ${timeoutMs} ms` : 'falha de rede';
        if (attempt < attemptsAllowed) {
          const delayMs = backoff(attempt, null);
          options.onRetry?.({ attempt, delayMs, reason: lastProblem, method, path });
          await sleep(delayMs);
          continue;
        }
        throw new ServiceDeskError('unavailable', `Sistema de chamados indisponível (${lastProblem}).`, {
          attempts: attempt,
          cause: err,
        });
      }

      if (isTransientStatus(response.status) && attempt < attemptsAllowed) {
        lastProblem = `HTTP ${response.status}`;
        const delayMs = backoff(attempt, response.headers.get('retry-after'));
        options.onRetry?.({ attempt, delayMs, reason: lastProblem, method, path });
        await response.body?.cancel();
        await sleep(delayMs);
        continue;
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ErrorBodySchema.safeParse(payload);
        const message = parsed.success ? parsed.data.error.message : `HTTP ${response.status}`;
        throw new ServiceDeskError(kindFromStatus(response.status), message, {
          status: response.status,
          attempts: attempt,
          ...(parsed.success ? { code: parsed.data.error.code, details: parsed.data.error.details } : {}),
        });
      }

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new ServiceDeskError('invalid_response', `Resposta inesperada do service desk em ${method} ${path}.`, {
          status: response.status,
          details: parsed.error.issues,
        });
      }
      return parsed.data;
    }
    // Inalcançável: o laço sempre retorna ou lança.
    throw new ServiceDeskError('unavailable', 'Sistema de chamados indisponível.');
  }

  const enc = encodeURIComponent;

  /** Operações em nome de um funcionário (o id vem da sessão, nunca do LLM). */
  function forActor(actorId: string, opts: { viaAgent?: boolean } = {}) {
    const base = { actorId, viaAgent: opts.viaAgent ?? false };
    return {
      async listTickets(params: { status?: TicketListFilter; requesterId?: string } = {}) {
        const res = await request(z.object({ tickets: z.array(TicketViewSchema) }), 'GET', '/tickets', {
          ...base,
          query: { status: params.status ?? 'open', requesterId: params.requesterId },
        });
        return res.tickets;
      },
      async getTicket(id: string) {
        return (await request(TicketEnvelope, 'GET', `/tickets/${enc(id)}`, base)).ticket;
      },
      async getTicketEvents(id: string) {
        const res = await request(
          z.object({ events: z.array(TicketEventSchema) }),
          'GET',
          `/tickets/${enc(id)}/events`,
          base,
        );
        return res.events;
      },
      async findSimilar(params: { text: string; category?: Category; requesterId?: string }) {
        const res = await request(z.object({ matches: z.array(SimilarTicketSchema) }), 'GET', '/tickets/similar', {
          ...base,
          query: { text: params.text, category: params.category, requesterId: params.requesterId },
        });
        return res.matches;
      },
      async createTicket(input: CreateTicketInput, idempotencyKey: string) {
        return (await request(TicketEnvelope, 'POST', '/tickets', { ...base, body: input, idempotencyKey })).ticket;
      },
      async addComment(id: string, input: AddCommentInput, idempotencyKey: string) {
        return (
          await request(TicketEnvelope, 'POST', `/tickets/${enc(id)}/comments`, {
            ...base,
            body: input,
            idempotencyKey,
          })
        ).ticket;
      },
      async reopenTicket(id: string, input: ReopenTicketInput, idempotencyKey: string) {
        return (
          await request(TicketEnvelope, 'POST', `/tickets/${enc(id)}/reopen`, { ...base, body: input, idempotencyKey })
        ).ticket;
      },
      async transferTicket(id: string, input: TransferTicketInput, idempotencyKey: string) {
        return (
          await request(TicketEnvelope, 'POST', `/tickets/${enc(id)}/transfer`, {
            ...base,
            body: input,
            idempotencyKey,
          })
        ).ticket;
      },
      async changeStatus(id: string, input: ChangeStatusInput, idempotencyKey: string) {
        return (
          await request(TicketEnvelope, 'POST', `/tickets/${enc(id)}/status`, { ...base, body: input, idempotencyKey })
        ).ticket;
      },
      async getEmployee(id: string) {
        return (await request(z.object({ employee: EmployeeSchema }), 'GET', `/employees/${enc(id)}`, base)).employee;
      },
    };
  }

  return {
    forActor,
    async health(): Promise<boolean> {
      try {
        await request(z.object({ status: z.literal('ok') }), 'GET', '/health');
        return true;
      } catch {
        return false;
      }
    },
    /** Login: procura o funcionário pelo e-mail corporativo. Devolve null se não existir. */
    async findEmployeeByEmail(email: string) {
      try {
        return (await request(z.object({ employee: EmployeeSchema }), 'GET', '/employees/lookup', { query: { email } }))
          .employee;
      } catch (err) {
        if (err instanceof ServiceDeskError && err.kind === 'not_found') return null;
        throw err;
      }
    },
    async searchArticles(query: string, limit = 3) {
      const res = await request(z.object({ articles: z.array(ArticleHitSchema) }), 'GET', '/kb/search', {
        query: { q: query, limit },
      });
      return res.articles;
    },
    async getArticle(id: string) {
      return (await request(z.object({ article: ArticleSchema }), 'GET', `/kb/articles/${enc(id)}`)).article;
    },
  };
}

export type ServiceDeskClient = ReturnType<typeof createServiceDeskClient>;
export type ActorServiceDeskClient = ReturnType<ServiceDeskClient['forActor']>;
