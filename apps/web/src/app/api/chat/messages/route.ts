import { SendMessageInputSchema, type ChatStreamEvent } from '@/lib/chat';
import { container } from '@/server/container';
import { describeError, readJson, withUser } from '@/server/http';

/**
 * POST /api/chat/messages: envia uma mensagem do funcionário e devolve, em tempo real
 * (NDJSON, um evento por linha), a mensagem gravada, cada ação do agent enquanto ele
 * trabalha e, no fim, as mensagens novas.
 */
export const POST = withUser('employee', async (user, req) => {
  const { text } = SendMessageInputSchema.parse(await readJson(req));
  const { conversations } = await container();
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
