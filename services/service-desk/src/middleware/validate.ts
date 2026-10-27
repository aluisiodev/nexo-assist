import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import type { ErrorBody } from '../errors';

/** zValidator com resposta de erro no mesmo formato do resto da API. */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const body: ErrorBody = {
        error: {
          code: 'validation_error',
          message: 'Dados inválidos.',
          details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
      return c.json(body, 400);
    }
    return undefined;
  });
}
