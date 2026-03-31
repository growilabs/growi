import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toastSuccess } from '~/client/util/toastr';

interface LayoutGuideItem {
  id: string;
  title: string;
  code: string;
  preview?: React.ReactNode;
  minWidth?: string;
  underContent?: React.ReactNode;
}
type GuideRowProps = Omit<LayoutGuideItem, 'id'>;

const GuideRow = ({
  title,
  code,
  preview,
  minWidth = '230px',
  underContent,
}: GuideRowProps) => {
  const { t } = useTranslation();
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    toastSuccess(t('editor_guide.textstyle.copy_done'));
  };

  const isFullWidth = minWidth === '100%' || !preview;

  return (
    <section className={title !== '' ? 'mt-4 mb-2' : 'mb-2'}>
      {title !== '' && <h3 className="fw-bold mb-2 fs-4 text-body">{title}</h3>}
      <div className="d-flex flex-row flex-wrap align-items-center gap-4 py-1">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-grow-0 flex-shrink-0 border-0 p-0 bg-transparent text-start"
          style={{
            cursor: 'pointer',
            flex: isFullWidth ? '1 0 100%' : '0 0 auto',
            width: isFullWidth ? '100%' : 'fit-content',
            minWidth: isFullWidth ? '100%' : minWidth,
            display: 'block',
          }}
        >
          <div
            className={`text-light p-2 ps-3 pe-5 rounded position-relative ${isFullWidth ? 'w-100' : ''}`}
            style={{
              backgroundColor: 'var(--bs-dark)',
            }}
          >
            <pre
              className="m-0 small font-monospace text-white-50"
              style={{
                whiteSpace: isFullWidth ? 'pre-wrap' : 'pre',
                lineHeight: '1.5',
              }}
            >
              {code}
            </pre>
            <small
              className="position-absolute badge bg-secondary opacity-50"
              style={{ fontSize: '0.4rem', top: '4px', right: '4px' }}
            >
              Copy
            </small>
          </div>
        </button>

        {preview && (
          <div
            className="flex-grow-0 flex-shrink-0"
            style={{
              flexBasis: isFullWidth ? '100%' : 'auto',
            }}
          >
            <div className="wiki-content small">{preview}</div>
          </div>
        )}
      </div>

      {underContent && <div className="mt-2 w-100">{underContent}</div>}
    </section>
  );
};

