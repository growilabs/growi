import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from 'reactstrap';

import { usePreviewOptions } from '~/stores/renderer';

import type { LayoutGuideItem } from '../components/GuideRow';
import { GuideRow } from '../components/GuideRow';

import styles from './DecorationTab.module.scss';

const BOOTSTRAP_STYLES = [
  'primary',
  'secondary',
  'info',
  'success',
  'warning',
  'danger',
] as const;
type BOOTSTRAP_STYLES = (typeof BOOTSTRAP_STYLES)[number];

const BOOTSTRAP_STYLES_TO_CONFIGS_MAPPINGS: Record<
  BOOTSTRAP_STYLES,
  { icon: string; calloutType?: string }
> = {
  primary: {
    icon: 'feedback',
    calloutType: 'important',
  },
  secondary: { icon: 'label' },
  info: { icon: 'info', calloutType: 'note' },
  success: { icon: 'lightbulb', calloutType: 'tip' },
  warning: { icon: 'warning', calloutType: 'warning' },
  danger: { icon: 'report', calloutType: 'caution' },
};

export const DecorationTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.decoration';
  const [currentStyle, setCurrentStyle] = useState<BOOTSTRAP_STYLES>('primary');
  const [isOpen, setIsOpen] = useState(false);

  const { data: previewOptions } = usePreviewOptions();

  const calloutConfig: { icon: string; calloutType?: string } =
    BOOTSTRAP_STYLES_TO_CONFIGS_MAPPINGS[currentStyle];
  const displayName =
    currentStyle.charAt(0).toUpperCase() + currentStyle.slice(1);

  const LAYOUT_GUIDES: LayoutGuideItem[] = useMemo(
    () =>
      [
        currentStyle !== 'secondary' && {
          id: 'alert',
          title: t(`${i18nKey}.alert`),
          code: `> [!${calloutConfig.calloutType?.toUpperCase()}]\n> ${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}`,
          preview: (
            <ReactMarkdown
              {...previewOptions}
            >{`> [!${calloutConfig.calloutType?.toUpperCase()}]\n> ${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}`}</ReactMarkdown>
          ),
        },
        currentStyle !== 'secondary' && {
          id: 'alert2',
          code: `:::${calloutConfig.calloutType}\n${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}\n:::`,
          preview: (
            <ReactMarkdown
              {...previewOptions}
            >{`:::${calloutConfig.calloutType}\n${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}\n:::`}</ReactMarkdown>
          ),
        },
        currentStyle !== 'secondary' && {
          id: 'alert3',
          title: t(`${i18nKey}.alert_with_custom_title`),
          code: `:::${calloutConfig.calloutType}[${t(`${i18nKey}.alert_with_custom_title_text`)}]\n${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}\n:::`,
          preview: (
            <ReactMarkdown
              {...previewOptions}
            >{`:::${calloutConfig.calloutType}[${t(`${i18nKey}.alert_with_custom_title_text`)}]\n${t(`${i18nKey}.${currentStyle}_text`, { defaultValue: t(`${i18nKey}.placeholder`) })}\n:::`}</ReactMarkdown>
          ),
        },
        currentStyle === 'secondary' && {
          id: 'alert_empty',
          title: t(`${i18nKey}.alert`),
        },
        {
          id: 'badge',
          title: t(`${i18nKey}.badge`),
          code: `<span class="badge text-bg-${currentStyle}">${t(`${i18nKey}.badge`)}</span>`,
          preview: (
            <span className={`badge text-bg-${currentStyle}`}>
              {t(`${i18nKey}.badge`)}
            </span>
          ),
        },
        {
          id: 'text-color',
          title: t(`${i18nKey}.text_color`),
          code: `<p class="text-${currentStyle}">${t(`${i18nKey}.placeholder`)}</p>`,
          underContent: (
            <p className={`text-${currentStyle} m-0`}>
              {t(`${i18nKey}.placeholder`)}
            </p>
          ),
        },
        {
          id: 'back-color',
          title: t(`${i18nKey}.back_color`),
          code: `<p class="text-bg-${currentStyle}">${t(`${i18nKey}.placeholder`)}</p>`,
          underContent: (
            <p className={`text-bg-${currentStyle} px-2 m-0`}>
              {t(`${i18nKey}.placeholder`)}
            </p>
          ),
        },
        {
          id: 'alert-block',
          title: t(`${i18nKey}.alert_block`),
          code: `<div class="alert alert-${currentStyle}" role="alert">\n  ${t(`${i18nKey}.placeholder`)}\n</div>`,
          underContent: (
            <div className={`alert alert-${currentStyle} m-0`}>
              {t(`${i18nKey}.placeholder`)}
            </div>
          ),
        },
      ].filter((item) => item !== false) as LayoutGuideItem[],
    [currentStyle, t, previewOptions, calloutConfig.calloutType],
  );

  return (
    <div className={`px-4 py-3 ${styles.decorationTab}`}>
      <section className="mb-4">
        <h3 className="fw-bold mb-2 fs-5">{t(`${i18nKey}.style`)}</h3>
        <Dropdown isOpen={isOpen} toggle={() => setIsOpen(!isOpen)}>
          <DropdownToggle
            outline
            color="body"
            caret
            className={`border d-flex align-items-center gap-2 text-${currentStyle}`}
            style={{ minWidth: '160px' }}
          >
            <span className="flex-grow-1 justify-content-start d-flex align-items-center gap-1">
              <span className="material-symbols-outlined align-middle fs-6">
                {calloutConfig.icon}
              </span>
              {displayName}
            </span>
          </DropdownToggle>
          <DropdownMenu className={styles.dropdownMenu}>
            {BOOTSTRAP_STYLES.map((style) => (
              <DropdownItem
                key={style}
                active={currentStyle === style}
                className="d-flex align-items-center gap-2"
                onClick={() => setCurrentStyle(style)}
              >
                <span className="material-symbols-outlined">
                  {BOOTSTRAP_STYLES_TO_CONFIGS_MAPPINGS[style].icon}
                </span>
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
      </section>

      <hr />

      <div key={currentStyle} className={styles.decorationBody}>
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
