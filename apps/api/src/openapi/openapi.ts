import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { IS_PUBLIC_EXTENSION } from '../common/decorators/public.decorator.js';
import { API_PREFIX } from '../config/api.constants.js';

export const DOCS_PATH = `${API_PREFIX}/docs`;

/**
 * The OpenAPI description of the API, generated from controllers and DTOs (the Nest Swagger compiler
 * plugin in nest-cli.json reads DTO types and class-validator rules). DECISIONS D-024.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Alora Health API')
    .setDescription(
      [
        'Home health agency management API. All routes are under `/api/v1`.',
        '',
        'Success responses are wrapped as `{ "success": true, "data": …, "meta"?: { page, limit, total } }`.',
        'Errors are `{ "success": false, "error": { "code", "message", "details"? } }`.',
        '',
        'Authenticate with `POST /api/v1/auth/login`, then send `Authorization: Bearer <accessToken>`.',
      ].join('\n'),
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  markPublicOperations(document);
  return document;
}

/** Public routes (marked @Public) need no token: give them `security: []` instead of the global bearer. */
function markPublicOperations(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation && typeof operation === 'object' && IS_PUBLIC_EXTENSION in operation) {
        const op = operation as Record<string, unknown>;
        delete op[IS_PUBLIC_EXTENSION];
        op.security = [];
      }
    }
  }
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}-json`,
    swaggerOptions: { persistAuthorization: false },
  });
}
