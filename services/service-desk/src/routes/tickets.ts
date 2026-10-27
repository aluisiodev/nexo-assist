import {
  AddCommentInputSchema,
  CategorySchema,
  ChangeStatusInputSchema,
  CreateTicketInputSchema,
  ReopenTicketInputSchema,
  TicketListFilterSchema,
  TransferTicketInputSchema,
} from '@nexo/domain';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv, ChaosOptions } from '../context';
import { requireActor, requireAnalyst } from '../middleware/auth';
import { chaos } from '../middleware/chaos';
import { idempotency } from '../middleware/idempotency';
import { validate } from '../middleware/validate';
import * as tickets from '../use-cases/tickets';

const ListQuerySchema = z.object({
  status: TicketListFilterSchema.default('open'),
  requesterId: z.string().min(1).optional(),
});

const SimilarQuerySchema = z.object({
  text: z.string().trim().min(3).max(2000),
  category: CategorySchema.optional(),
  requesterId: z.string().min(1).optional(),
});

const ctxOf = (c: Context<AppEnv>): tickets.UseCaseContext => ({
  repos: c.var.repos,
  now: c.var.clock(),
  actor: c.var.actor,
  calendar: c.var.calendar,
});

/** /tickets: o "sistema legado" de chamados, com instabilidade simulada. */
export function ticketRoutes(chaosOptions: ChaosOptions) {
  return new Hono<AppEnv>()
    .use('*', chaos(chaosOptions))
    .use('*', requireActor)
    .use('*', idempotency)

    .get('/', validate('query', ListQuerySchema), async (c) => {
      const q = c.req.valid('query');
      return c.json({ tickets: await tickets.listTickets(ctxOf(c), { filter: q.status, requesterId: q.requesterId }) });
    })
    .get('/similar', validate('query', SimilarQuerySchema), async (c) => {
      const q = c.req.valid('query');
      return c.json({ matches: await tickets.findSimilarTickets(ctxOf(c), q) });
    })
    .get('/:id', async (c) => c.json({ ticket: await tickets.getTicket(ctxOf(c), c.req.param('id')) }))
    .get('/:id/events', async (c) => c.json({ events: await tickets.getTicketEvents(ctxOf(c), c.req.param('id')) }))

    .post('/', validate('json', CreateTicketInputSchema), async (c) => {
      return c.json({ ticket: await tickets.createTicket(ctxOf(c), c.req.valid('json')) }, 201);
    })
    .post('/:id/comments', validate('json', AddCommentInputSchema), async (c) => {
      return c.json({ ticket: await tickets.addComment(ctxOf(c), c.req.param('id'), c.req.valid('json')) });
    })
    .post('/:id/reopen', validate('json', ReopenTicketInputSchema), async (c) => {
      return c.json({ ticket: await tickets.reopenTicket(ctxOf(c), c.req.param('id'), c.req.valid('json')) });
    })
    .post('/:id/transfer', validate('json', TransferTicketInputSchema), async (c) => {
      return c.json({ ticket: await tickets.transferTicket(ctxOf(c), c.req.param('id'), c.req.valid('json')) });
    })
    .post('/:id/status', requireAnalyst, validate('json', ChangeStatusInputSchema), async (c) => {
      return c.json({ ticket: await tickets.changeTicketStatus(ctxOf(c), c.req.param('id'), c.req.valid('json')) });
    });
}
