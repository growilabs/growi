// Prevent </style> from terminating the element prematurely; <\/ is not recognized as an HTML end tag.
export const sanitizeCustomCss = (css: string): string =>
  css.replace(/<\/(style)/gi, '<\\/$1');
