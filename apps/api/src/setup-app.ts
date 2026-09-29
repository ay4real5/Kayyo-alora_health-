import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import {
  correlationIdMiddleware,
  noStoreMiddleware,
} from './common/middleware/correlation-id.middleware.js';
import { API_PREFIX } from './config/api.constants.js';
import { AppEnv, type EnvironmentVariables } from './config/env.validation.js';
import { ConfiguredIoAdapter } from './modules/realtime/socket-io.adapter.js';
import { setupSwagger } from './openapi/openapi.js';

export { API_PREFIX };

/** App-wide setup shared by main.ts and e2e tests, so tests exercise the real configuration (D-010). */
export function setupApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  // Behind nginx / a load balancer: take the client IP (rate limits, audit log) from X-Forwarded-For (D-070).
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) (app as NestExpressApplication).set('trust proxy', proxyHops);
  // 835 remittance uploads can be a few MB (services cap their own sizes; D-054). Express's default is 100 kB.
  (app as NestExpressApplication).useBodyParser('json', { limit: '6mb' });
  app.use(correlationIdMiddleware);
  app.use(noStoreMiddleware);
  app.use(helmet());
  app.enableCors({
    // Exact origins only (D-008). An empty list disables cross-origin browser access entirely.
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.useWebSocketAdapter(
    new ConfiguredIoAdapter(app, config.get('CORS_ORIGINS', { infer: true })),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties without validation decorators…
      forbidNonWhitelisted: true, // …and reject the request if any were sent
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const docsEnabled =
    config.get('API_DOCS_ENABLED', { infer: true }) ??
    config.get('APP_ENV', { infer: true }) !== AppEnv.Production;
  if (docsEnabled) setupSwagger(app);

  app.enableShutdownHooks();
  return app;
}
