# Roadmap

## Overview

GROWI の Markdown レンダリングを各サーフェスで改善し、いずれ統合する。
**近期**: bulk-export（PDF）のサーバ側レンダリングを Web レンダラのプラグイン知見の再利用で
リッチ化し、Web 表示との忠実度ギャップを現行 CJS サーバ環境のまま埋める。
**長期**（リポジトリ全体の ESM 化に依存）: bulk-export と Web のレンダリングを共有パイプラインに
収れんさせ、GROWI ローカルプラグインや完全パリティをどのサーフェスでも利用可能にする。

## Approach Decision

- **Chosen**: 段階化する。bulk-export のレンダリング改善を今出荷し、レンダラ収れんは ESM 化に
  ゲートされた将来 spec に分離する。
- **Why**: Web レンダラは安定しており「変更対象」ではなく「参照（理想形）」。変更価値とリスクは
  bulk-export に集中。両者のコード共有は現状 CJS/ESM の壁で不可（実測 `ERR_REQUIRE_ESM`）であり、
  今の統合 spec は時期尚早。
- **Rejected alternatives**:
  - renderer 全体を 1 spec に含める → 安定済み大規模サブシステムの characterization 化で保守負担大・
    変更価値小、かつ CJS/ESM で実コード共有も不可。
  - roadmap 化せず場当たり → 将来の収れん意図が失われる。

## Scope

- **In**: bulk-export サーバ側レンダリングのリッチ化（Phase 1）／将来の共有レンダリング
  パイプライン（Phase 2、ESM 化後）。
- **Out**: リポジトリ全体の ESM 化そのもの（停止中の別施策 `support/esm`）／pdf-converter 内部／
  GROWI テーマの完全再現。

## Constraints

- 現行 CJS サーバランタイムは ESM/SCSS/React のレンダラモジュールの静的 import を許さない
  （`dynamicImport` かビルド時バンドルが必須）。
- Phase 2 はリポジトリ全体の ESM 化（`support/esm`）完了に依存する。
- Turbopack の依存分類ルール（tech.md）。

## Boundary Strategy

- **Why this split**: Phase 1 は現行ランタイム内で閉じる出荷可能な増分。Phase 2 は ESM 化で初めて
  解錠される大きめのアーキ収れん。分割することで各 spec を独立にレビュー可能にし、安定コードの
  早すぎる spec 化を避ける。
- **Shared seams to watch**: Web レンダラ（`generateCommonOptions`）と bulk-export レンダラ間の
  プラグイン選定・順序の整合。Phase 1 ではドリフト検知テスト（Requirement 6）で担保し、Phase 2 で
  実コード共有へ昇格させる。

## Specs (dependency order)

- [~] bulk-export-pdf-rendering — bulk-export（PDF）のサーバ側 Markdown レンダリングを、再利用した npm ESM
  プラグイン集合＋`@growi/core-styles` でリッチ化。Dependencies: none。Status: requirements 生成済み（実装中）。
- [ ] renderer-convergence — Web と bulk-export のレンダリングを共有パイプラインに統合。GROWI ローカル
  プラグインのサーバ側再利用、必要に応じ pdf-converter 側へレンダリング移設。Dependencies: bulk-export-pdf-rendering,
  リポジトリ全体の ESM 化（`support/esm`）。Status: 将来・ブロック中（brief は ESM 化が近づいた時点で
  just-in-time 作成）。
