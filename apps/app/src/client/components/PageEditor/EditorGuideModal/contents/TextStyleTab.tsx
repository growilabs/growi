import React from 'react';

import { useTranslation } from 'react-i18next';


export const ExternalLinkIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ABB2BF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flex: 'none',
        order: 1,
        flexGrow: 0,
        verticalAlign: 'middle',
        marginLeft: '4px',
      }}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
  );
};

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
            <pre className="m-0 small font-monospace" style={{ whiteSpace: 'pre', color: '#ABB2BF', lineHeight: '1.5' }}>
              {code}
            </pre>
            <small className="position-absolute badge bg-secondary opacity-50" style={{ fontSize: '0.4rem', top: '2px', right: '4px' }}>
              Click
            </small>
          </div>
        </div>
        <div className="flex-grow-1" style={{ whiteSpace: 'nowrap' }}>
          <div className="wiki-content small">
            {preview}
          </div>
        </div>
      </div>
    </section>
  );
};


export const TextStyleTab: React.FC = () => {
  const { t } = useTranslation();
  const ts = 'editor_guide.textstyle';

  const TEXT_STYLE_GUIDES = [
    {
      id: 'bold',
      title: t(`${ts}.bold`),
      code: `${t(`${ts}.is_text`, { val: `**${t(`${ts}.bold`)}**` })}\n${t(`${ts}.is_text`, { val: `__${t(`${ts}.bold`)}__` })}`,
      preview: (
        <div className="lh-base">
          {t(`${ts}.this`)} <strong>{t(`${ts}.bold`)}</strong> {t(`${ts}.is`)}<br />
          {t(`${ts}.this`)} <strong>{t(`${ts}.bold`)}</strong> {t(`${ts}.is`)}
        </div>
      ),
    },
    {
      id: 'italic',
      title: t(`${ts}.italic`),
      code: `${t(`${ts}.this`)} *${t(`${ts}.italic`)}* ${t(`${ts}.is`)}\n${t(`${ts}.this`)} _${t(`${ts}.italic`)}_ ${t(`${ts}.is`)}`,
      preview: (
        <div className="lh-base">
          {t(`${ts}.this`)} <em>{t(`${ts}.italic`)}</em> {t(`${ts}.is`)}<br />
          {t(`${ts}.this`)} <em>{t(`${ts}.italic`)}</em> {t(`${ts}.is`)}
        </div>
      ),
    },
    {
      id: 'strikethrough',
      title: t(`${ts}.strikethrough`),
      code: `~~${t(`${ts}.strikethrough`)}~~`,
      preview: <del>{t(`${ts}.strikethrough`)}</del>,
    },
    {
      id: 'inline-code',
      title: t(`${ts}.inline_code`),
      code: `\`${t(`${ts}.inline_code`)}\` \n~~~${t(`${ts}.inline_code`)}~~~`,
      preview: (
        <div className="d-flex flex-column gap-2">
          <code
            className="rounded px-1"
            style={{
              width: 'fit-content',
              color: '#D63384', // 文字の色
              border: '1px solid #D63384', // 枠線の色（太さ1px、実線、指定の色）
              backgroundColor: 'transparent', // 背景を透明にする場合（必要に応じて）
            }}
          >
            {t(`${ts}.inline_code`)}
          </code>
          <code
            className="rounded px-1"
            style={{
              width: 'fit-content',
              color: '#D63384', // 文字の色
              border: '1px solid #D63384', // 枠線の色
              backgroundColor: 'transparent',
            }}
          >
            {t(`${ts}.inline_code`)}
          </code>
        </div>
      ),
    },
    {
      id: 'bold-italic',
      title: t(`${ts}.bold_italic`),
      code: `***${t(`${ts}.all_important`)}***`,
      preview: <strong><u>{t(`${ts}.all_important`).replace('\n', '')}</u></strong>,
    },
    {
      id: 'emoji',
      title: t(`${ts}.emoji`),
      code: ':+1:\n:white_check_mark:\n:lock:',
      preview: <span style={{ fontSize: '1.2rem' }}>👍✅🔒</span>,
    },
    {
      id: 'sub',
      title: t(`${ts}.sub_sup`),
      code: t(`${ts}.is_text`, { val: `<sub>${t(`${ts}.sub_text`)}</sub>` }),
      preview: <span>{t(`${ts}.this`)} <sub>{t(`${ts}.sub_text`)}</sub> {t(`${ts}.is`)}</span>,
    },
    {
      id: 'sup',
      title: '',
      code: t(`${ts}.is_text`, { val: `<sup>${t(`${ts}.sup_text`)}</sup>` }),
      preview: <span>{t(`${ts}.this`)} <sup>{t(`${ts}.sup_text`)}</sup> {t(`${ts}.is`)}</span>,
    },
    {
      id: 'link-docs',
      title: t(`${ts}.link_label`),
      code: `[${t(`${ts}.link_docs`)}](https://docs.growi.org/ja/g)`,
      preview: (
        <a
          href="https://docs.growi.org/ja/g"
          target="_blank"
          rel="noreferrer"
          className="text-secondary text-decoration-underline"
          style={{ color: '#777570' }}
          onClick={e => e.stopPropagation()}
        >
          {t(`${ts}.link_growi`)}
          <ExternalLinkIcon />
        </a>
      ),
    },
    {
      id: 'link-sandbox',
      title: '',
      code: `[${t(`${ts}.link_sandbox`)}](/Sandbox)`,
      preview: (
        <a
          href="/Sandbox"
          className="text-secondary text-decoration-underline"
          style={{ color: '#777570' }}
          onClick={e => e.stopPropagation()}
        >
          {t(`${ts}.link_sandbox`)}
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
