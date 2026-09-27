import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env itself. The repo keeps one .env at the root.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Optional: `prisma generate` / `validate` / `migrate diff --from-empty` work without a database.
    url: process.env.DATABASE_URL,
  },
});
