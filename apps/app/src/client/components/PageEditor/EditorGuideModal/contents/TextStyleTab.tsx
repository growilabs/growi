import React from 'react';
import { useTranslation } from 'react-i18next';

interface TextStyleGuideItem {
  id: string;
  title: string;
  code: string;
  preview: React.ReactNode;
}

export const ExternalLinkIcon = () => {
  return (
    <span
      className="material-symbols-outlined align-middle ms-1 text-muted"
      style={{
        fontSize: '16px',
      }}
    >
      open_in_new
    </span>
  );
};

type GuideRowProps = Omit<TextStyleGuideItem, 'id'>;

const GuideRow = ({
  title,
  code,
  preview,
}: GuideRowProps) => {
  const { t } = useTranslation();
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    alert(t('editor_guide.textstyle.copy_done'));
  };

  return (
    <section className={title !== '' ? 'mt-4 mb-1' : 'mb-1'}>
      {title !== '' && <h3 className="h6 fw-bold mb-2">{title}</h3>}
      <div className="d-flex flex-row align-items-center gap-3 py-1 flex-nowrap">
        <div onClick={handleCopy} style={{ cursor: 'pointer' }} className="flex-shrink-0">
          <div
            className="bg-dark text-light p-2 ps-2 pe-4 rounded position-relative"
            style={{
              backgroundColor: '#2D2E32',
              width: 'fit-content',
            }}
          >
            <pre
              className="m-0 small font-monospace"
              style={{
                whiteSpace: 'pre',
                color: '#ABB2BF',
                fontWeight: 400,
                fontSize: '14px',
              }}
            >
              {code}
            </pre>
            <small className="position-absolute badge bg-secondary opacity-50" style={{ fontSize: '0.4rem', top: '2px', right: '4px' }}>
              Click
            </small>
          </div>
        </div>
        <div className="flex-grow-1" style={{ whiteSpace: 'nowrap' }}>
          <div
            className="wiki-content"
            style={{
              fontWeight: 400,
              fontSize: '14px',
            }}
          >
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

  const TEXT_STYLE_GUIDES: TextStyleGuideItem[] = [
    {
      id: 'bold',
      title: t(`${i18nKey}.bold`),
      code: `${
        t(`${i18nKey}.this`)} **${t(`${i18nKey}.bold`)}** ${t(`${i18nKey}.is`)}\n${t(`${i18nKey}.this`)} __${t(`${i18nKey}.bold`)}__ ${t(`${i18nKey}.is`)}`,
      preview: (
        <div className="lh-base">
          {t(`${i18nKey}.this`)} <strong>{t(`${i18nKey}.bold`)}</strong> {t(`${i18nKey}.is`)}<br />
          {t(`${i18nKey}.this`)} <strong>{t(`${i18nKey}.bold`)}</strong> {t(`${i18nKey}.is`)}
        </div>
      ),
    },
    {
      id: 'italic',
      title: t(`${i18nKey}.italic`),
      code: `${
        t(`${i18nKey}.this`)} *${t(`${i18nKey}.italic`)}*${t(`${i18nKey}.is`)}\n${t(`${i18nKey}.this`)} _${t(`${i18nKey}.italic`)}_${t(`${i18nKey}.is`)}`,
      preview: (
        <div className="lh-base">
          {t(`${i18nKey}.this`)} <em>{t(`${i18nKey}.italic`)}</em> {t(`${i18nKey}.is`)}<br />
          {t(`${i18nKey}.this`)} <em>{t(`${i18nKey}.italic`)}</em> {t(`${i18nKey}.is`)}
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
            className="rounded px-1"
            style={{
              width: 'fit-content',
              color: '#D63384',
              border: '1px solid #D63384',
              backgroundColor: 'transparent',
            }}
          >
            {t(`${i18nKey}.inline_code`)}
          </code>
          <code
            className="rounded px-1"
            style={{
              width: 'fit-content',
              color: '#D63384',
              border: '1px solid #D63384',
              backgroundColor: 'transparent',
            }}
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
      preview: <strong><u>{t(`${i18nKey}.all_important`).replace('\n', '')}</u></strong>,
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
      code: t(`${i18nKey}.is_text`, { val: `<sub>${t(`${i18nKey}.sub_text`)}</sub>` }),
      preview: <span>{t(`${i18nKey}.this`)} <sub>{t(`${i18nKey}.sub_text`)}</sub> {t(`${i18nKey}.is`)}</span>,
    },
    {
      id: 'sup',
      title: '',
      code: t(`${i18nKey}.is_text`, { val: `<sup>${t(`${i18nKey}.sup_text`)}</sup>` }),
      preview: <span>{t(`${i18nKey}.this`)} <sup>{t(`${i18nKey}.sup_text`)}</sup> {t(`${i18nKey}.is`)}</span>,
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
          onClick={e => e.stopPropagation()}
        >
          {t(`${i18nKey}.link_growi`)}
          <ExternalLinkIcon />
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
          onClick={e => e.stopPropagation()}
        >
          {t(`${i18nKey}.link_sandbox`)}
          <ExternalLinkIcon />
        </a>
      ),
    },
  ];
  return (
    <div className="px-4 py-2 overflow-y-auto" style={{ maxHeight: '80vh' }}>
      {TEXT_STYLE_GUIDES.map(item => (
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
