import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { seedIfEmpty } from '../seed/seed';

const config = loadConfig();
const db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
const seeded = await seedIfEmpty(db, new Date());
console.log(
  seeded
    ? '[service-desk] dados de exemplo criados.'
    : '[service-desk] o banco já tem dados; use npm run db:reset para recriar.',
);
db.close();
