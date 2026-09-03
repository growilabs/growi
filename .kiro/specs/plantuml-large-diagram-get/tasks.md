# Implementation Plan

- [ ] 1. Foundation: 定数と i18n キー
- [ ] 1.1 (P) URL長判定の定数を新設（**2つ・役割が違う**）
  - `features/plantuml/consts.ts` に次の2定数（型 number）を定義する:
    - `PLANTUML_GET_URL_MAX_LENGTH` — **ブロック用**。極端に高い保険値（例 16,000〜32,000字級）。誤検知＝描画できる図が消えるので安全側に高く（Req 8.2）
    - `PLANTUML_GET_URL_LIKELY_OVERSIZE_LENGTH` — **文言選択用の目安値**。実測失敗点ベース（**暫定 約8,000字**。Tomcat 既定 `maxHttpHeaderSize`=8192）。**ブロックには絶対に使わない**（誤りのコストは「文言のニュアンスがずれる」だけ）
      - ⚠️ 根拠の実測値が spec 内で2つあり同じ指標か未確定（requirements.md「テーマ有り約8,014字→**400**」／design.md「フルURL **8,318**→6,882字」。前者は 414 でなく 400）。**タスク 2.2 の実測で `src.length` 基準の失敗点を1つに確定させてから最終値を決める**
  - ⚠️ 既定構成（公開plantuml.com）で実際に起きる失敗はほぼ onError 経路を通り、プリチェックはまず発火しない ── これは設計どおりの役割分担であることをコメントに残す
  - `features/plantuml` から import 可能で、単一の出所になっていること（目安値は別spec `plantuml-post-optin` の Req 11 からも参照される）を確認する
  - _Requirements: 6.2, 7.1, 8.1, 8.2_
  - _Boundary: consts_

- [ ] 1.2 (P) エラーメッセージの i18n キーを5ロケール追加（**2種**）
  - `apps/app/public/static/locales/{en_US,ja_JP,fr_FR,ko_KR,zh_CN}/translation.json` に2キーを追加:
    - `oversize-precheck`: プリチェック超過用「URL長上限により表示できない可能性が高い」＋「図の分割・簡略化」（Req 7.1）
    - `render-failed-generic`: onError用のヘッジ文言「表示できない（URL長上限の可能性・構文エラー・サーバ未到達 のいずれか）」＋「図の分割・簡略化」（Req 7.1-b）
  - いずれも POST/自前サーバには触れない。5ロケール全てに同一キーが存在し `t()` で引けることを確認する
  - _Requirements: 7.1, 7.2, 7.5_
  - _Boundary: locales_

- [ ] 2. Core: テーマ軽量化
- [ ] 2.1 テーマをミニファイ（主レバー・着色は削除しない）
  - `carbon-gray-{common,light,dark}.puml.ts` の style 文字列から、**行頭 `'`／`''` の PlantUML コメント行・行頭空白・空行を除去**する（`!$VAR = '...'` のように `'` が行頭でない行は文字列リテラルなので残す）
  - ⚠️ 着色・skinparam・`<style>` 定義は**一切削除しない**（全図種の見た目＝ダーク配色を維持。#1 退行なし）。`sequenceDiagram`／`timingDiagram` も当然残る
  - ⚠️ **WHYコメントは「削除」ではなく「退避」**: 実装上の理由を記録したコメント ── 特に `ParticipantPadding`/`Padding` の注記（現行 `:45-49`。skinparam で宣言すると全図に "Please use CSS style instead of skinparam" 警告が焼き込まれる #11258 ／ 汎用 `Padding` は動作するCSS等価物が無い plantuml/plantuml#2622）と `sequenceDiagram` の `Padding`/`Margin` 注記（`:448-449`）── は、消す前に**ファイル先頭（テンプレートリテラル外）の TSDoc に「テーマ不変条件」節としてまとめて移す**。ソース上のWHYを保全しつつ、エンコード後ペイロードには載せない
  - 判定基準: 「なぜこう書くか／なぜ書かないか」を説明するコメントは退避、「何をしているか」の反復（`' Colors` 等）は単に削除
  - ミニファイ後、コメント/空行が消え・着色定義（例 `mindmapDiagram` 等の非UML `<style>` も含む）が残存し・ソース長が縮小していること、および**退避したWHYが TSDoc に存在すること**を確認する
  - _Requirements: 1.1, 2.1, 2.2, 3.1, 4.1_
  - _Boundary: theme assets_

- [ ] 2.2 軽量化効果を実測（Req 5 の唯一の所有）
  - **前提依存**: `plantuml-encoder` は `@akebifiky/remark-simple-plantuml` の**推移依存にのみ存在し apps/app から直接 import 不可**。実測スクリプト/テストで直接 import するため、`apps/app/package.json` の `devDependencies` に `plantuml-encoder` を追加し（測定専用でランタイム不使用）、ルートで `pnpm install` する
  - 軽量化前後で、基準図（今回の問い合わせ図）の**エンコード後URL長**を `plantuml-encoder` で測るスクリプト/テストを用意する
  - 前後のURL長が出力され、**基準図が目標（主要サーバ上限内）に収まるか**の判定が得られる（公開plantuml.com既定でも有効かの根拠）。⚠️ deflate はコメント/空白を既に圧縮するため、ミニファイの encoded 削減効果は実測でのみ確定する（設計の想定値を鵜呑みにしない）
  - **あわせて `PLANTUML_GET_URL_LIKELY_OVERSIZE_LENGTH`（1.1）の最終値を確定**する: spec 内に併記された 8,014（→400）と 8,318（フルURL）が同じ指標かが未確定なため、**`PlantUmlViewer` が実際に見る `src.length`（＝フルURL長）を基準に失敗点を1つ測り直す**。Cookie 等のヘッダが `maxHttpHeaderSize` 8192 を食う分、自前サーバでは失敗点が下振れする点も記録する
  - _Requirements: 1.2, 1.3, 5.1_
  - _Depends: 2.1_

