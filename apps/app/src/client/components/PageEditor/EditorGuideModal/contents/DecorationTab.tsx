import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from 'reactstrap';

import type { LayoutGuideItem } from '../components/GuideRow';
import { GuideRow } from '../components/GuideRow';

import styles from './DecorationTab.module.scss';

const BOOTSTRAP_COLORS = [
  'primary',
  'danger',
  'secondary',
  'success',
  'warning',
  'info',
  'light',
  'dark',
] as const;
type BootstrapColor = (typeof BOOTSTRAP_COLORS)[number];

export const DecorationTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.decoration';
  const [currentStyle, setCurrentStyle] = useState<BootstrapColor>('primary');
  const [isOpen, setIsOpen] = useState(false);

  const colorConfigs: Record<BootstrapColor, { icon: string; prefix: string }> =
    {
      primary: { icon: 'chat', prefix: '[!IMPORTANT]' },
      danger: { icon: 'error', prefix: '[!CAUTION]' },
      secondary: { icon: 'sell', prefix: '[!NOTE]' },
      success: { icon: 'check_circle', prefix: '[!TIP]' },
      warning: { icon: 'warning', prefix: '[!WARNING]' },
      info: { icon: 'info', prefix: '[!NOTE]' },
      light: { icon: 'light_mode', prefix: '[!NOTE]' },
      dark: { icon: 'dark_mode', prefix: '[!IMPORTANT]' },
    };

  const styleConfig = useMemo(() => {
    const config = colorConfigs[currentStyle];
    return {
      colorName: currentStyle,
      displayName: currentStyle.charAt(0).toUpperCase() + currentStyle.slice(1),
      iconName: config.icon,
      alertPrefix: config.prefix,
      alertLabel: t(`${i18nKey}.${currentStyle}_label`, {
        defaultValue: currentStyle.toUpperCase(),
      }),
      alertText: t(`${i18nKey}.${currentStyle}_text`, {
        defaultValue: t(`${i18nKey}.placeholder`),
      }),
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
                className={`d-flex align-items-center fw-bold mb-1 ${
                  styleConfig.colorName === 'light' ||
                  styleConfig.colorName === 'dark'
                    ? 'text-body'
                    : `text-${styleConfig.colorName}`
                }`}
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
        code: `<p class="text-bg-${styleConfig.colorName}">${t(`${i18nKey}.placeholder`)}</p>`,
        underContent: (
          <p className={`text-bg-${styleConfig.colorName} px-2 m-0`}>
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
    <div className={`px-4 py-3 ${styles.decorationTab}`}>
      <section className="mb-4">
        <h3 className="fw-bold mb-2 fs-5">{t(`${i18nKey}.style`)}</h3>
        <Dropdown isOpen={isOpen} toggle={() => setIsOpen(!isOpen)}>
          <DropdownToggle
            outline
            color="body"
            caret
            className={`border d-flex align-items-center gap-2 text-${styleConfig.colorName === 'light' ? 'dark' : styleConfig.colorName}`}
            style={{ minWidth: '160px' }}
          >
            <span className="material-symbols-outlined align-middle fs-6">
              {styleConfig.iconName}
            </span>
            <span className="flex-grow-1">{styleConfig.displayName}</span>
          </DropdownToggle>
          <DropdownMenu className={styles.dropdownMenu}>
            {BOOTSTRAP_COLORS.map((color) => (
              <DropdownItem
                key={color}
                className={`d-flex align-items-center gap-2 ${currentStyle === color ? 'active' : ''}`}
                onClick={() => setCurrentStyle(color)}
                style={
                  currentStyle === color
                    ? {
                        backgroundColor: `var(--bs-${color})`,
                        color: color === 'light' ? 'black' : 'white',
                      }
                    : {}
                }
              >
                <span className="material-symbols-outlined">
                  {colorConfigs[color].icon}
                </span>
                {color.charAt(0).toUpperCase() + color.slice(1)}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
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
