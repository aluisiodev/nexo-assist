import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { container } from '../container';
import type { SessionUser } from './sessions';

export const SESSION_COOKIE = 'nexo_session';

/** Usuário da requisição atual (memorizado por requisição). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { sessions } = await container();
  return sessions.find(token, new Date());
});

/** Para páginas: exige login e o papel certo; senão redireciona. */
export async function requireUser(role: 'employee' | 'analyst'): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== role) redirect(user.role === 'analyst' ? '/console' : '/atendimento');
  return user;
}

export const homeFor = (user: SessionUser): string => (user.role === 'analyst' ? '/console' : '/atendimento');
