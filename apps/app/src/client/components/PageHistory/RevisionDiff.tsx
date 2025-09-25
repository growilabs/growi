import { useMemo, type JSX } from 'react';

import type { IRevisionHasId } from '@growi/core';
import { GrowiThemeSchemeType } from '@growi/core';
import { returnPathForURL } from '@growi/core/dist/utils/path-utils';
import { PresetThemesMetadatas } from '@growi/preset-themes';
import { createPatch } from 'diff';
import type { Diff2HtmlConfig } from 'diff2html';
import { html } from 'diff2html';
import { ColorSchemeType } from 'diff2html/lib/types';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import urljoin from 'url-join';


import { Themes, useNextThemes } from '~/stores-universal/use-next-themes';

import UserDate from '../../../components/User/UserDate';
import { useSWRxGrowiThemeSetting } from '../../../stores/admin/customize';


import styles from './RevisionDiff.module.scss';

import 'diff2html/bundles/css/diff2html.min.css';

const moduleClass = styles['revision-diff-container'];

type RevisioinDiffProps = {
  currentRevision: IRevisionHasId,
  previousRevision: IRevisionHasId,
  revisionDiffOpened: boolean,
  currentPageId: string,
  currentPagePath: string,
  onClose: () => void,
}

export const RevisionDiff = (props: RevisioinDiffProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    currentRevision, previousRevision, revisionDiffOpened, currentPageId, currentPagePath, onClose,
  } = props;

  const { theme: userTheme } = useNextThemes();
  const { data: growiTheme } = useSWRxGrowiThemeSetting();

  const colorScheme: ColorSchemeType = useMemo(() => {
    if (growiTheme == null) {
      return ColorSchemeType.AUTO;
    }

    const growiThemeSchemeType = growiTheme.pluginThemesMetadatas[0]?.schemeType
        ?? PresetThemesMetadatas.find(theme => theme.name === growiTheme.currentTheme)?.schemeType;

    switch (growiThemeSchemeType) {
      case GrowiThemeSchemeType.DARK:
        return ColorSchemeType.DARK;
      case GrowiThemeSchemeType.LIGHT:
        return ColorSchemeType.LIGHT;
      default:
        // growiThemeSchemeType === GrowiThemeSchemeType.BOTH
    }
    switch (userTheme) {
      case Themes.DARK:
        return ColorSchemeType.DARK;
      case Themes.LIGHT:
        return ColorSchemeType.LIGHT;
      default:
        return ColorSchemeType.AUTO;
    }
  }, [growiTheme, userTheme]);

  const previousText = (currentRevision._id === previousRevision._id) ? '' : previousRevision.body;

  const patch = createPatch(
    currentRevision.pageId, // currentRevision.path is DEPRECATED
    previousText,
    currentRevision.body,
  );

  const option: Diff2HtmlConfig = {
    outputFormat: 'side-by-side',
    drawFileList: false,
    colorScheme,
  };

  const diffViewHTML = revisionDiffOpened ? html(patch, option) : '';

  const diffView = { __html: diffViewHTML };

  return (
    <div className={moduleClass}>
      <div className="container">
        <div className="row mt-2">
          <div className="col px-0 py-2">
            <span className="fw-bold">{t('page_history.comparing_source')}</span>
            <Link
              href={urljoin(returnPathForURL(currentPagePath, currentPageId), `?revisionId=${previousRevision._id}`)}
              className="small ms-2
                link-created-at
                link-secondary link-opacity-75 link-opacity-100-hover
                link-offset-2 link-underline-opacity-25 link-underline-opacity-100-hover"
              onClick={onClose}
              prefetch={false}
            >
              <UserDate dateTime={previousRevision.createdAt} />
            </Link>
          </div>
          <div className="col px-0 py-2">
            <span className="fw-bold">{t('page_history.comparing_target')}</span>
            <Link
              href={urljoin(returnPathForURL(currentPagePath, currentPageId), `?revisionId=${currentRevision._id}`)}
              className="small ms-2
                link-created-at
                link-secondary link-opacity-75 link-opacity-100-hover
                link-offset-2 link-underline-opacity-25 link-underline-opacity-100-hover"
              onClick={onClose}
              prefetch={false}
            >
              <UserDate dateTime={currentRevision.createdAt} />
            </Link>
          </div>
        </div>
      </div>
      {/* eslint-disable-next-line react/no-danger */}
      <div className="revision-history-diff pb-1" dangerouslySetInnerHTML={diffView} />
    </div>
  );

};
