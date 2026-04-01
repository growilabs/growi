import type React from 'react';
import { useTranslation } from 'react-i18next';

import { toastSuccess } from '~/client/util/toastr';

import styles from './TextStyleTab.module.scss';

const GuideRow = ({
  title,
  code,
  preview,
}: {
  title: string;
  code: string;
  preview: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    toastSuccess(t('editor_guide.textstyle.copy_done'));
  };

  return (
    <section className={title !== '' ? 'mt-4 mb-1' : 'mb-1'}>
      {title !== '' && <h3 className="h6 fw-bold mb-2">{title}</h3>}
      <div className="d-flex flex-row align-items-center gap-3 py-1 flex-nowrap">
        <button
          type="button"
          onClick={handleCopy}
          style={{ cursor: 'pointer' }}
          className="flex-shrink-0 border-0 p-0 bg-transparent text-start"
        >
          <div
            className={`p-2 ps-2 pe-4 rounded position-relative ${styles.codeBlockWrapper}`}
          >
            <pre
              className={`m-0 small font-monospace fw-normal ${styles.codeContent}`}
            >
              {code}
            </pre>
            <small
              className={`position-absolute badge bg-secondary opacity-50 ${styles.copyBadge}`}
            >
              Copy
            </small>
          </div>
        </button>
        <div className="flex-grow-1 text-nowrap">
          <div className={`wiki-content fw-normal ${styles.wikiPreview}`}>
            {preview}
          </div>
        </div>
      </div>
    </section>
  );
};

export const TextStyleTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.textstyle';

  const TEXT_STYLE_GUIDES = [
    {
      id: 'bold',
      title: t(`${i18nKey}.bold`),
      code: `${t(
        `${i18nKey}.this`,
      )} **${t(`${i18nKey}.bold`)}** ${t(`${i18nKey}.is`)}\n${t(`${i18nKey}.this`)} __${t(`${i18nKey}.bold`)}__ ${t(`${i18nKey}.is`)}`,
      preview: (
        <div className="lh-base">
          {t(`${i18nKey}.this`)} <strong>{t(`${i18nKey}.bold`)}</strong>{' '}
          {t(`${i18nKey}.is`)}
          <br />
          {t(`${i18nKey}.this`)} <strong>{t(`${i18nKey}.bold`)}</strong>{' '}
          {t(`${i18nKey}.is`)}
        </div>
      ),
    },
    {
      id: 'italic',
      title: t(`${i18nKey}.italic`),
      code: `${t(
        `${i18nKey}.this`,
      )} *${t(`${i18nKey}.italic`)}*${t(`${i18nKey}.is`)}\n${t(`${i18nKey}.this`)} _${t(`${i18nKey}.italic`)}_${t(`${i18nKey}.is`)}`,
      preview: (
        <div className="lh-base">
          {t(`${i18nKey}.this`)} <em>{t(`${i18nKey}.italic`)}</em>{' '}
          {t(`${i18nKey}.is`)}
          <br />
          {t(`${i18nKey}.this`)} <em>{t(`${i18nKey}.italic`)}</em>{' '}
          {t(`${i18nKey}.is`)}
        </div>
      ),
    },
    {
      id: 'strikethrough',
      title: t(`${i18nKey}.strikethrough`),
      code: `~~${t(`${i18nKey}.strikethrough`)}~~`,
      preview: <del>{t(`${i18nKey}.strikethrough`)}</del>,
    },
    {
      id: 'inline-code',
      title: t(`${i18nKey}.inline_code`),
      code: `\`${t(`${i18nKey}.inline_code`)}\` \n~~~${t(`${i18nKey}.inline_code`)}~~~`,
      preview: (
        <div className="d-flex flex-column gap-2">
          <code
            className={`rounded px-1 d-inline-block bg-transparent ${styles.inlineCodeLabel}`}
          >
            {t(`${i18nKey}.inline_code`)}
          </code>
          <code
            className={`rounded px-1 d-inline-block bg-transparent ${styles.inlineCodeLabel}`}
          >
            {t(`${i18nKey}.inline_code`)}
          </code>
        </div>
      ),
    },
    {
      id: 'bold-italic',
      title: t(`${i18nKey}.bold_italic`),
      code: `***${t(`${i18nKey}.all_important`)}***`,
      preview: (
        <strong>
          <u>{t(`${i18nKey}.all_important`).replace('\n', '')}</u>
        </strong>
      ),
    },
    {
      id: 'emoji',
      title: t(`${i18nKey}.emoji`),
      code: ':+1:\n:white_check_mark:\n:lock:',
      preview: <span style={{ fontSize: '1.2rem' }}>👍✅🔒</span>,
    },
    {
      id: 'sub',
      title: t(`${i18nKey}.sub_sup`),
      code: t(`${i18nKey}.is_text`, {
        val: `<sub>${t(`${i18nKey}.sub_text`)}</sub>`,
      }),
      preview: (
        <span>
          {t(`${i18nKey}.this`)} <sub>{t(`${i18nKey}.sub_text`)}</sub>{' '}
          {t(`${i18nKey}.is`)}
        </span>
      ),
    },
    {
      id: 'sup',
      title: '',
      code: t(`${i18nKey}.is_text`, {
        val: `<sup>${t(`${i18nKey}.sup_text`)}</sup>`,
      }),
      preview: (
        <span>
          {t(`${i18nKey}.this`)} <sup>{t(`${i18nKey}.sup_text`)}</sup>{' '}
          {t(`${i18nKey}.is`)}
        </span>
      ),
    },
    {
      id: 'link-docs',
      title: t(`${i18nKey}.link_label`),
      code: `[${t(`${i18nKey}.link_docs`)}](https://docs.growi.org/ja/g)`,
      preview: (
        <a
          href="https://docs.growi.org/ja/g"
          target="_blank"
          rel="noreferrer"
          className="text-secondary text-decoration-underline"
          style={{ color: '#777570' }}
          onClick={(e) => e.stopPropagation()}
        >
          {t(`${i18nKey}.link_growi`)}
          <span className="material-symbols-outlined">open_in_new</span>
        </a>
      ),
    },
    {
      id: 'link-sandbox',
      title: '',
      code: `[${t(`${i18nKey}.link_sandbox`)}](/Sandbox)`,
      preview: (
        <a
          href="/Sandbox"
          className="text-secondary text-decoration-underline"
          style={{ color: '#777570' }}
          onClick={(e) => e.stopPropagation()}
        >
          {t(`${i18nKey}.link_sandbox`)}
          <span className="material-symbols-outlined">open_in_new</span>
        </a>
      ),
    },
  ];
  return (
    <div className={`px-4 py-2 overflow-y-auto ${styles.textStyleTab}`}>
      {TEXT_STYLE_GUIDES.map((item) => (
        <GuideRow
          key={item.id}
          title={item.title}
          code={item.code}
          preview={item.preview}
        />
      ))}
    </div>
  );
};
