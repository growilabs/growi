import md5 from 'md5';

export const GRAVATAR_DEFAULT =
  'https://gravatar.com/avatar/00000000000000000000000000000000?s=24';

export const generateGravatarSrc = (email?: string): string => {
  const hash = md5((email ?? '').trim().toLowerCase());
  return `https://gravatar.com/avatar/${hash}`;
};
