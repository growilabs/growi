import { config } from 'dotenv-flow';
import { defineConfig } from 'prisma/config';

config({ node_env: process.env.NODE_ENV || 'development' });

if (process.env.MONGO_URI === undefined) {
  throw new Error('Environment variable "MONGO_URI" is not defined');
}

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
