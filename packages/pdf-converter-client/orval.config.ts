import { defineConfig } from 'orval';

export default defineConfig({
  'client-library': {
    input: '../../apps/pdf-converter/specs/v3/docs/swagger.yaml',
    output: './src/index.ts',
  },
});
