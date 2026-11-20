import type { JSX } from 'react';
import PrismAsyncLight from 'react-syntax-highlighter/dist/esm/prism-async-light.js';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark.js';

// Remove font-family to use the page's default monospace font
Object.entries<object>(oneDark).forEach(([key, value]) => {
  if ('fontFamily' in value) {
    delete oneDark[key].fontFamily;
  }
});

export const PrismHighlighter = ({
  lang,
  children,
}: {
  lang: string;
  children: string | string[];
}): JSX.Element => (
  <PrismAsyncLight PreTag="div" style={oneDark} language={lang}>
    {children}
  </PrismAsyncLight>
);
