import type { QueryTerms } from '~/server/interfaces/search';

export function excludeUserPagesFromQuery(terms: QueryTerms): void {
  terms.prefix = terms.prefix.filter((p) => !p.startsWith('/user'));
  terms.not_prefix = terms.not_prefix.filter((p) => !p.startsWith('/user'));

  terms.not_prefix.push('/user');
}
