import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';

// Load `.env` when the CLI runs outside Nest (migration generate/run locally).
loadDotenv();

/**
 * Single source of truth for TypeORM connection options, shared by:
 *   - the runtime (imported in DatabaseModule), and
 *   - the TypeORM CLI for migrations (`-d dist/database/data-source.js`).
 *
 * Globs use {ts,js} so the same file works under ts-node and after compilation.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'syncbridge',
  password: process.env.POSTGRES_PASSWORD ?? 'syncbridge',
  database: process.env.POSTGRES_DB ?? 'syncbridge',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  // Always false: schema changes go through explicit, reviewable migrations.
  synchronize: false,
  logging: ['true', '1', 'yes'].includes((process.env.DB_LOGGING ?? '').toLowerCase()),
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
