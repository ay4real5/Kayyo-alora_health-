/**
 * Writes the committed OpenAPI file (DECISIONS D-024): docs/api/openapi.json — the whole API, for agents and tools.
 * (The separate Base44 portal spec was retired in P3-15: the portal is built in apps/web, D-044/D-058.)
 *
 * Run after building: `npm run openapi -w @alora/api`. CI fails if the committed file is out of date.
 * Uses Nest's preview mode, so no database connection is made.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { AppModule } from '../app.module.js';
import { API_PREFIX } from '../config/api.constants.js';
import { buildOpenApiDocument } from './openapi.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const output = resolve(process.cwd(), '../..', 'docs/api/openapi.json');

const app = await NestFactory.create(AppModule, { preview: true, logger: ['error'] });
app.setGlobalPrefix(API_PREFIX);
const document = buildOpenApiDocument(app);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${output} (${Object.keys(document.paths).length} paths)`);
await app.close();
