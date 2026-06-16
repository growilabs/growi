/**
 * This module provides testing APIs for node-sdk.ts
 * It should be imported only in test files
 */

import type { NodeSDK } from '@opentelemetry/sdk-node';

import { __testing__ } from './node-sdk';

/**
 * Get the current SDK instance
 * This function should only be used in tests
 */
export const getSdkInstance = (): NodeSDK | undefined => {
  return __testing__.getSdkInstance();
};

/**
 * Reset the SDK instance
 * This function should be used to clean up between tests
 */
export const resetSdkInstance = (): void => {
  __testing__.reset();
};
