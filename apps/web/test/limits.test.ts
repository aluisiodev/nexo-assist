import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BudgetedResponder } from '@/server/agent/budgeted-responder';
import type { AgentContext, AgentReply, AgentResponder } from '@/server/agent/types';
import { openAppDatabase } from '@/server/db/open';
import { AiBudget } from '@/server/limits/ai-budget';
import { RateLimiter } from '@/server/limits/rate-limiter';

const tempDb = () => openAppDatabase(`file:${join(mkdtempSync(join(tmpdir(), 'nexo-limits-')), 'app.db')}`);

describe('limite de mensagens por minuto', () => {
  it('deixa passar uma rajada até o limite; depois espera só a próxima ficha, não o minuto inteiro', () => {
    let now = 0;
    const limiter = new RateLimiter(10, 60_000, () => now);
    for (let i = 0; i < 10; i++) expect(limiter.hit('ana').ok).toBe(true);
    expect(limiter.hit('ana')).toEqual({ ok: false, retryAfterSec: 6 });
    expect(limiter.hit('bruno').ok).toBe(true); // cada funcionário tem o seu limite

    now = 6_000; // uma ficha voltou
    expect(limiter.hit('ana').ok).toBe(true);
    expect(limiter.hit('ana').ok).toBe(false);

    now = 120_000; // depois de um tempo parado, a rajada inteira volta
    for (let i = 0; i < 10; i++) expect(limiter.hit('ana').ok).toBe(true);
  });

  it('0 desliga o limite', () => {
    const limiter = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(limiter.hit('ana').ok).toBe(true);
  });
});

describe('cota diária de IA', () => {
  it('conta por dia, para no limite e recomeça no dia seguinte (fuso de São Paulo)', async () => {
    const db = await tempDb();
    let clock = new Date('2026-10-27T23:00:00-03:00');
    const budget = new AiBudget(db, 2, () => clock);

    expect(await budget.tryConsume()).toBe(true);
    expect(await budget.tryConsume()).toBe(true);
    expect(await budget.tryConsume()).toBe(false);
    expect(await budget.usedToday()).toBe(2);

    clock = new Date('2026-10-28T00:30:00-03:00'); // 03:30 UTC: já é outro dia em São Paulo
    expect(await budget.usedToday()).toBe(0);
    expect(await budget.tryConsume()).toBe(true);
  });

  it('sobrevive a reinícios: a contagem fica no banco', async () => {
    const db = await tempDb();
    const clock = () => new Date('2026-10-27T10:00:00-03:00');
    expect(await new AiBudget(db, 1, clock).tryConsume()).toBe(true);
    expect(await new AiBudget(db, 1, clock).tryConsume()).toBe(false);
  });

  it('quando a cota acaba, responde no modo básico (sem bloquear) e explica no "por quê?"', async () => {
    const db = await tempDb();
    const budget = new AiBudget(db, 1, () => new Date('2026-10-27T10:00:00-03:00'));
    const fake = (name: string): AgentResponder & { calls: number } => ({
      name,
      calls: 0,
      async respond(): Promise<AgentReply> {
        this.calls++;
        return {
          messages: [{ text: `resposta ${name}`, trace: { engine: name, steps: [], intent: 'duvida' } as never }],
        };
      },
    });
    const ai = fake('IA');
    const basic = fake('básico');
    const responder = new BudgetedResponder(ai, basic, budget);
    const ctx = {} as AgentContext;

    expect((await responder.respond(ctx)).messages[0]?.text).toBe('resposta IA');
    const steps: string[] = [];
    const second = await responder.respond(ctx, (e) => e.type === 'step' && steps.push(e.step.label));

    expect(second.messages[0]?.text).toBe('resposta básico');
    expect(second.messages[0]?.trace.steps[0]?.label).toMatch(/cota diária de IA atingida/);
    expect(steps).toEqual(['cota diária de IA atingida, respondi no modo básico']);
    expect([ai.calls, basic.calls]).toEqual([1, 1]);
  });
});
