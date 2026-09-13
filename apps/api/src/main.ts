import { NestFactory } from '@nestjs/core';

import {
  type AppConfig,
  ConfigValidationError,
  loadConfig,
} from './platform/config/config.js';

async function bootstrap() {
  // Validate configuration before anything else is constructed, so a bad .env
  // fails the boot with every problem listed rather than on first use (M16).
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  // Imported only after validation: static imports are evaluated before this
  // function runs, and auth.config.ts reads configuration while importing —
  // which would surface a bad .env as a stack trace instead of the list above.
  const { AppModule } = await import('./app.module.js');
  const { configureApp } = await import('./platform/configure-app.js');

  // `bodyParser: false` is MANDATORY — see configureApp. Do not remove it.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app);

  await app.listen(config.PORT);
}
await bootstrap();
