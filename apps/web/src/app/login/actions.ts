'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/server/auth/session';
import { container } from '@/server/container';

const LoginSchema = z.object({
  email: z
    .email('Informe um e-mail válido.')
    .transform((e) => e.trim().toLowerCase())
    .refine((e) => e.endsWith('@nexo.com.br'), 'Use seu e-mail corporativo (@nexo.com.br).'),
  // Desafio: qualquer senha é aceita para os funcionários dos dados de exemplo.
  password: z.string().min(1, 'Informe a senha.'),
  remember: z.boolean(),
});

export interface LoginState {
  readonly error?: string;
  readonly fieldErrors?: { readonly email?: string; readonly password?: string };
  readonly email?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = String(formData.get('email') ?? '');
  const parsed = LoginSchema.safeParse({
    email: rawEmail,
    password: String(formData.get('password') ?? ''),
    remember: formData.get('remember') === 'on',
  });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return { email: rawEmail, fieldErrors: { email: fields.email?.[0], password: fields.password?.[0] } };
  }

  const { serviceDesk, sessions } = await container();
  let employee;
  try {
    employee = await serviceDesk.findEmployeeByEmail(parsed.data.email);
  } catch {
    return { email: rawEmail, error: 'O service desk está indisponível agora. Tente de novo em instantes.' };
  }
  if (!employee) {
    return {
      email: rawEmail,
      error: 'Não encontramos esse e-mail corporativo. Confira o endereço ou ligue no ramal 4000.',
    };
  }

  const { token, expiresAt } = await sessions.create(employee, { remember: parsed.data.remember, now: new Date() });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Sem "manter conectado", o cookie some ao fechar o navegador.
    ...(parsed.data.remember ? { expires: expiresAt } : {}),
  });
  redirect(employee.role === 'analyst' ? '/console' : '/atendimento');
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const { sessions } = await container();
    await sessions.delete(token);
  }
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
