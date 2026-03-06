import type { ComponentType, JSX, ReactNode } from 'react';
import { startTransition, useEffect, useState } from 'react';

import { LightweightCodeBlock } from './LightweightCodeBlock';

import styles from './CodeBlock.module.scss';

type PrismHighlighterProps = { lang: string; children: ReactNode };

// Cache the loaded module so all CodeBlock instances share a single import
let prismModulePromise: Promise<ComponentType<PrismHighlighterProps>> | null =
  null;
function loadPrismHighlighter(): Promise<ComponentType<PrismHighlighterProps>> {
  if (prismModulePromise == null) {
    prismModulePromise = import('./PrismHighlighter').then(
      (mod) => mod.PrismHighlighter,
    );
  }
  return prismModulePromise;
}

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

  // React element or object with nested children
  if (typeof children === 'object') {
    const childObj = children as {
      children?: ReactNode;
      props?: { children?: ReactNode };
    };
    const grandChildren = childObj.children ?? childObj.props?.children;
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
  const [Highlighter, setHighlighter] =
    useState<ComponentType<PrismHighlighterProps> | null>(null);

  useEffect(() => {
    loadPrismHighlighter().then((comp) => {
      startTransition(() => {
        setHighlighter(() => comp);
      });
    });
  }, []);

  // return alternative element
  //   in order to fix "CodeBlock string is be [object Object] if searched"
  // see: https://github.com/growilabs/growi/pull/7484
  const isSimpleString =
    typeof children === 'string' ||
    (Array.isArray(children) &&
      children.length === 1 &&
      typeof children[0] === 'string');

  const textContent = extractChildrenToIgnoreReactNode(children);

  // SSR or loading or non-simple children: use lightweight container
  // - SSR: Highlighter is null → styled container with content
  // - Client hydration: matches SSR output (Highlighter still null)
  // - After hydration: useEffect fires → import starts
  // - Import done: startTransition swaps to Highlighter (single seamless transition)
  if (Highlighter == null || !isSimpleString) {
    return (
      <LightweightCodeBlock lang={lang}>
        {isSimpleString ? textContent : children}
      </LightweightCodeBlock>
    );
  }

  return <Highlighter lang={lang}>{textContent}</Highlighter>;
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
  const lang = match?.[1] ? match[1] : '';
  const name = match?.[2] ? match[2].slice(1) : null;

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
