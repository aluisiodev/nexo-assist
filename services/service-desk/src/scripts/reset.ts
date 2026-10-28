import { loadConfig } from '../config';
import { openDatabase } from '../db/client';
import { resetDatabase } from '../seed/seed';

const config = loadConfig();
const db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
await resetDatabase(db, new Date());
console.log('[service-desk] banco recriado com os dados de exemplo.');
db.close();
