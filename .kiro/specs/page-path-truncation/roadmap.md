# Roadmap: page-path-truncation → page-path-truncation-navigation

> このドキュメントは「ページパスの中間省略表示」というテーマ全体の段階計画を記述する。`page-path-truncation`
> spec のディレクトリに置いているのは、このテーマの現行フェーズがここだからであり、以後もアクティブな
> フェーズの spec ディレクトリに追随させる想定である。

## Overview

GROWI 内の複数の画面(検索モーダル・全文検索結果一覧・将来的にはパンくず/サイドバー)が、同じ「Notion 風
の中間省略(先頭セグメント＋…＋親セグメント＋ページ名)」というページパス表示規則を必要としている。判断
ロジック(`formatTruncatedPagePath`、および本フェーズで追加する `LinkedPagePath` 橋渡し関数
`buildAncestorPathNodes`)は `client/util/` に一本化して全フェーズから再利用する一方、各画面固有の描画
(リンクの有無・ハイライトの有無・CSS 制約)は画面ごとに個別の spec として段階的に実装する。

**Phase 0(完了)**: 検索モーダル(`search-modal-path-truncation`、issue #141445)。プレーン表示(リンク
なし・ハイライトなし)。

**Phase 1(進行中、本 spec)**: 全文検索結果一覧(`page-path-truncation`、issue #188233, #188237)。生存セ
グメントのリンク・検索ハイライトを維持する必要があり、Phase 0 より要件が広い。

**Phase 2(将来・未着手)**: `PagePathNav`・`PagePathHeader`・`PagePathNavSticky` などのパンくず表示、お
よび `RecentChangesSubstance`(サイドバー最近更新一覧)。ハイライトは不要だが、リンク維持は必要。

## Approach Decision

- **Chosen**: 「判断ロジックは共有、画面ごとの描画・spec は分離」。1 画面 = 1 spec とし、`client/util/`
  に置く純粋関数群を通じてロジックだけを横断的に共有する。
- **Why**:
  - 各画面は表現したいものが異なる(モーダルはプレーン、検索結果一覧はリンク+ハイライト、パンくずはリン
    クのみで SSR 前提など)。1 つの design.md にまとめると、コンポーネントごとに異なる contract が混在し、
    テンプレートが警告する「design.md が肥大化する」状態になりやすい。
  - 複数画面を 1 spec に詰め込むと、ある画面の要件確定が他画面の実装着手をブロックしてしまう。画面ごと
    に分ければ、承認・実装・レビューを独立に進められる。
  - 一方でロジックの重複は避けたい。`formatTruncatedPagePath` は Phase 0 で実装され Phase 1 が移設・再
    利用しており、`buildAncestorPathNodes`(truncation 判定 ⇔ `LinkedPagePath` の橋渡し)も Phase 1 で
    `client/util/` に配置し、Phase 2 が再利用できるようにする(design.md 参照)。
- **Rejected alternatives**:
  - 全画面をまとめた単一 spec — 責任境界が画面ごとに異なるため、design-review-gate の「複数の独立した
    責任境界が見えたら分割せよ」という原則に反する。却下。
  - 画面ごとに完全に独立した実装(ロジックも都度再実装)— 同じ中間省略アルゴリズムを画面ごとに再発明する
    ことになり、アルゴリズムの仕様が画面間でずれるリスクが高い。却下。

## Boundary Strategy

- **Why this split**: 「判断ロジック」と「描画」を分離できることが、画面ごとに spec を分けても重複が生
  まれない前提になっている。判断ロジックが画面固有の関心事(リンク、ハイライト等)を持たない純粋関数であ
  り続ける限り、この分割は維持できる。
- **Shared seams to watch**:
  - `client/util/format-truncated-page-path.ts` の戻り値の形(`TruncatedPagePath.parts`)— 変更する場
    合は全フェーズの消費者を確認する。
  - `client/util/build-ancestor-path-nodes.ts`(Phase 1 で新設)の `AncestorPathNode` / `AncestorPathPlan`
    契約 — Phase 2 が同じ関数をそのまま呼べるか、それとも拡張が要るかは Phase 2 の requirements 確定時
    に確認する。
  - `DevidedPagePath` の `evalDatePath` をどのフェーズがオプトインするか(Phase 0 は常時有効、Phase 1 は
    オプトイン prop 経由、Phase 2 は未定)。

## Specs (dependency order)

- [x] **search-modal-path-truncation**(issue #141445)— 検索モーダルのクイック検索結果。Notion 風中間
  省略、プレーン表示(リンクなし・ハイライトなし)。Dependencies: none. Status: 実装完了・マージ済み(PR
  #11467)。
- [~] **page-path-truncation**(issues #188233, #188237, this spec)— `/_search` 全文検索結果一覧。同じ
  truncation アルゴリズム + 生存セグメントのリンク維持 + Elasticsearch ハイライト維持 + ホバーツールチッ
  プ。Dependencies: search-modal-path-truncation(`formatTruncatedPagePath` を移設・再利用)。Status:
  design 生成済み、`/kiro-validate-design` 待ち。
- [ ] **page-path-truncation-navigation**(仮称、issue 未採番)— `PagePathNav`・`PagePathHeader`・
  `PagePathNavSticky` のパンくず表示、および `RecentChangesSubstance`(サイドバー最近更新一覧、同じ境界
  に入るかは brief 作成時に判断)。リンク維持は必要、ハイライトは不要。Dependencies: page-path-truncation
  (`buildAncestorPathNodes` を `client/util/` から再利用)。Status: 将来・未着手。brief は本フェーズ完了
  後、着手直前に作成する(just-in-time)。
