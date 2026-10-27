import type { Client } from '@libsql/client';

const dayInSaoPaulo = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d); // AAAA-MM-DD

/**
 * Cota diária de respostas com IA (para todo o app), guardada no banco para sobreviver
 * a reinícios. Quando acaba, o chat continua funcionando no modo básico.
 */
export class AiBudget {
  constructor(
    private readonly db: Client,
    /** Máximo de respostas com IA por dia; 0 desliga a cota. */
    readonly dailyLimit: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Consome uma resposta da cota de hoje. Devolve false se a cota acabou. Atômico. */
  async tryConsume(): Promise<boolean> {
    if (this.dailyLimit <= 0) return true;
    const rs = await this.db.execute({
      sql: `INSERT INTO ai_usage (day, calls) VALUES (?, 1)
            ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?
            RETURNING calls`,
      args: [dayInSaoPaulo(this.clock()), this.dailyLimit],
    });
    return rs.rows.length > 0;
  }

  async usedToday(): Promise<number> {
    const rs = await this.db.execute({
      sql: 'SELECT calls FROM ai_usage WHERE day = ?',
      args: [dayInSaoPaulo(this.clock())],
    });
    return Number(rs.rows[0]?.['calls'] ?? 0);
  }
}
