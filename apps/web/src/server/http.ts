import 'server-only';
import { ServiceDeskError } from '@nexo/service-desk-client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionUser } from './auth/sessions';
import { currentUser } from './auth/session';
import { ConversationError } from './conversations/service';

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export const apiError = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** Traduz qualquer erro para uma resposta segura (sem detalhes internos). */
export function describeError(err: unknown): ApiError {
  if (err instanceof ConversationError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof z.ZodError) {
    return { status: 400, code: 'validation_error', message: err.issues[0]?.message ?? 'Dados inválidos.' };
  }
  if (err instanceof ServiceDeskError && err.kind === 'unavailable') {
    return {
      status: 503,
      code: 'service_desk_unavailable',
      message: 'O sistema de chamados está indisponível. Tente em instantes.',
    };
  }
  console.error('[api] erro inesperado', err);
  return { status: 500, code: 'internal_error', message: 'Algo deu errado do nosso lado. Tente de novo.' };
}

/**
 * Proteção contra CSRF em rotas que mudam estado: além do cookie SameSite=Lax,
 * exige que a requisição venha da própria origem.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // navegadores sempre enviam Origin em POST cross-site
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

type Handler<C> = (user: SessionUser, req: Request, ctx: C) => Promise<Response>;

/** Envolve uma rota de API: autenticação, papel, origem e tradução de erros. */
export function withUser<C = unknown>(role: 'employee' | 'analyst', handler: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    if (req.method !== 'GET' && !sameOrigin(req)) return apiError(403, 'forbidden', 'Origem não permitida.');
    const user = await currentUser();
    if (!user) return apiError(401, 'unauthorized', 'Sua sessão expirou. Entre de novo.');
    if (user.role !== role) return apiError(403, 'forbidden', 'Acesso não permitido para o seu perfil.');
    try {
      return await handler(user, req, ctx);
    } catch (err) {
      const e = describeError(err);
      return apiError(e.status, e.code, e.message);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Corpo da requisição inválido.', input: undefined }]);
  }
}
