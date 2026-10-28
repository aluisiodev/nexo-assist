import { SendMessageInputSchema, type ChatStreamEvent } from '@/lib/chat';
import { container } from '@/server/container';
import { apiError, describeError, readJson, withUser } from '@/server/http';

/**
 * POST /api/chat/messages: envia uma mensagem do funcionário e devolve, em tempo real
 * (NDJSON, um evento por linha), a mensagem gravada, cada ação do agent enquanto ele
 * trabalha e, no fim, as mensagens novas.
 */
export const POST = withUser('employee', async (user, req) => {
  const { text } = SendMessageInputSchema.parse(await readJson(req));
  const { conversations, chatRateLimit } = await container();

  // O limite por minuto protege a cota de IA: só vale quando o assistente vai responder.
  // Com um analista (ou aguardando um), o funcionário escreve no ritmo dele, sem espera.
  const current = await conversations.getOrStart(user);
  const limit = current.status === 'agent' ? chatRateLimit.hit(user.employeeId) : ({ ok: true } as const);
  if (!limit.ok) {
    const res = apiError(
      429,
      'rate_limited',
      `Você enviou muitas mensagens seguidas. Aguarde ${limit.retryAfterSec} ${limit.retryAfterSec === 1 ? 'segundo' : 'segundos'} e tente de novo.`,
    );
    res.headers.set('retry-after', String(limit.retryAfterSec));
    return res;
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await conversations.sendEmployeeMessage(user, text, (event) => write(event));
        write({ type: 'done', ...result });
      } catch (err) {
        const { code, message } = describeError(err);
        write({ type: 'error', error: { code, message } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
});
