import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // Buffer logs until the pino logger is resolved, then route everything through it.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  const logger = new Logger('Bootstrap');

  app.use(helmet());

  // Strict, transforming validation for every inbound DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties without decorators
      forbidNonWhitelisted: false, // SFTPGo may add fields across versions; ignore them
      transform: true, // instantiate DTO classes + coerce primitive types
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // OpenAPI docs at /docs. Declares the two auth schemes used by the API.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('S3-SyncBridge Orchestrator')
    .setDescription('SFTP → S3 ingestion pipeline: webhook ingress, management API, health & metrics.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-SyncBridge-Token', in: 'header' }, 'webhook-token')
    .addApiKey({ type: 'apiKey', name: 'X-Admin-Token', in: 'header' }, 'admin-token')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  // Ensure TypeORM/connections close cleanly on SIGTERM (docker stop).
  app.enableShutdownHooks();

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('app.port', { infer: true });

  await app.listen(port, '0.0.0.0');
  logger.log(`S3-SyncBridge orchestrator listening on port ${port}`);
}

void bootstrap();
