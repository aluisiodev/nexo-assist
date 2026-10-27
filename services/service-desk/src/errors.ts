import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Erro de negócio com status HTTP e código estável que o cliente consegue tratar. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message: string) => new AppError(404, 'not_found', message);
export const forbidden = (message: string) => new AppError(403, 'forbidden', message);
export const unauthorized = (message: string) => new AppError(401, 'unauthorized', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof AppError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message, details: err.details } };
    return c.json(body, err.status);
  }
  console.error('[service-desk] erro inesperado', err);
  const body: ErrorBody = { error: { code: 'internal_error', message: 'Erro interno no service desk.' } };
  return c.json(body, 500);
}
