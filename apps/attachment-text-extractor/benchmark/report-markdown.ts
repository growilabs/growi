import type { BenchmarkReport, EsReport } from './benchmark-run';
import { ANALYZE_SAMPLE_TEXT } from './elasticsearch';
import type { DocumentScore, FormatSummary } from './scoring';

// The report as Markdown tables, in the shape research.md takes them.
// The metrics are defined in research.md 12.

const cell = (value: string): string =>
  value.replaceAll('|', '\\|').replaceAll('\n', ' ');

const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string =>
  [header, header.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');

const ratio = (part: number, whole: number): string =>
  whole === 0
    ? `${part}/${whole}`
    : `${part}/${whole} (${((part / whole) * 100).toFixed(1)}%)`;

const formatName = (summary: FormatSummary): string =>
  summary.format === 'all' ? '全体' : summary.format;

const recallTable = (rows: readonly FormatSummary[]): string =>
  table(
    [
      '形式',
      '文書',
      '失敗',
      '語句',
      '再現率 (そのまま)',
      '再現率 (空白を除く)',
    ],
    rows.map((s) => [
      formatName(s),
      String(s.documents),
      String(s.failed),
      String(s.phrases),
      ratio(s.exact, s.phrases),
      ratio(s.found, s.phrases),
    ]),
  );

const positionTable = (rows: readonly FormatSummary[]): string =>
  table(
    [
      '形式',
      '要素の数が正しい文書',
      '番号とラベルが正しい要素',
      'シート名がある要素',
      '正しい位置にある語句',
      '別の位置にだけある語句',
      '正しい位置と別の位置の両方にある語句',
    ],
    rows.map((s) => [
      formatName(s),
      ratio(s.pageCountCorrect, s.documents),
      ratio(s.pageElementsCorrect, s.pageElements),
      s.sheetNames == null
        ? '—'
        : ratio(s.sheetNames.correct, s.sheetNames.total),
      ratio(s.atExpectedPosition, s.phrases),
      String(s.foundOnlyElsewhere),
      String(s.alsoFoundElsewhere),
    ]),
  );

const characterTable = (rows: readonly FormatSummary[]): string =>
  table(
    [
      '形式',
      'U+FFFD',
      '元の文に無い文字',
      '分断 (改行の位置)',
      '分断 (それ以外)',
      '正しい位置での分断 (改行の位置)',
      '正しい位置での分断 (それ以外)',
      '出てはいけない語句の混入',
    ],
    rows.map((s) => [
      formatName(s),
      String(s.replacementCharacters),
      s.unexpectedCharacters == null ? '—' : String(s.unexpectedCharacters),
      String(s.splitAtLineBreak),
      String(s.splitElsewhere),
      String(s.splitAtLineBreakAtPosition),
      String(s.splitElsewhereAtPosition),
      `${s.absentPhrasesLeaked}/${s.absentPhrases}`,
    ]),
  );

const elasticsearchSection = (es: EsReport): string => {
  if (es.status === 'skipped') {
    return `測らなかった: ${es.reason}。この実行は (a)〜(c) だけで判定する。`;
  }
  const plugins = `analysis-kuromoji あり、analysis-icu ${es.plugins.icu ? 'あり' : 'なし (icu_normalizer を外した)'}`;
  return [
    `- ${es.url} (${plugins})、一時 index \`${es.indexName}\` (終了時に削除)`,
    `- kuromoji の試し (\`${ANALYZE_SAMPLE_TEXT}\`): ${es.analyzeSample.join(' / ')}`,
    '',
    table(
      [
        '形式',
        'クエリ',
        '語句',
        '文書が見つかった',
        '正しい位置で見つかった',
        '正解以外の位置に当たった',
      ],
      es.recall.map((r) => [
        r.format === 'all' ? '全体' : r.format,
        r.variant,
        String(r.phrases),
        ratio(r.documentFound, r.phrases),
        ratio(r.positionFound, r.phrases),
        String(r.extraElementHits),
      ]),
    ),
    '',
    es.positionProblems.length === 0
      ? '正しい位置だけで見つかったのではない語句: なし'
      : table(
          ['ファイル', 'クエリ', '語句', '期待の位置', '見つかった位置'],
          es.positionProblems.map((problem) => [
            problem.fileName,
            problem.variant,
            problem.text,
            String(problem.page),
            problem.elementIndexes.length === 0
              ? 'なし'
              : problem.elementIndexes.join(', '),
          ]),
        ),
  ].join('\n');
};

const phraseNotes = (score: DocumentScore): string =>
  [
    ...score.phrases
      .filter(
        (p) => p.matchAtExpectedPosition !== 'exact' || p.foundOnOtherElements,
      )
      .map(
        (p) =>
          `${p.text} (正しい位置: ${p.matchAtExpectedPosition}, 全体: ${p.match}, 位置 ${p.page}→[${p.foundOnPages.join(',')}])`,
      ),
    ...score.absentPhrases.leaked.map((text) => `${text} (混入)`),
    ...(score.characters.unexpectedSample.length === 0
      ? []
      : [`元の文に無い文字: ${score.characters.unexpectedSample.join('')}`]),
  ].join('; ');

const documentTable = (documents: readonly DocumentScore[]): string =>
  table(
    [
      'ファイル',
      '結果',
      '再現率 (そのまま / 空白を除く)',
      '要素の数 (期待 / 実際)',
      'U+FFFD',
      '元の文に無い文字',
      '見つからない・分断・位置ずれの語句など',
    ],
    documents.map((score) => {
      const exact = score.phrases.filter((p) => p.match === 'exact').length;
      const found = score.phrases.filter((p) => p.match !== 'missing').length;
      return [
        score.fileName,
        score.failure == null ? 'ok' : `失敗: ${score.failure}`,
        `${exact} / ${found} / ${score.phrases.length}`,
        `${score.pages.expected} / ${score.pages.actual ?? '—'}`,
        String(score.characters.replacementCharacters),
        score.characters.unexpectedCharacters == null
          ? '—'
          : String(score.characters.unexpectedCharacters),
        phraseNotes(score),
      ];
    }),
  );

export const renderMarkdownReport = (report: BenchmarkReport): string => {
  const rows = [...report.formats, report.total];
  const pdfs = report.corpus.filter((file) => file.format === 'pdf');
  return [
    `## ベンチマークの結果: ${report.label}`,
    '',
    `- 実行: ${report.startedAt} 〜 ${report.finishedAt}`,
    `- サービス: ${report.service}`,
    `- 文書: ${report.total.documents} 個 (失敗 ${report.total.failed} 個)、語句: ${report.total.phrases} 個`,
    '',
    '### (a) 語句の再現率',
    '',
    recallTable(rows),
    '',
    '### (b) 位置の正しさ',
    '',
    positionTable(rows),
    '',
    '### (c) 文字化けと語の分断',
    '',
    characterTable(rows),
    '',
    '### (d) Elasticsearch での検索',
    '',
    elasticsearchSection(report.elasticsearch),
    '',
    '### 文書ごと',
    '',
    documentTable(report.documents),
    '',
    '### コーパスの PDF の SHA-256',
    '',
    table(
      ['ファイル', 'SHA-256'],
      pdfs.map((file) => [file.fileName, file.sha256]),
    ),
    '',
  ].join('\n');
};
