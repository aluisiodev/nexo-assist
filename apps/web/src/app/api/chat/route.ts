import { NextResponse } from 'next/server';
import type { ChatSnapshot } from '@/lib/chat';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/**
 * GET /api/chat?after=<seq>&conversation=<id>: conversa atual e mensagens novas (usado
 * no polling). Com `conversation`, acompanha a conversa aberta na tela até o fim.
 */
export const GET = withUser('employee', async (user, req) => {
  const params = new URL(req.url).searchParams;
  const after = Number(params.get('after') ?? 0);
  const { conversations } = await container();
  const snapshot = await conversations.snapshotFor(
    user,
    Number.isFinite(after) && after > 0 ? after : 0,
    params.get('conversation') ?? undefined,
  );
  return NextResponse.json<ChatSnapshot>(snapshot, { headers: { 'cache-control': 'no-store' } });
});
