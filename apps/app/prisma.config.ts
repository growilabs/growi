import { config } from 'dotenv-flow';
import { defineConfig } from 'prisma/config';

config();

// biome-ignore lint/style/noDefaultExport: prisma requires a default export
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: process.env.MONGO_URI,
  },
});
