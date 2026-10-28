import { NextResponse } from 'next/server';
import { CONSOLE_ACTIONS, type ConsoleAction, type ConsoleSnapshot } from '@/lib/console';
import { container } from '@/server/container';
import { apiError, withUser } from '@/server/http';

const isAction = (a: string): a is ConsoleAction => (CONSOLE_ACTIONS as readonly string[]).includes(a);

/** POST /api/console/conversations/:id/actions/assume | return | close */
export const POST = withUser<{ params: Promise<{ id: string; action: string }> }>(
  'analyst',
  async (user, _req, ctx) => {
    const { id, action } = await ctx.params;
    if (!isAction(action)) return apiError(404, 'not_found', 'Ação desconhecida.');
    const { console: consoleService } = await container();
    return NextResponse.json<ConsoleSnapshot>(await consoleService.act(user, id, action));
  },
);
