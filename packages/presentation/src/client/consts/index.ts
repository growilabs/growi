import type { Options as ReactMarkdownOptions } from 'react-markdown';
import type { Options as RevealOptions } from 'reveal.js';

export const MARP_CONTAINER_CLASS_NAME = 'marpit';

export type PresentationOptions = {
  rendererOptions: ReactMarkdownOptions;
  revealOptions?: RevealOptions;
  isDarkMode?: boolean;
  disableSeparationByHeader?: boolean;
};
