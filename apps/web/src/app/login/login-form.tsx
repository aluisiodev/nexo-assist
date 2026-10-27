'use client';

import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
import { useActionState, useId, useState, type ReactNode } from 'react';
import { login, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const ids = { email: useId(), password: useId(), error: useId() };

  return (
    <form
      action={action}
      className="flex flex-col gap-7"
      noValidate
      aria-describedby={state.error ? ids.error : undefined}
    >
      <div className="flex flex-col gap-[18px]">
        <Field label="E-mail corporativo" htmlFor={ids.email} error={state.fieldErrors?.email}>
          <Mail className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
          <input
            id={ids.email}
            name="email"
            type="email"
            autoComplete="username"
            placeholder="nome.sobrenome@nexo.com.br"
            defaultValue={state.email ?? ''}
            required
            autoFocus
            aria-invalid={Boolean(state.fieldErrors?.email)}
            className="h-full w-full bg-transparent text-[14.5px] text-ink outline-none focus-visible:outline-none placeholder:text-ink-3/70"
          />
        </Field>

        <Field
          label="Senha"
          htmlFor={ids.password}
          error={state.fieldErrors?.password}
          extra={<span className="text-[13.5px] font-medium text-primary-text">Esqueci minha senha</span>}
        >
          <LockKeyhole className="size-4 shrink-0 text-ink-3 group-focus-within:text-primary-text" aria-hidden="true" />
          <input
            id={ids.password}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
            className="h-full w-full bg-transparent text-[14.5px] text-ink outline-none focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="grid size-[30px] shrink-0 place-items-center rounded-md text-ink-3 hover:bg-desk"
            aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </Field>

        <label className="flex w-fit cursor-pointer items-center gap-[9px] pt-0.5 text-[13.5px] text-ink-2">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="peer sr-only"
          />
          <span className="grid size-[18px] place-items-center rounded-md border border-ink/20 bg-paper peer-checked:border-cta peer-checked:bg-cta peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cta">
            {remember && <Check className="size-3 text-white" strokeWidth={3} aria-hidden="true" />}
          </span>
          Manter conectado neste computador
        </label>
      </div>

      {state.error && (
        <p
          id={ids.error}
          role="alert"
          className="-mt-2 rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger-text"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-cta text-[15.5px] font-semibold text-white shadow-cta transition-colors hover:bg-cta-hover disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Entrando…
          </>
        ) : (
          <>
            Entrar <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </button>

      <p className="border-t border-rule pt-4 text-[12.5px] leading-normal text-ink-3">
        Ambiente de demonstração: use um e-mail dos dados de exemplo (ex.: ana.souza@nexo.com.br) e qualquer senha.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  extra,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-ink">
          {label}
        </label>
        {extra}
      </div>
      <div
        className={`group flex h-11 items-center gap-2.5 rounded-lg border bg-paper pl-3.5 pr-2 shadow-field transition-colors focus-within:border-[1.5px] focus-within:border-cta ${
          error ? 'border-danger' : 'border-ink/12'
        }`}
      >
        {children}
      </div>
      {error && <p className="text-[12.5px] text-danger-text">{error}</p>}
    </div>
  );
}
