import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import {
  correlationIdMiddleware,
  noStoreMiddleware,
} from './common/middleware/correlation-id.middleware.js';
import type { EnvironmentVariables } from './config/env.validation.js';

export const API_PREFIX = 'api/v1';

/** App-wide setup shared by main.ts and e2e tests, so tests exercise the real configuration (D-010). */
export function setupApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.use(correlationIdMiddleware);
  app.use(noStoreMiddleware);
  app.use(helmet());
  app.enableCors({
    // Exact origins only (D-008). An empty list disables cross-origin browser access entirely.
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties without validation decorators…
      forbidNonWhitelisted: true, // …and reject the request if any were sent
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
