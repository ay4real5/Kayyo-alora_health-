/**
 * Writes the committed OpenAPI files (DECISIONS D-024):
 *   docs/api/openapi.json                        — the whole API, for agents and tools
 *   docs/base44-portal/openapi-portal-spec.json  — portal endpoints only, imported by the Base44 portal
 *
 * Run after building: `npm run openapi -w @alora/api`. CI fails if the committed files are out of date.
 * Uses Nest's preview mode, so no database connection is made.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { AppModule } from '../app.module.js';
import { API_PREFIX } from '../config/api.constants.js';
import { buildOpenApiDocument, portalSubset } from './openapi.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const repoRoot = resolve(process.cwd(), '../..');
const outputs = {
  full: resolve(repoRoot, 'docs/api/openapi.json'),
  portal: resolve(repoRoot, 'docs/base44-portal/openapi-portal-spec.json'),
};

const app = await NestFactory.create(AppModule, { preview: true, logger: ['error'] });
app.setGlobalPrefix(API_PREFIX);
const document = buildOpenApiDocument(app);

for (const [file, content] of [
  [outputs.full, document],
  [outputs.portal, portalSubset(document)],
] as const) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  console.log(`wrote ${file} (${Object.keys(content.paths).length} paths)`);
}
await app.close();
