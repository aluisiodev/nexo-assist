import { NextResponse } from 'next/server';
import type { ChatMessage } from '@/lib/chat';
import { AnalystMessageInputSchema } from '@/lib/console';
import { container } from '@/server/container';
import { readJson, withUser } from '@/server/http';

/** POST /api/console/conversations/:id/messages: resposta do analista ao funcionário. */
export const POST = withUser<{ params: Promise<{ id: string }> }>('analyst', async (user, req, ctx) => {
  const { id } = await ctx.params;
  const { text } = AnalystMessageInputSchema.parse(await readJson(req));
  const { console: consoleService } = await container();
  return NextResponse.json<{ message: ChatMessage }>({ message: await consoleService.reply(user, id, text) });
});
