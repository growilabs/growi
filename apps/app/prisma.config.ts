import { config } from 'dotenv-flow';
import { defineConfig, env } from 'prisma/config';

config();

// biome-ignore lint/style/noDefaultExport: prisma requires a default export
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('MONGO_URI'),
  },
});
