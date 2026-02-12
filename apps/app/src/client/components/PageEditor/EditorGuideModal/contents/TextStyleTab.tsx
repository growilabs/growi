import React from 'react';

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
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    alert('コピーしました！');
  };

  return (
    <section className={title !== '' ? 'mt-4 mb-1' : 'mb-1'}>
      {title !== '' && <h3 className="h6 fw-bold mb-2">{title}</h3>}
      {/* flex-nowrap を追加して、全体が縦に並ばないように強制します */}
      <div className="d-flex flex-row align-items-center gap-3 py-1 flex-nowrap">
        {/* flex-shrink-0 を追加して、コード枠が右側のテキストに押しつぶされないようにします */}
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

        {/* whiteSpace: 'nowrap' を追加して、右側のプレビューが勝手に改行されるのを防ぎます */}
        <div className="flex-grow-1" style={{ whiteSpace: 'nowrap' }}>
          <div className="wiki-content small">
            {preview}
          </div>
        </div>
      </div>
    </section>
  );
};

const TEXT_STYLE_GUIDES = [
  {
    id: 'bold',
    title: '太字',
    code: 'これは **太字** です\nこれは __太字__ です',
    preview: <div className="lh-base">これは <strong>太字</strong> です<br />これは <strong>太字</strong> です</div>,
  },
  {
    id: 'italic',
    title: '斜体',
    code: 'これは *斜体* です\nこれは _斜体_ です',
    preview: <div className="lh-base">これは <em>斜体</em> です<br />これは <em>斜体</em> です</div>,
  },
  {
    id: 'strikethrough',
    title: '取り消し線',
    code: '~~取り消します~~',
    preview: <del>取り消します</del>,
  },
  {
    id: 'inline-code',
    title: 'インラインコード',
    code: '`インラインコード` \n~~~インラインコード~~~',
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
          インラインコード
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
          インラインコード
        </code>
      </div>
    ),
  },
  {
    id: 'bold-italic',
    title: '全体が太字か斜体',
    code: '***このテキストはすべて\n重要です***',
    preview: <strong><u>このテキストはすべて重要です</u></strong>,
  },
  {
    id: 'emoji',
    title: '絵文字',
    code: ':+1:\n:white_check_mark:\n:lock:',
    preview: <span style={{ fontSize: '1.2rem' }}>👍✅🔒</span>,
  },
  {
    id: 'sub',
    title: '下付き・上付き',
    code: 'これは<sub>下付き</sub>です',
    preview: <span>これは<sub>下付き</sub>テキストです</span>,
  },
  {
    id: 'sup',
    title: '',
    code: 'これは<sup>上付き</sup>です',
    preview: <span>これは<sup>上付き</sup>テキストです</span>,
  },
  {
    id: 'link-docs',
    title: 'ラベル付きリンク',
    code: '[GROWI ドキュメント](https://docs.growi.org/ja/g)',
    preview: (
      <a
        href="https://docs.growi.org/ja/g"
        target="_blank"
        rel="noreferrer"
        className="text-secondary text-decoration-underline"
        style={{ color: '#777570' }}
        onClick={e => e.stopPropagation()}
      >
        GROWI のリンク
        <ExternalLinkIcon />
      </a>
    ),
  },
  {
    id: 'link-sandbox',
    title: '',
    code: '[砂場ページはこちら](/Sandbox)',
    preview: (
      <a
        href="/Sandbox"
        className="text-secondary text-decoration-underline"
        style={{ color: '#777570' }}
        onClick={e => e.stopPropagation()}
      >
        砂場ページはこちら
        <ExternalLinkIcon />
      </a>
    ),
  },
];

export const TextStyleTab: React.FC = () => {
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
