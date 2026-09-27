import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api/v1';

/** App-wide setup shared by main.ts and e2e tests, so tests exercise the real configuration. */
export function setupApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
