import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { forbidden, notFound } from '../errors';
import { requireActor } from '../middleware/auth';
import { validate } from '../middleware/validate';

const ByEmailQuerySchema = z.object({ email: z.email() });

/** /employees: diretório de funcionários, usado no login e no console do analista. */
export function employeeRoutes() {
  return (
    new Hono<AppEnv>()
      // Login: o app procura o funcionário pelo e-mail corporativo (protegido pela chave de API).
      .get('/lookup', validate('query', ByEmailQuerySchema), async (c) => {
        const employee = await c.var.repos.employees.findByEmail(c.req.valid('query').email);
        if (!employee) throw notFound('Funcionário não encontrado.');
        return c.json({ employee });
      })
      .get('/:id', requireActor, async (c) => {
        const { employee: actor } = c.var.actor;
        const id = c.req.param('id');
        if (actor.role !== 'analyst' && actor.id !== id) throw forbidden('Você só pode ver o seu próprio perfil.');
        const employee = await c.var.repos.employees.findById(id);
        if (!employee) throw notFound('Funcionário não encontrado.');
        return c.json({ employee });
      })
  );
}
