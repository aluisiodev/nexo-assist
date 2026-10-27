import type { Row } from '@libsql/client';

/** Leitura tipada de colunas do SQLite: falha alto se o banco tiver algo inesperado. */

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value === 'string') return value;
  throw new Error(`Coluna "${column}": esperado texto, veio ${typeof value}`);
}

export function nullableText(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  throw new Error(`Coluna "${column}": esperado texto ou nulo, veio ${typeof value}`);
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`Coluna "${column}": esperado número, veio ${typeof value}`);
}
