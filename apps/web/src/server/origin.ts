/**
 * Proteção contra CSRF em rotas que mudam estado: além do cookie SameSite=Lax,
 * exige que a requisição venha da própria origem.
 *
 * Atrás de um proxy (Render, por exemplo) o servidor Next enxerga a si mesmo como
 * `localhost:<porta>`, e o host de `req.url` deixa de bater com o `Origin` que o navegador
 * envia. Por isso a origem é comparada com os hosts que identificam o próprio app:
 *   - o de `req.url` (acesso direto, desenvolvimento e testes);
 *   - o cabeçalho `Host` e o primeiro `X-Forwarded-Host` (repassados pelo proxy);
 *   - a URL pública declarada em `APP_ORIGIN` ou, no Render, `RENDER_EXTERNAL_URL`.
 * Um site de terceiros não consegue forjar esses cabeçalhos a partir do navegador da vítima,
 * então a proteção continua valendo: um `Origin` de outro site nunca coincide com eles.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Normaliza "host[:porta]" ou uma URL completa para "host[:porta]"; `null` se inválido. */
function hostOf(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    return new URL(text.includes('://') ? text : `http://${text}`).host;
  } catch {
    return null;
  }
}

function trustedHosts(req: Request, env: Env): Set<string> {
  const candidates = [
    req.url,
    req.headers.get('host'),
    req.headers.get('x-forwarded-host')?.split(',')[0],
    env.APP_ORIGIN,
    env.RENDER_EXTERNAL_URL,
  ];
  const hosts = new Set<string>();
  for (const candidate of candidates) {
    const host = hostOf(candidate);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function isSameOrigin(req: Request, env: Env = process.env): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // navegadores sempre enviam Origin em POST cross-site
  const originHost = hostOf(origin);
  return originHost !== null && trustedHosts(req, env).has(originHost);
}
