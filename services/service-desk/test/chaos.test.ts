import { describe, expect, it } from 'vitest';
import { ANA, createTestServer } from './helpers';

describe('instabilidade simulada do legado', () => {
  it('cai por alguns segundos e volta', async () => {
    let now = 1_000_000;
    const randoms = [0.01]; // primeira requisição dispara a queda; depois, nunca mais
    const s = await createTestServer({
      chaos: { failureRate: 0.05, outageMs: 3000, latencyMs: 0, now: () => now, random: () => randoms.shift() ?? 0.99 },
    });

    const down = await s.call('/tickets', { actor: ANA });
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('3');

    now += 2000;
    expect((await s.call('/tickets', { actor: ANA })).status).toBe(503);

    now += 1500;
    expect((await s.call('/tickets', { actor: ANA })).status).toBe(200);
  });

  it('a central de ajuda não é afetada', async () => {
    const s = await createTestServer({ chaos: { failureRate: 1, outageMs: 60_000, latencyMs: 0 } });
    expect((await s.call('/tickets', { actor: ANA })).status).toBe(503);
    expect((await s.call('/kb/search?q=vpn')).status).toBe(200);
  });
});
