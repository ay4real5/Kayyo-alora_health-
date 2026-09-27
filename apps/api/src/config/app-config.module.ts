import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation.js';

/** Reads apps/api/.env then the repo-root .env (first wins), and validates everything at startup. */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  validate: validateEnv,
});
