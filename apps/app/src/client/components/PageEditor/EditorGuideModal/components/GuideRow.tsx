import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PrismAsyncLight } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

import { toastError, toastSuccess } from '~/client/util/toastr';

import styles from './GuideRow.module.scss';

export interface LayoutGuideItem {
  id: string;
  title?: string;
  code?: string;
  preview?: ReactNode;
  minWidth?: string;
  underContent?: ReactNode;
}

export type GuideRowProps = Omit<LayoutGuideItem, 'id'>;

export const GuideRow = ({
  title,
  code,
  preview,
  minWidth = '230px',
  underContent,
}: GuideRowProps) => {
  const { t } = useTranslation();
  const handleCopy = useCallback(async () => {
    try {
      if (code == null) return;

      await navigator.clipboard.writeText(code);
      toastSuccess(t('editor_guide.textstyle.copy_done'));
    } catch (_err) {
      toastError(t('common:failed_to_copy'));
    }
  }, [code, t]);

  const isFullWidth = minWidth === '100%' || !preview;

  return (
    <section className={title ? 'mt-4 mb-2' : 'mb-2'}>
      {title && <h3 className="fw-bold mb-2 fs-5 text-body">{title}</h3>}
      <div className="d-flex flex-row flex-wrap align-items-center gap-4 py-1">
        <button
          type="button"
          onClick={handleCopy}
          className={`${styles.copyButton} ${isFullWidth ? 'w-100 flex-grow-1' : 'flex-grow-0 flex-shrink-0'}`}
          style={{ minWidth: isFullWidth ? '100%' : minWidth }}
        >
          {code != null && (
            <div
              className={`${styles.codeBox} rounded overflow-hidden position-relative ${isFullWidth ? 'w-100' : ''}`}
            >
              <PrismAsyncLight
                style={oneDark}
                language="markdown"
                customStyle={{ margin: 0 }}
                wrapLongLines={isFullWidth}
              >
                {code}
              </PrismAsyncLight>
              <small
                className={`position-absolute badge bg-secondary opacity-50 ${styles.copyBadge}`}
              >
                Copy
              </small>
            </div>
          )}
          {code == null && (
            <span className="text-secondary">
              ({t('editor_guide.decoration.alert_unavailable')})
            </span>
          )}
        </button>

        {preview && (
          <div className="flex-grow-1">
            <div className="wiki-content small">{preview}</div>
          </div>
        )}
      </div>

      {underContent && <div className="mt-2 w-100">{underContent}</div>}
    </section>
  );
};
