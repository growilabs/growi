module.exports = {
  'markitdown-client': {
    input: './openapi.json',
    output: {
      target: './src/generated/index.ts',
    },
    hooks: {
      afterAllFilesWrite: 'biome check --write src/generated/',
    },
  },
};
