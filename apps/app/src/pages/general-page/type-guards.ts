import { isIPageInfo } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import type { GeneralPageInitialProps } from './types';

const logger = loggerFactory('growi:pages:general-page:type-guards');

/**
 * Type guard for GeneralPageInitialProps & CommonEachProps validation
 * First validates CommonEachProps, then checks GeneralPageGeneralPageInitialProps-specific properties
 */
export function isValidGeneralPageInitialProps(
  props: unknown,
): props is GeneralPageInitialProps {
  const p = props as Record<string, unknown>;

  // Then validate GeneralPageInitialProps-specific properties
  // CommonPageInitialProps
  if (p.isNextjsRoutingTypeInitial !== true) {
    logger.warn(
      'isValidGeneralPageInitialProps: isNextjsRoutingTypeInitial is not true',
      { isNextjsRoutingTypeInitial: p.isNextjsRoutingTypeInitial },
    );
    return false;
  }
  if (typeof p.growiVersion !== 'string') {
    logger.warn(
      'isValidGeneralPageInitialProps: growiVersion is not a string',
      { growiVersion: p.growiVersion },
    );
    return false;
  }

  // GeneralPageInitialProps specific page state
  if (p.meta != null && typeof p.meta === 'object') {
    if (!isIPageInfo(p.meta)) {
      logger.warn(
        'isValidGeneralPageInitialProps: meta is not a valid IPageInfo',
        { meta: p.meta },
      );
      return false;
    }
  }

  return true;
}
