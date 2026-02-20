import type { CSSProperties, JSX, ReactNode } from 'react';

// Hardcoded container styles from the oneDark Prism theme.
// fontFamily is intentionally omitted so the page's default monospace font is used.
export const preStyle: CSSProperties = {
  background: 'hsl(220, 13%, 18%)',
  color: 'hsl(220, 14%, 71%)',
  textShadow: '0 1px rgba(0, 0, 0, 0.3)',
  direction: 'ltr',
  textAlign: 'left',
  whiteSpace: 'pre',
  wordSpacing: 'normal',
  wordBreak: 'normal',
  lineHeight: '1.5',
  tabSize: 2,
  hyphens: 'none',
  padding: '1em',
  margin: '0.5em 0',
  overflow: 'auto',
  borderRadius: '0.3em',
};

export const codeStyle: CSSProperties = {
  background: 'hsl(220, 13%, 18%)',
  color: 'hsl(220, 14%, 71%)',
  textShadow: '0 1px rgba(0, 0, 0, 0.3)',
  direction: 'ltr',
  textAlign: 'left',
  whiteSpace: 'pre',
  wordSpacing: 'normal',
  wordBreak: 'normal',
  lineHeight: '1.5',
  tabSize: 2,
  hyphens: 'none',
};

export const LightweightCodeBlock = ({
  lang,
  children,
}: {
  lang: string;
  children: ReactNode;
}): JSX.Element => {
  return (
    <div style={preStyle}>
      <code className={`language-${lang}`} style={codeStyle}>
        {children}
      </code>
    </div>
  );
};
