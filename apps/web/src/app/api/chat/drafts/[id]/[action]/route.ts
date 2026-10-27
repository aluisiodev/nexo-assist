import { NextResponse } from 'next/server';
import type { ChatActionResult } from '@/lib/chat';
import { container } from '@/server/container';
import { apiError, withUser } from '@/server/http';

/** POST /api/chat/drafts/:id/confirm | cancel — botões do card de rascunho. */
export const POST = withUser<{ params: Promise<{ id: string; action: string }> }>(
  'employee',
  async (user, _req, ctx) => {
    const { id, action } = await ctx.params;
    const { conversations } = await container();
    if (action === 'confirm') return NextResponse.json<ChatActionResult>(await conversations.confirmDraft(user, id));
    if (action === 'cancel') return NextResponse.json<ChatActionResult>(await conversations.cancelDraft(user, id));
    return apiError(404, 'not_found', 'Ação desconhecida.');
  },
);
