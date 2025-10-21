import ExtensibleCustomError from 'extensible-custom-error';

import type { AllTermsKey } from '~/server/interfaces/search';

export class SearchError extends ExtensibleCustomError {
  readonly id = 'SearchError';

  unavailableTermsKeys!: AllTermsKey[];

  constructor(message = '', unavailableTermsKeys: AllTermsKey[]) {
    super(message);
    this.unavailableTermsKeys = unavailableTermsKeys;
  }
}

export const isSearchError = (err: any): err is SearchError => {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  if (err instanceof SearchError) {
    return true;
  }

  return err?.id === 'SearchError';
};
