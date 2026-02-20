import type { JSX, ReactNode } from 'react';
import { PrismAsyncLight } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

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
  children: ReactNode;
}): JSX.Element => (
  <PrismAsyncLight PreTag="div" style={oneDark} language={lang}>
    {children}
  </PrismAsyncLight>
);
