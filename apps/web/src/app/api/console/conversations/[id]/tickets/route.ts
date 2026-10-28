import { NextResponse } from 'next/server';
import type { EmployeeTickets } from '@/lib/console';
import { container } from '@/server/container';
import { withUser } from '@/server/http';

/** GET /api/console/conversations/:id/tickets: chamados do funcionário da conversa. */
export const GET = withUser<{ params: Promise<{ id: string }> }>('analyst', async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const { console: consoleService } = await container();
  return NextResponse.json<EmployeeTickets>(await consoleService.tickets(user, id), {
    headers: { 'cache-control': 'no-store' },
  });
});
