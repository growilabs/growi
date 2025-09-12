import type { GrowiFacade } from '@growi/core';
import { isServer } from '@growi/core/dist/utils/browser-utils';
import deepmerge from 'ts-deepmerge';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var growiFacade: GrowiFacade;
}

export const initializeGrowiFacade = (): void => {
  if (isServer()) {
    return;
  }

  if (window.growiFacade == null) {
    window.growiFacade = {};
  }
};

export const getGrowiFacade = (): GrowiFacade => {
  if (isServer()) {
    return {};
  }

  initializeGrowiFacade();

  return window.growiFacade;
};

export const registerGrowiFacade = (addedFacade: GrowiFacade): void => {
  if (isServer()) {
    throw new Error('This method is available only in client.');
  }

  window.growiFacade = deepmerge(getGrowiFacade(), addedFacade);
};
