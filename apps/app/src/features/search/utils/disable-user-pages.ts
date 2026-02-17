import type { QueryTerms } from '~/server/interfaces/search';

export function excludeUserPagesFromQuery(terms: QueryTerms): void {
  const userRegex: RegExp = /^\/user($|\/)/;

  terms.prefix = terms.prefix.filter((p) => !userRegex.test(p));
  terms.not_prefix = terms.not_prefix.filter((p) => !userRegex.test(p));

  terms.not_prefix.push('/user');
}
