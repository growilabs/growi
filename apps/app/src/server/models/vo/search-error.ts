import type { AllTermsKey } from '~/server/interfaces/search';
import { ExtensibleCustomError } from '~/server/util/extensible-custom-error';

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
