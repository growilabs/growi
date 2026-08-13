# Implementation Plan

- [ ] 1. Foundation: 定数と i18n キー
- [ ] 1.1 (P) URL長判定の閾値定数を新設
  - `features/plantuml/consts.ts` に `PLANTUML_GET_URL_MAX_LENGTH`（型 number、**極端に高い保険値**）を定義する
  - `features/plantuml` から import 可能で、単一の出所になっていることを確認する
  - _Requirements: 6.2, 8.1, 8.2_
  - _Boundary: consts_

- [ ] 1.2 (P) 上限超過エラーメッセージの i18n キーを5ロケール追加
  - `apps/app/public/static/locales/{en_US,ja_JP,fr_FR,ko_KR,zh_CN}/translation.json` に**汎用文言**のキーを追加（「URL長上限のため表示できない可能性」＋「図の分割・簡略化」。POST/自前サーバには触れない）
  - 5ロケール全てに同一キーが存在し `t()` で引けることを確認する
  - _Requirements: 7.1, 7.2, 7.5_
  - _Boundary: locales_

- [ ] 2. Core: テーマ軽量化
- [ ] 2.1 非UML図の `<style>` 定義を削除
  - `carbon-gray-common.puml.ts` の `<style>` 内、**真の非UML系のみ削除**（board/gantt/json/mindmap/salt/wbs/wire/yaml）
  - ⚠️ `sequenceDiagram`(:452-458) と `timingDiagram`(:608-627) は**残す**（UML図。sequence は ParticipantPadding 代替で退行防止）
  - 削除後、当該非UMLブロック文字列が消え、sequence/timing が残存していることを確認する
  - _Requirements: 1.1, 3.1, 4.1_
  - _Boundary: theme assets_

- [ ] 2.2 未参照パレット・重複定義の整理
  - `common/light/dark` の重複 `$primary_scheme()` sub-block を整理し、**style削除後に `$VAR` 参照を grep して未参照のパレット階調のみ削除**する
  - ダーク配色に効く変数は残す。削除後に**未定義変数参照ゼロ（PlantUMLエラーなし）**であることを確認する
  - _Requirements: 1.1, 2.1, 2.2_
  - _Boundary: theme assets_
  - _Depends: 2.1_

- [ ] 2.3 軽量化効果を実測（Req 5 の唯一の所有）
  - 軽量化前後で、基準図（今回の問い合わせ図）の**エンコード後URL長**を `plantuml-encoder` で測るスクリプト/テストを用意する
  - 前後のURL長が出力され、**基準図が目標（主要サーバ上限内）に収まるか**の判定が得られる（公開plantuml.com既定でも有効かの根拠）
  - _Requirements: 1.2, 1.3, 5.1_
  - _Depends: 2.1, 2.2_

- [ ] 3. Core: PlantUmlViewer 拡張
- [ ] 3.1 (P) 失敗検知・プリチェック・status遷移
  - `onError` を `handleLoaded` から分離し、エラー状態（`useState`）を追加。`src.length > PLANTUML_GET_URL_MAX_LENGTH` のプリチェックで画像を出さずエラー状態へ
  - **成功/失敗/超過の3分岐いずれも** `GROWI_IS_CONTENT_RENDERING_ATTR` を `'false'` に遷移させる（auto-scroll非退行）。各Viewerは独立に動作
  - 超過src・onError でエラー状態、正常で `<img>`、いずれも status='false' になることを確認する
  - _Requirements: 4.1, 6.1, 6.2, 7.4, 8.1, 8.2_
  - _Boundary: PlantUmlViewer_
  - _Depends: 1.1_

- [ ] 3.2 エラーUIとconsole警告
  - エラー状態時に、画像の代わりに `useTranslation` の `t()` で**汎用メッセージ＋対処**を描画。`loggerFactory('growi:features:plantuml:PlantUmlViewer')` で原因を `warn` 出力
  - エラー時に i18n メッセージが表示され、console に警告が出ることを確認する
  - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - _Boundary: PlantUmlViewer_
  - _Depends: 1.2, 3.1_

- [ ] 4. Validation
- [ ] 4.1 (P) テーマの回帰テスト（plantuml.spec.ts）
  - 軽量化後テーマが**削除ブロックを含まない**（例: `mindmapDiagram` 等が消えている）かつ **sequence/timing は残存**、テーマ前置後の**ソース長が縮小**していること（light/dark で `it.each`）
  - 上記テストが緑であることを確認する
  - _Requirements: 1.1, 2.1, 3.1, 4.1_
  - _Depends: 2.2_

- [ ] 4.2 (P) Viewerの回帰テスト（PlantUmlViewer.spec.tsx）
  - 正常 `load`→`<img>`／`error`→エラーUI／閾値超過→エラーUI／全分岐 status='false'／i18n（`useTranslation` モック）／`logger.warn` を検証
  - **図単位の独立**: 同一ページに複数Viewerを描画し、1つがエラーでも**他のViewerの描画が妨げられない**ことを検証（7.4）
  - 上記テストが緑であることを確認する
  - _Requirements: 4.1, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2_
  - _Depends: 3.2_

- [ ] 4.3 目視回帰（ライト/ダーク）
  - 既定（公開plantuml.com）構成で、主要図種（class/sequence/activity/component/state/note）が**ライト/ダーク両方で崩れない**ことを確認し、結果を**チェックリスト/スクリーンショット**として残す
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.2_

- [ ] 4.4 Changeset 追加
  - GROWI本体の変更として `npx changeset` で変更内容（テーマ軽量化＋GET失敗時エラー表示）を記述する
  - `.changeset/*.md` が生成されていることを確認する
  - _Requirements: 1.1_
  - _Depends: 2.2, 3.2_
