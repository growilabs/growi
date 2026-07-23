# Research & Design Decisions

---
**Purpose**: Discovery findings and architectural rationale for the news-feed-images feature.

---

## Summary

- **Feature**: `news-feed-images`
- **Discovery Scope**: Extension(既存 news 基盤への additive 追加)
- **Key Findings**:
  - 取込パイプラインは `feed-parser.ts`(zod, per-item fail-soft)→ `news-cron-service.ts`(`FEED_URL` ハードコード定数)→ `NewsItem.bulkWrite` で確立済み。画像は各段への additive 変更のみで通せる
  - `listForUser` は projection なしの `NewsItem.find().lean()` を返すため、モデルに `image` を足せば **API 層のコード変更ゼロ**でレスポンスに含まれる
  - 旧アプリの zod パーサは未知フィールドを黙って捨てる → フィード側が先に v1.1 を配信しても旧アプリは無害(前方・後方互換が構造的に成立)
  - GROWI 本体は CSP を設定していない(helmet contentSecurityPolicy なし、コード検索で確認)→ `img-src` 問題はデフォルト構成では発生しない

## Research Log

### 外部レビュー(Codex gpt-5.6-sol, 2026-07-23)

- **Context**: 最小カット案の欠陥検出を目的とした独立レビュー
- **Findings**(採用済み):
  - **共有オリジン問題**: `growilabs.github.io` は GitHub Pages の全プロジェクトが共有するオリジン。同一オリジン検証だけでは `https://growilabs.github.io/other-repo/x.png` を通してしまう → **フィードディレクトリ配下 `images/` への封じ込め検証**(解決後 pathname の prefix 比較、末尾スラッシュ付きで `/images-evil/` 偽装を防止)が必須
  - `onError` 非表示状態はコンポーネント再利用(ページ切替)で新しい画像に引き継がれる罠 → **URL を key にした remount** でリセット
  - Mongoose nested schema は `_id: false` + `default: undefined` を指定しないと空 `{}` や不要な `_id` が実体化する
  - SVG は許可しない(不要な攻撃面)。解決後 URL は https のみ
- **Implications**: 検証ロジックは「path 文法(zod)」と「URL 解決 + 封じ込め(純関数)」の二段に分離する

### 既存パターン分析

- **`resolveLocaleText`**(`client/utils/resolve-locale-text.ts`): title/body のロケール解決に使用中。alt にそのまま再利用
- **`isSafeHttpUrl`**(NewsFeed.tsx 内): url ボタンの描画時再検証。画像 URL にも同じ関数を適用
- **フィードのハードコード URL**: `news-cron-service.ts` の `FEED_URL` 定数。画像解決の base はこの定数から導出する(別定数にすると乖離リスク)

## Design Decisions

- **検証の配置**: 封じ込め検証は cron(ingest)側。描画側は `isSafeHttpUrl` の再検証のみ(DB 内容がパーサ以外から来る可能性への defense-in-depth)。検証純関数は `(path, feedUrl) => string | null` の形で work-set を入力に取る(coding-style: Executors Take Their Work-Set as Input)
- **保存形式**: 解決済み絶対 URL を保存(相対パスを保存して描画時解決する案は、描画側が feed URL を知る必要が生じ結合が増えるため不採用)
- **NewsImage コンポーネント分離**: onError state を持つ最小コンポーネントに隔離し、`key={url}` で remount リセットを構造的に保証

## Risks

- フィード側スキーマ v1.1 が未確定のままアプリ先行 → path 文法・上限値はアプリ側が先に確定し、配信側 CI がそれに追従する(本 spec の値が正)
- クライアント egress 制限環境で画像のみ欠落 → graceful degradation(要件 3.1)として受容済み

## Post-implementation: Codex adversarial diff review (2026-07-23)

- **Verdict**: BLOCKER/MAJOR なし。「封じ込めバイパス・XSS は確認されず」「$set/$unset・upsert-insert・zod .catch・key={url} の正当性欠陥は確認されず」
- **MINOR 3件(全て反映済み)**:
  1. remount 契約が NewsFeed 統合点で未テスト → NewsFeed.spec に「同一アイテムの画像 URL 変更で error 状態が引き継がれない」テストを追加(key={url} 削除の回帰を検出)
  2. Mongoose Map の alt が API/JSON 経由で Record として届く保証がない → news-integration.integ に DB→API→JSON round-trip テストを追加(空 {} 非実体化の確認も同時に)
  3. resolver のエッジケース不足 → バックスラッシュ正規化・trailing-dot ホスト・punycode ホスト・大文字スキーム・明示 :443・same-scheme 相対参照の 7 ケースを追加(受理・拒否の判定を resolve 層で直接固定)
