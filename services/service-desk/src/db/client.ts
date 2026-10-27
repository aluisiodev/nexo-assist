import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { SCHEMA_SQL } from './schema';

/** Abre o banco (criando a pasta, se for arquivo local) e aplica o esquema. */
export async function openDatabase(url: string): Promise<Client> {
  if (url.startsWith('file:')) {
    const path = url.slice('file:'.length);
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = createClient({ url });
  await migrate(db);
  return db;
}

export async function migrate(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA_SQL);
}
