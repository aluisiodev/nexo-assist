import { beforeAll, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './helpers';

type Json = Record<string, any>;

let s: TestServer;
beforeAll(async () => {
  s = await createTestServer();
});

const search = async (q: string): Promise<Json[]> => {
  const res = await s.call(`/kb/search?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).articles as Json[];
};

describe('central de ajuda', () => {
  it('acha o artigo do erro 809 a partir da mensagem do funcionário', async () => {
    const hits = await search('Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.');
    expect(hits[0]?.id).toBe('kb-vpn-809');
  });

  it('responde perguntas sobre horário', async () => {
    const hits = await search('qual o horário de atendimento do service desk?');
    expect(hits[0]?.id).toBe('kb-horario');
  });

  it('acha o artigo de senha bloqueada', async () => {
    const hits = await search('minha senha da rede bloqueou');
    expect(hits[0]?.id).toBe('kb-senha-rede');
  });

  it('não devolve nada para assuntos fora de TI', async () => {
    expect(await search('quando cai o vale-refeição?')).toEqual([]);
  });

  it('busca um artigo pelo id', async () => {
    const res = await s.call('/kb/articles/kb-wifi');
    expect(((await res.json()) as Json).article.title).toBe('Wi-Fi do escritório');
    expect((await s.call('/kb/articles/nao-existe')).status).toBe(404);
  });
});

describe('diretório de funcionários', () => {
  it('encontra pelo e-mail corporativo, sem diferenciar maiúsculas', async () => {
    const res = await s.call('/employees/lookup?email=Ana.Souza@nexo.com.br');
    expect(((await res.json()) as Json).employee).toMatchObject({ id: 'emp-ana', role: 'employee' });
  });

  it('404 para e-mail desconhecido', async () => {
    expect((await s.call('/employees/lookup?email=fulano@nexo.com.br')).status).toBe(404);
  });

  it('funcionário só vê o próprio perfil', async () => {
    expect((await s.call('/employees/emp-bruno', { actor: 'emp-ana' })).status).toBe(403);
    expect((await s.call('/employees/emp-ana', { actor: 'emp-ana' })).status).toBe(200);
    expect((await s.call('/employees/emp-ana', { actor: 'ana-rafael' })).status).toBe(200);
  });
});
