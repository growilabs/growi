import type { Options as ReactMarkdownOptions } from 'react-markdown';
import type { Options as RevealOptions } from 'reveal.js';

export type PresentationOptions = {
  rendererOptions: ReactMarkdownOptions;
  revealOptions?: RevealOptions;
  isDarkMode?: boolean;
  disableSeparationByHeader?: boolean;
};
