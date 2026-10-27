module.exports = {
  'attachment-text-extractor-client': {
    input: './openapi.json',
    output: {
      target: './src/generated/index.ts',
    },
    hooks: {
      afterAllFilesWrite: 'biome check --write src/generated/',
    },
  },
};
