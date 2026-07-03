import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { AppConfig } from '../config/configuration';
import { dataSourceOptions } from './data-source';

/**
 * Wires TypeORM using the shared DataSource options, overlaying runtime-only
 * settings (synchronize/logging) from validated config. Connection retries are
 * enabled so the app tolerates Postgres still warming up at boot.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): TypeOrmModuleOptions => {
        const db = config.get('database', { infer: true });
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          synchronize: db.synchronize,
          logging: db.logging,
          // Entity & migration discovery is owned by the shared DataSource.
          entities: dataSourceOptions.entities,
          migrations: dataSourceOptions.migrations,
          autoLoadEntities: true,
          retryAttempts: 10,
          retryDelay: 3000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
