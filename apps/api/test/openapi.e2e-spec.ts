import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('API docs (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI document with bearer auth, and marks public routes as needing no token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const doc = res.body;
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.paths['/api/v1/auth/login'].post.security).toEqual([]);
    expect(doc.paths['/api/v1/auth/me'].get.security).toBeUndefined(); // inherits the global bearer requirement
    expect(doc.security).toEqual([{ bearer: [] }]);
    expect(JSON.stringify(doc)).not.toContain('x-public');
  });

  it('serves the interactive docs page', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/docs').expect(200);
    expect(res.text).toContain('swagger');
  });
});
