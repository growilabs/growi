import pkg from '^/package.json' with { type: 'json' };

export const getGrowiVersion = (): string => {
  return pkg.version;
};