- [ ] 2.3 (副次・任意) 追加削減が必要な場合のみ検討
  - 2.2 の実測でミニファイだけでは基準図が上限内に収まらない場合に限り、(a) 未参照パレット階調の整理、(b) 非UML系 `<style>` 削除（board/gantt/json/mindmap/salt/wbs/wire/yaml）を検討する
  - ⚠️ (b) は当該図種のダーク配色を失う（`<style>` が唯一の着色手段）。採用時は「ダーク既定色フォールバック」等の緩和とセットにし、目視回帰で劣化許容範囲を明示的に確認する
  - `$VAR` 参照を grep し**未定義変数参照ゼロ（PlantUMLエラーなし）**であることを確認する
  - _Requirements: 1.1, 2.1, 2.2_
  - _Boundary: theme assets_
  - _Depends: 2.1, 2.2_

- [ ] 3. Core: PlantUmlViewer 拡張
- [ ] 3.1 (P) 失敗検知・プリチェック・status遷移
  - `onError` を `handleLoaded` から分離し、エラー状態（`useState`）を追加。`src.length > PLANTUML_GET_URL_MAX_LENGTH` のプリチェックで画像を出さずエラー状態へ
  - ⚠️ **プリチェックは `src != null && src.length > 閾値` の形で書く**: 別spec `plantuml-post-optin` がPOSTモード導入時に `PlantUmlViewerProps.src` を `src?: string` へ緩める（POSTでは URL を組み立てないため `src` を渡さない）。ガード無しだと POSTモードで `undefined.length` により実行時エラーになる。この形にしておけば後続の型緩和を無改修で受けられる
  - **成功/失敗/超過の3分岐いずれも** `GROWI_IS_CONTENT_RENDERING_ATTR` を `'false'` に遷移させる（auto-scroll非退行）。各Viewerは独立に動作
  - 超過src・onError でエラー状態、正常で `<img>`、いずれも status='false' になることを確認する
  - _Requirements: 4.1, 6.1, 6.2, 7.4, 8.1, 8.2_
  - _Boundary: PlantUmlViewer_
  - _Depends: 1.1_

- [ ] 3.2 エラーUIとconsole警告（検知経路で文言分岐）
  - エラー状態時に、画像の代わりに `useTranslation` の `t()` でメッセージ＋対処を描画。**プリチェック超過なら `oversize-precheck`（断定寄り）、onError なら `render-failed-generic`（ヘッジ）**を選ぶ。onError 経路では `src.length >= PLANTUML_GET_URL_LIKELY_OVERSIZE_LENGTH` かどうかで文言のニュアンス（「URL長上限の可能性が高い」寄り／「他の原因の可能性」寄り）を選んでよいが、**ブロック判定には使わない**。`loggerFactory('growi:features:plantuml:PlantUmlViewer')` で原因候補を `warn` 出力
  - プリチェック超過時とonError時で正しいキーが表示され、console に警告が出ることを確認する
  - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - _Boundary: PlantUmlViewer_
  - _Depends: 1.2, 3.1_

- [ ] 4. Validation
- [ ] 4.1 (P) テーマの回帰テスト（plantuml.spec.ts）
  - 軽量化後テーマが**ミニファイされている**（行頭 `'` コメント行・空行が消えている）かつ**着色定義は残存**（例: `mindmapDiagram` 等の非UML `<style>` も**残っている**／`sequenceDiagram`・`timingDiagram` も残存）、テーマ前置後の**ソース長が縮小**していること（light/dark で `it.each`）
  - **`skinparam ParticipantPadding` / `skinparam Padding` がテーマ文字列に復活していない**ことを回帰として固定する（復活＝全図に警告が焼き込まれる #11258 の再発）。※退避したWHYコメント自体は「文字列に無いことが正」なのでテストで検索しない（TSDoc への退避はレビューで確認）
  - ※副次レバー（非UML削除）を採用した場合のみ、当該ブロック消失の検証を追加する
  - 上記テストが緑であることを確認する
  - _Requirements: 1.1, 2.1, 3.1, 4.1_
  - _Depends: 2.1_

- [ ] 4.2 (P) Viewerの回帰テスト（PlantUmlViewer.spec.tsx）
  - 正常 `load`→`<img>`／`error`→エラーUI／閾値超過→エラーUI／全分岐 status='false'／i18n（`useTranslation` モック）／`logger.warn` を検証
  - **図単位の独立**: 同一ページに複数Viewerを描画し、1つがエラーでも**他のViewerの描画が妨げられない**ことを検証（7.4）
  - 上記テストが緑であることを確認する
  - _Requirements: 4.1, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2_
  - _Depends: 3.2_

- [ ] 4.3 目視回帰（ライト/ダーク）
  - 既定（公開plantuml.com）構成で、主要図種（class/sequence/activity/component/state/note）が**ライト/ダーク両方で崩れない**ことを確認。ミニファイ主体なら**非UML図種（gantt/mindmap/json 等）もダークで判読可能なまま**であることも確認し、結果を**チェックリスト/スクリーンショット**として残す
  - _Requirements: 2.1, 2.2_
  - _Depends: 2.1_

> ⚠️ Changeset は作成しない。`@growi/app` は `.changeset/config.json` の `ignore` 対象かつ private のため、changeset を追加すると何も bump せず changesets/action を "create release PR" に張り付かせ publish パスに到達しなくなる（commit `1d0a0d9f7a` 参照）。app のリリースノートは release-drafter が担う。
