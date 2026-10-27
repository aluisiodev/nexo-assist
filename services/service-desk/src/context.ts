import type { Client } from '@libsql/client';
import type { BusinessCalendar, Employee } from '@nexo/domain';
import { ArticleRepository } from './repositories/articles';
import { EmployeeRepository } from './repositories/employees';
import { IdempotencyRepository } from './repositories/idempotency';
import { TicketRepository } from './repositories/tickets';

export interface ChaosOptions {
  /** Chance (0–1) de uma requisição iniciar uma queda. */
  readonly failureRate: number;
  /** Duração da queda, em ms. */
  readonly outageMs: number;
  /** Latência máxima adicionada, em ms. */
  readonly latencyMs: number;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface AppDeps {
  readonly db: Client;
  readonly apiKey: string;
  readonly chaos: ChaosOptions;
  /** Relógio injetável para testes de prazo. */
  readonly clock?: () => Date;
  readonly calendar?: BusinessCalendar;
}

export interface Repositories {
  readonly employees: EmployeeRepository;
  readonly tickets: TicketRepository;
  readonly articles: ArticleRepository;
  readonly idempotency: IdempotencyRepository;
}

export function createRepositories(db: Client): Repositories {
  return {
    employees: new EmployeeRepository(db),
    tickets: new TicketRepository(db),
    articles: new ArticleRepository(db),
    idempotency: new IdempotencyRepository(db),
  };
}

/** Quem está agindo, e se a ação passou pelo Nexo Assist (agent) em nome dele. */
export interface Actor {
  readonly employee: Employee;
  readonly viaAgent: boolean;
}

export type AppEnv = {
  Variables: {
    repos: Repositories;
    clock: () => Date;
    calendar: BusinessCalendar | undefined;
    actor: Actor;
  };
};
