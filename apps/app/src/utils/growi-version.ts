import pkg from '^/package.json';

export const getGrowiVersion = (): string => {
  return pkg.version;
};
