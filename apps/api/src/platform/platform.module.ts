import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getPrismaClient } from '@repo/db';
import { LoggerModule } from 'nestjs-pino';

import { APP_CONFIG, loadConfig } from './config/config.js';
import { Database, PRISMA_CLIENT } from './database/database.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
import { HealthController } from './health/health.controller.js';
import {
  createLoggerParams,
  LOG_DESTINATION,
} from './logging/logger.options.js';

/**
 * M16 Platform — configuration, logging, errors, database access and health.
 * Global, because every module depends on it and none should re-import it.
 *
 * Not yet here, by decision: tracing (OpenTelemetry and Sentry, which need an
 * external account and wait for deployment), and the queue readiness check
 * (M14). See the backlog.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG, LOG_DESTINATION],
      useFactory: createLoggerParams,
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    { provide: LOG_DESTINATION, useValue: process.stdout },
    // The @repo/db singleton — the same client Better Auth's adapter holds,
    // so the process has one connection pool.
    { provide: PRISMA_CLIENT, useFactory: getPrismaClient },
    Database,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [APP_CONFIG, LOG_DESTINATION, PRISMA_CLIENT, Database],
})
export class PlatformModule {}
