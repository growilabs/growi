import { IMAGE_TOKEN } from './rendered-text';

const IMAGE_LABEL = '[Image]';

/**
 * A stored quote as it is shown to people. `IMAGE_TOKEN` renders as an
 * unreadable box in most fonts, so each one is shown as a label instead.
 */
export const quoteForDisplay = (quote: string): string =>
  quote.replaceAll(IMAGE_TOKEN, IMAGE_LABEL);
