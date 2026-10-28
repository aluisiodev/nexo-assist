import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { APP_SCHEMA_SQL } from './schema';

/**
 * Abre o banco do app (criando a pasta, se for arquivo) e aplica o esquema. Aceita um
 * arquivo local (`file:`) ou um libSQL remoto (`libsql://…` no Turso, com token).
 */
export async function openAppDatabase(url: string, authToken?: string): Promise<Client> {
  if (url.startsWith('file:')) {
    const path = url.slice('file:'.length);
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = createClient(authToken ? { url, authToken } : { url });
  await db.executeMultiple(`PRAGMA foreign_keys = ON;\n${APP_SCHEMA_SQL}`);
  return db;
}
