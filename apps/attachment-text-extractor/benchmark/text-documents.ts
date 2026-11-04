import { encodeText } from '../test/fixtures';
import type {
  BenchmarkEncoding,
  BenchmarkFeature,
  BenchmarkFormat,
} from './answers';
import {
  type GeneratedDocument,
  MIME_TYPES,
  SINGLE_PAGE,
} from './corpus-document';

// Plain text, CSV and HTML documents in the encodings of Req 2.4. Shift_JIS,
// cp932, EUC-JP and ISO-2022-JP text avoids 〜 and ～ (research.md 9.10).

interface TextDocumentSpec {
  readonly fileName: string;
  readonly format: Extract<BenchmarkFormat, 'txt' | 'csv' | 'html'>;
  readonly encoding: BenchmarkEncoding;
  readonly lines: readonly string[];
  /** Windows files end lines with CRLF. */
  readonly crlf?: boolean;
  readonly features?: readonly BenchmarkFeature[];
  readonly phrases: readonly string[];
  readonly absentPhrases?: readonly string[];
}

const encode = (text: string, encoding: BenchmarkEncoding): Buffer =>
  encoding === 'utf-8' ? Buffer.from(text, 'utf8') : encodeText(text, encoding);

const textDocument = (spec: TextDocumentSpec): GeneratedDocument => {
  const newline = spec.crlf ? '\r\n' : '\n';
  const text = spec.lines.join(newline) + newline;
  return {
    answer: {
      fileName: spec.fileName,
      format: spec.format,
      mimeType: MIME_TYPES[spec.format],
      source: `benchmark/text-documents.ts: the text encoded with ${spec.encoding === 'utf-8' ? 'Buffer.from' : 'encodeText (test/fixtures/text-encoding.ts)'}`,
      encoding: spec.encoding,
      features: spec.features ?? [],
      expectedPages: SINGLE_PAGE,
      phrases: spec.phrases.map((phrase) => ({ text: phrase, page: 1 })),
      ...(spec.absentPhrases == null
        ? {}
        : { absentPhrases: spec.absentPhrases }),
    },
    build: () => encode(text, spec.encoding),
  };
};

