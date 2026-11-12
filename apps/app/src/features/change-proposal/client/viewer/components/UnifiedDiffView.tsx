import type { JSX } from 'react';
import { useMemo } from 'react';
import { html } from 'diff2html';

import {
  buildDiff2HtmlOptions,
  useDiff2HtmlColorScheme,
} from '~/features/change-proposal/client/shared';

import styles from './UnifiedDiffView.module.scss';

import '~/features/change-proposal/client/shared/diff2html.vendor-styles.prebuilt';

type Props = {
  readonly unifiedDiff: string;
};

export const UnifiedDiffView = ({ unifiedDiff }: Props): JSX.Element => {
  const colorScheme = useDiff2HtmlColorScheme();

  const diffHtml = useMemo(
    () => ({ __html: html(unifiedDiff, buildDiff2HtmlOptions(colorScheme)) }),
    [unifiedDiff, colorScheme],
  );

  return (
    <div
      className={styles['unified-diff-view']}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: diff2html escapes the diff content
      dangerouslySetInnerHTML={diffHtml}
    />
  );
};
