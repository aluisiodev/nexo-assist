import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/server/origin';

const PUBLIC = 'https://nexo-assist.onrender.com';

/** Requisição como o Next a vê atrás do proxy: URL interna, cabeçalhos do proxy opcionais. */
const post = (headers: Record<string, string>, url = 'http://localhost:10000/api/chat/messages') =>
  new Request(url, { method: 'POST', headers });

describe('verificação de origem (CSRF)', () => {
  it('aceita requisição sem Origin (não vem de navegador em POST cross-site)', () => {
    expect(isSameOrigin(post({}), {})).toBe(true);
  });

  it('aceita quando o Origin é o host da própria URL (desenvolvimento)', () => {
    const req = post({ origin: 'http://localhost:3000' }, 'http://localhost:3000/api/chat/new');
    expect(isSameOrigin(req, {})).toBe(true);
  });

  it('atrás de proxy: aceita o Origin público quando o proxy repassa X-Forwarded-Host', () => {
    const req = post({ origin: PUBLIC, 'x-forwarded-host': 'nexo-assist.onrender.com' });
    expect(isSameOrigin(req, {})).toBe(true);
  });

  it('usa só o primeiro valor de X-Forwarded-Host', () => {
    const req = post({ origin: PUBLIC, 'x-forwarded-host': 'nexo-assist.onrender.com, interno.local' });
    expect(isSameOrigin(req, {})).toBe(true);
    const trap = post({
      origin: 'https://interno.local',
      'x-forwarded-host': 'nexo-assist.onrender.com, interno.local',
    });
    expect(isSameOrigin(trap, {})).toBe(false);
  });

  it('aceita a URL pública declarada no ambiente (RENDER_EXTERNAL_URL ou APP_ORIGIN)', () => {
    expect(isSameOrigin(post({ origin: PUBLIC }), { RENDER_EXTERNAL_URL: PUBLIC })).toBe(true);
    expect(isSameOrigin(post({ origin: PUBLIC }), { APP_ORIGIN: PUBLIC })).toBe(true);
  });

  it('recusa o Origin de outro site, mesmo com o proxy configurado', () => {
    const req = post({ origin: 'https://site-malicioso.example', 'x-forwarded-host': 'nexo-assist.onrender.com' });
    expect(isSameOrigin(req, { RENDER_EXTERNAL_URL: PUBLIC })).toBe(false);
  });

  it('recusa sem proxy configurado quando o Origin não bate com nada conhecido', () => {
    expect(isSameOrigin(post({ origin: PUBLIC }), {})).toBe(false);
  });

  it('recusa Origin malformado e o literal "null"', () => {
    expect(isSameOrigin(post({ origin: 'não é uma url' }), {})).toBe(false);
    expect(isSameOrigin(post({ origin: 'null' }), {})).toBe(false);
  });
});