export const TEXT_DOCUMENTS: readonly GeneratedDocument[] = [
  textDocument({
    fileName: 'txt-shift-jis.txt',
    format: 'txt',
    encoding: 'shift_jis',
    crlf: true,
    lines: [
      '議事録　第3回 経営企画会議',
      '日時：令和7年4月10日（木）14時から16時',
      '出席者：山田太郎、佐藤花子、田中一郎',
      '議題：新製品「ソラリス」の販売戦略について',
      '決定事項：東京本社と大阪支店で先行販売を実施する。',
      '次回までの宿題：販売促進キャンペーンの予算案を作成する。',
    ],
    phrases: [
      '経営企画会議',
      '山田太郎',
      'ソラリス',
      '販売戦略',
      '大阪支店',
      '先行販売',
      '販売促進キャンペーン',
    ],
  }),
  textDocument({
    fileName: 'txt-euc-jp.txt',
    format: 'txt',
    encoding: 'euc-jp',
    lines: [
      '障害報告書',
      '発生日時：2025年3月5日 14時20分',
      '影響範囲：社内ポータルサイトとファイルサーバー',
      '原因：データベースの接続数が上限に達したため、応答が停止した。',
      '暫定対応：アプリケーションサーバーを再起動した。',
      '再発防止策：接続プールの設定を見直し、監視項目を追加する。',
    ],
    phrases: [
      '障害報告書',
      '社内ポータルサイト',
      'ファイルサーバー',
      'データベース',
      'アプリケーションサーバー',
      '接続プール',
      '再発防止策',
    ],
  }),
  textDocument({
    fileName: 'txt-iso-2022-jp.txt',
    format: 'txt',
    encoding: 'iso-2022-jp',
    lines: [
      '件名：年末年始休業のお知らせ',
      '関係者各位',
      '誠に勝手ながら、12月28日から1月4日まで休業いたします。',
      '休業期間中の緊急連絡先は、情報システム部の鈴木までお願いします。',
      '営業開始は1月5日（月）です。',
    ],
    phrases: [
      '年末年始休業',
      '関係者各位',
      '緊急連絡先',
      '情報システム部',
      '営業開始',
    ],
  }),
  textDocument({
    fileName: 'txt-utf-8-bom.txt',
    format: 'txt',
    encoding: 'utf-8-bom',
    lines: [
      '新入社員研修のしおり',
      '研修期間：4月1日〜4月14日',
      '勤務時間：9時〜18時',
      '持ち物：ノートパソコン、筆記用具、社員証',
      '講師：人事部 小林由美子',
    ],
    phrases: [
      '新入社員研修',
      '研修期間',
      '9時〜18時',
      'ノートパソコン',
      '社員証',
      '小林由美子',
    ],
  }),
  textDocument({
    fileName: 'txt-utf-16le-bom.txt',
    format: 'txt',
    encoding: 'utf-16le-bom',
    lines: [
      '品質管理マニュアル 第2版',
      '1. 受入検査',
      '購買品は受入時に抜き取り検査を実施する。',
      '2. 不適合品の処置',
      '不良品は直ちに隔離し、品質保証課へ報告すること。',
    ],
    phrases: [
      '品質管理マニュアル',
      '受入検査',
      '抜き取り検査',
      '不適合品',
      '品質保証課',
    ],
  }),
  textDocument({
    fileName: 'txt-utf-16be-bom.txt',
    format: 'txt',
    encoding: 'utf-16be-bom',
    lines: [
      'プロジェクト計画書',
      'プロジェクト名：基幹システム刷新',
      'マイルストーン：要件定義、基本設計、結合テスト、本番移行',
      '責任者：高橋一郎（プロジェクトマネージャー）',
    ],
    phrases: [
      'プロジェクト計画書',
      '基幹システム刷新',
      '結合テスト',
      '本番移行',
      '高橋一郎',
      'プロジェクトマネージャー',
    ],
  }),
  textDocument({
    fileName: 'txt-utf-8.txt',
    format: 'txt',
    encoding: 'utf-8',
    lines: [
      'GROWI 運用手順書',
      '毎日午前3時にバックアップを取得する。',
      '全文検索には Elasticsearch を使用する。',
      '障害時はオンコール担当者へ Slack で連絡する。',
    ],
    phrases: [
      '運用手順書',
      'バックアップ',
      '全文検索',
      'Elasticsearch',
      'オンコール担当者',
    ],
  }),
  textDocument({
    fileName: 'csv-utf-8.csv',
    format: 'csv',
    encoding: 'utf-8',
    lines: [
      '社員番号,氏名,所属部署,内線番号',
      '1001,渡辺美咲,経理部,2301',
      '1002,伊藤健二,人事部,2302',
      '1003,松本さくら,営業企画部,2303',
    ],
    phrases: [
      '社員番号',
      '所属部署',
      '渡辺美咲',
      '経理部',
      '松本さくら',
      '営業企画部',
    ],
  }),
  textDocument({
    fileName: 'csv-cp932.csv',
    format: 'csv',
    encoding: 'cp932',
    crlf: true,
    lines: [
      '商品コード,商品名,仕入先,在庫数',
      'A-001,ボールペン（黒）,㈱文具センター,120',
      'A-002,クリアファイル,髙田商店,85',
      'B-010,コピー用紙 A4,東都紙業,40',
    ],
    phrases: [
      '商品コード',
      'ボールペン',
      '㈱文具センター',
      'クリアファイル',
      '髙田商店',
      '東都紙業',
    ],
  }),
  textDocument({
    fileName: 'html-shift-jis-script-style.html',
    format: 'html',
    encoding: 'shift_jis',
    features: ['meta-charset', 'script-style'],
    lines: [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      '<meta charset="Shift_JIS">',
      '<title>価格改定のお知らせ</title>',
      '<style>',
      '/* スタイル定義：見出しの装飾 */',
      'h1 { color: #333; }',
      '</style>',
      '<script>',
      'var message = "スクリプト内部の文字列";',
      '</script>',
      '</head>',
      '<body>',
      '<h1>価格改定のお知らせ</h1>',
      '<p>お客様各位</p>',
      '<p>2025年7月1日より、標準プランの月額料金を改定いたします。</p>',
      '<p>詳細は営業担当者までお問い合わせください。</p>',
      '</body>',
      '</html>',
    ],
    phrases: ['価格改定', 'お客様各位', '標準プラン', '月額料金', '営業担当者'],
    absentPhrases: ['スタイル定義', 'スクリプト内部の文字列'],
  }),
  textDocument({
    fileName: 'html-euc-jp-http-equiv.html',
    format: 'html',
    encoding: 'euc-jp',
    features: ['meta-charset'],
    lines: [
      '<html>',
      '<head>',
      '<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">',
      '<title>社内イベントのご案内</title>',
      '</head>',
      '<body>',
      '<h2>秋季運動会のご案内</h2>',
      '<table>',
      '<tr><th>日程</th><td>10月18日（土）</td></tr>',
      '<tr><th>会場</th><td>多摩川河川敷グラウンド</td></tr>',
      '<tr><th>申込方法</th><td>総務部へメールで申し込む</td></tr>',
      '</table>',
      '</body>',
      '</html>',
    ],
    phrases: ['秋季運動会', '多摩川河川敷グラウンド', '申込方法', '総務部'],
  }),
];
