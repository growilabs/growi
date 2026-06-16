import type { JSX, ReactNode } from 'react';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { ColorScheme } from '@growi/core';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

import {
  NextThemesProvider,
  useNextThemes,
} from '~/stores-universal/use-next-themes';
import loggerFactory from '~/utils/logger';

import styles from './RawLayout.module.scss';

const toastContainerClass = styles['grw-toast-container'] ?? '';

const logger = loggerFactory('growi:cli:RawLayout');

const ToastContainer = dynamic(
  () => import('react-toastify').then((mod) => mod.ToastContainer),
  { ssr: false },
);

type Props = {
  className?: string;
  children?: ReactNode;
};

export const RawLayout = ({ children, className }: Props): JSX.Element => {
  const classNames: string[] = ['layout-root', 'growi'];

  // Use state to handle SSR/CSR className mismatch
  // Using state ensures React properly updates the DOM after hydration
  const [dynamicClassName, setDynamicClassName] = useState<string | undefined>(
    undefined,
  );

  useIsomorphicLayoutEffect(() => {
    if (className !== dynamicClassName) {
      setDynamicClassName(className);
    }
  }, [className, dynamicClassName]);

  if (dynamicClassName != null) {
    classNames.push(dynamicClassName);
  }

  // get color scheme from next-themes
  const { resolvedTheme, resolvedThemeByAttributes } = useNextThemes();

  const [colorScheme, setColorScheme] = useState<ColorScheme | undefined>(
    undefined,
  );

  // set colorScheme in CSR
  useIsomorphicLayoutEffect(() => {
    setColorScheme(resolvedTheme ?? resolvedThemeByAttributes);
  }, [resolvedTheme, resolvedThemeByAttributes]);

  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <NextThemesProvider>
        <div className={classNames.join(' ')}>
          {children}
          <ToastContainer className={toastContainerClass} theme={colorScheme} />
        </div>
      </NextThemesProvider>
    </>
  );
};
