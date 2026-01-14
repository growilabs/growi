import type React from 'react';
import type { GrowiFacade } from '@growi/core';

declare global {
  interface Window {
    growiFacade: GrowiFacade;
  }
}

/**
 * Retrieves the React instance that this package should use.
 *
 * - **Production Mode**: Returns the React instance from `window.growiFacade.react`
 *   to ensure a single shared React instance across the app.
 * - **Development Mode**: Returns the React instance passed as an argument,
 *   which allows local development and hot reload without issues.
 *
 * @param react - The React instance to use during development
 * @returns A React instance to be used in the current environment
 *
 * @remarks
 * Using multiple React instances in a single app can cause serious issues,
 * especially with features like Hooks, which rely on a consistent internal state.
 * This function ensures that only one React instance is used in production
 * to avoid such problems.
 */
export const growiReact = (react: typeof React): typeof React => {
  if (process.env.NODE_ENV === 'production') {
    return window.growiFacade.react as typeof React;
  }
  return react as typeof React;
};
