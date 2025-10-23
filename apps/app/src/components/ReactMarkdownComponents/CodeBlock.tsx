import type { JSX, ReactNode } from 'react';
import { PrismAsyncLight } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

import styles from './CodeBlock.module.scss';

// remove font-family
Object.entries<object>(oneDark).forEach(([key, value]) => {
  if ('fontFamily' in value) {
    delete oneDark[key].fontFamily;
  }
});

type InlineCodeBlockProps = {
  children: ReactNode;
  className?: string;
};

const InlineCodeBlockSubstance = (props: InlineCodeBlockProps): JSX.Element => {
  const { children, className, ...rest } = props;
  return (
    <code className={`code-inline ${className ?? ''}`} {...rest}>
      {children}
    </code>
  );
};

function extractChildrenToIgnoreReactNode(children: ReactNode): ReactNode {
  if (children == null) {
    return children;
  }

  // Single element array
  if (Array.isArray(children) && children.length === 1) {
    return extractChildrenToIgnoreReactNode(children[0]);
  }

  // Multiple element array
  if (Array.isArray(children) && children.length > 1) {
    return children
      .map((node) => extractChildrenToIgnoreReactNode(node))
      .join('');
  }

  // object
  if (typeof children === 'object') {
    const grandChildren =
      (children as any).children ?? (children as any).props.children;
    return extractChildrenToIgnoreReactNode(grandChildren);
  }

  return String(children).replace(/\n$/, '');
}

function CodeBlockSubstance({
  lang,
  children,
}: {
  lang: string;
  children: ReactNode;
}): JSX.Element {
  // return alternative element
  //   in order to fix "CodeBlock string is be [object Object] if searched"
  // see: https://github.com/growilabs/growi/pull/7484
  //
  // Note: You can also remove this code if the user requests to see the code highlighted in Prism as-is.

  const isSimpleString =
    typeof children === 'string' ||
    (Array.isArray(children) &&
      children.length === 1 &&
      typeof children[0] === 'string');
  if (!isSimpleString) {
    return (
      <div style={oneDark['pre[class*="language-"]']}>
        <code
          className={`language-${lang}`}
          style={oneDark['code[class*="language-"]']}
        >
          {children}
        </code>
      </div>
    );
  }

  return (
    <PrismAsyncLight PreTag="div" style={oneDark} language={lang}>
      {extractChildrenToIgnoreReactNode(children)}
    </PrismAsyncLight>
  );
}

type CodeBlockProps = {
  children: ReactNode;
  className?: string;
  inline?: true;
};

export const CodeBlock = (props: CodeBlockProps): JSX.Element => {
  // TODO: set border according to the value of 'customize:highlightJsStyleBorder'
  const { className, children, inline } = props;
  if (inline) {
    return (
      <InlineCodeBlockSubstance className={`code-inline ${className ?? ''}`}>
        {children}
      </InlineCodeBlockSubstance>
    );
  }

  const match = /language-(\w+)(:?.+)?/.exec(className || '');
  const lang = match && match[1] ? match[1] : '';
  const name = match && match[2] ? match[2].slice(1) : null;

  return (
    <>
      {name != null && (
        <cite
          className={`code-highlighted-title ${styles['code-highlighted-title']}`}
        >
          {name}
        </cite>
      )}
      <CodeBlockSubstance lang={lang}>{children}</CodeBlockSubstance>
    </>
  );
};
