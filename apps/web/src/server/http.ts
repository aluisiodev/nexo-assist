import 'server-only';
import { ServiceDeskError } from '@nexo/service-desk-client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionUser } from './auth/sessions';
import { currentUser } from './auth/session';
import { ConversationError } from './conversations/service';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const apiError = (status: number, code: string, message: string) =>
  NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status });

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

type Handler = (user: SessionUser, req: Request) => Promise<Response>;

/** Envolve uma rota de API: autenticação, papel, origem e tradução de erros. */
export function withUser(role: 'employee' | 'analyst', handler: Handler) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && !sameOrigin(req)) return apiError(403, 'forbidden', 'Origem não permitida.');
    const user = await currentUser();
    if (!user) return apiError(401, 'unauthorized', 'Sua sessão expirou. Entre de novo.');
    if (user.role !== role) return apiError(403, 'forbidden', 'Acesso não permitido para o seu perfil.');
    try {
      return await handler(user, req);
    } catch (err) {
      if (err instanceof ConversationError) return apiError(err.status, err.code, err.message);
      if (err instanceof z.ZodError)
        return apiError(400, 'validation_error', err.issues[0]?.message ?? 'Dados inválidos.');
      if (err instanceof ServiceDeskError && err.kind === 'unavailable') {
        return apiError(
          503,
          'service_desk_unavailable',
          'O sistema de chamados está indisponível. Tente em instantes.',
        );
      }
      console.error('[api] erro inesperado', err);
      return apiError(500, 'internal_error', 'Algo deu errado do nosso lado. Tente de novo.');
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