export const DecorationTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.decoration';
  const [currentStyle, setCurrentStyle] = useState<'primary' | 'danger'>(
    'primary',
  );
  const [isOpen, setIsOpen] = useState(false);

  const styleConfig = useMemo(() => {
    const isPrimary = currentStyle === 'primary';
    return {
      colorName: currentStyle,
      displayName: isPrimary ? 'Primary' : 'Danger',
      iconName: isPrimary ? 'chat' : 'error',
      alertPrefix: isPrimary ? '[!IMPORTANT]' : '[!CAUTION]',
      alertLabel: isPrimary
        ? t(`${i18nKey}.important_label`)
        : t(`${i18nKey}.caution_label`),
      alertText: isPrimary
        ? t(`${i18nKey}.important_text`)
        : t(`${i18nKey}.caution_text`),
      icon: isPrimary ? 'bi-chat-left-text' : 'bi-exclamation-circle',
    };
  }, [currentStyle, t]);

  const LAYOUT_GUIDES: LayoutGuideItem[] = useMemo(
    () => [
      {
        id: 'alert',
        title: t(`${i18nKey}.alert`),
        code: `> ${styleConfig.alertPrefix}\n> ${styleConfig.alertText}`,
        preview: (
          <div
            className={`d-flex align-items-center border-start border-4 border-${styleConfig.colorName} ps-3 py-1`}
            style={{ minHeight: '52px' }}
          >
            <div className="d-flex flex-column justify-content-center">
              <div
                className={`d-flex align-items-center fw-bold text-${styleConfig.colorName} mb-1`}
              >
                <span className="me-2 d-flex align-items-center">
                  <span className="material-symbols-outlined align-middle fs-6">
                    {styleConfig.iconName}
                  </span>
                </span>
                <span style={{ lineHeight: 1 }}>{styleConfig.alertLabel}</span>
              </div>
              <div className="text-body small lh-base">
                {styleConfig.alertText}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'badge',
        title: t(`${i18nKey}.badge`),
        code: `<span class="badge text-bg-${styleConfig.colorName}">${t(`${i18nKey}.badge`)}</span>`,
        preview: (
          <span className={`badge text-bg-${styleConfig.colorName}`}>
            {t(`${i18nKey}.badge`)}
          </span>
        ),
      },
      {
        id: 'text-color',
        title: t(`${i18nKey}.text_color`),
        code: `<p class="text-${styleConfig.colorName}" >${t(`${i18nKey}.placeholder`)}</p>`,
        underContent: (
          <p className={`text-${styleConfig.colorName} m-0`}>
            {t(`${i18nKey}.placeholder`)}
          </p>
        ),
      },
      {
        id: 'back-color',
        title: t(`${i18nKey}.back_color`),
        code: `<p class="text-white minWidth: '100%' bg-${styleConfig.colorName}">${t(`${i18nKey}.placeholder`)}</p>`,
        underContent: (
          <p className={`text-white bg-${styleConfig.colorName} px-2 m-0`}>
            {t(`${i18nKey}.placeholder`)}
          </p>
        ),
      },
      {
        id: 'alert-block',
        title: t(`${i18nKey}.alert_block`),
        code: `<div class="alert alert-${styleConfig.colorName}" role="alert">\n  ${t(`${i18nKey}.placeholder`)}\n</div>`,
        underContent: (
          <div className={`alert alert-${styleConfig.colorName} m-0`}>
            {t(`${i18nKey}.placeholder`)}
          </div>
        ),
      },
    ],
    [styleConfig, t],
  );

  return (
    <div
      className="px-4 py-3 overflow-y-auto"
      style={{
        maxHeight: '80vh',
        minWidth: '650px',
      }}
    >
      <section className="mb-4">
        <h3 className="fw-bold mb-2 fs-5">{t(`${i18nKey}.style`)}</h3>
        <div className={`dropdown ${isOpen ? 'show' : ''}`}>
          <button
            className={`btn btn-light border dropdown-toggle d-flex align-items-center gap-2 text-${styleConfig.colorName}`}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            style={{ minWidth: '160px', textAlign: 'left' }}
          >
            <span className="material-symbols-outlined align-middle fs-6">
              {styleConfig.iconName}
            </span>
            <span className="flex-grow-1">{styleConfig.displayName}</span>
          </button>
          <ul
            className={`dropdown-menu ${isOpen ? 'show' : ''}`}
            style={{
              position: 'absolute',
              display: isOpen ? 'block' : 'none',
              marginTop: '0.125rem',
            }}
          >
            <li>
              <button
                className={`dropdown-item d-flex align-items-center gap-2 ${currentStyle === 'primary' ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setCurrentStyle('primary');
                  setIsOpen(false);
                }}
                style={
                  currentStyle === 'primary'
                    ? { backgroundColor: 'var(--bs-primary)', color: 'white' }
                    : {}
                }
              >
                <span className="material-symbols-outlined">chat</span> Primary
              </button>
            </li>
            <li>
              <button
                className={`dropdown-item d-flex align-items-center gap-2 ${currentStyle === 'danger' ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setCurrentStyle('danger');
                  setIsOpen(false);
                }}
              >
                <span className="material-symbols-outlined">Error</span> Danger
              </button>
            </li>
          </ul>
        </div>
      </section>

      <hr />

      <div key={currentStyle}>
        {LAYOUT_GUIDES.map((item) => (
          <GuideRow key={item.id} {...item} minWidth="280px" />
        ))}
      </div>

      <div className="mt-5 pt-3 border-top">
        <h3 className="fw-bold fs-5 mb-3">{t(`${i18nKey}.docs_title`)}</h3>
        <div className="d-flex flex-column gap-2">
          {[
            {
              key: 'badge',
              url: 'https://getbootstrap.com/docs/5.3/components/badge/',
            },
            {
              key: 'color',
              url: 'https://getbootstrap.com/docs/5.3/utilities/colors/',
            },
            {
              key: 'alert',
              url: 'https://getbootstrap.com/docs/5.3/components/alerts/',
            },
          ].map(({ key, url }) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-decoration-none text-secondary small d-flex align-items-center"
            >
              {t(`${i18nKey}.docs_${key}`)}
              <span className="material-symbols-outlined">open_in_new</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};
