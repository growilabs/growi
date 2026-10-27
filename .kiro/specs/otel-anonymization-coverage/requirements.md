# Requirements Document

## Project Description (Input)

**誰が困っているか**: `otel:anonymizeInBestEffort` を有効にして GROWI のトレースを外部の監視基盤へ送っている運用者と、そのデータを扱うプライバシ保護担当者。あわせて、匿名化の対象を今後追加・変更する GROWI 開発者。

**現状**:

- 完了済みの `opentelemetry` spec（要件 6）は「検索キーワード・ページパス・ユーザー名がトレースに平文で残らないこと」を目的にしているが、実際に匿名化されているのは一部の URL だけである。2026-10-27 の調査で、次の経路から平文が送られていることが分かった。
  - 検索: Next.js の画面内遷移で呼ばれる `/_next/data/<buildId>/_search.json?q=`、`/_private-legacy-pages?q=`、途中に `_search` を含む URL（page access 用の handler が search 用の handler の結果を上書きする）、`/_api/tags.search?q=`、`/_api/v3/users?searchText=`、`/_api/v3/users/usernames?q=`。
  - ページパス: `GET /_api/v3/page?path=`（ページ表示のたび）、`/_next/data/<buildId>/<ページパス>.json`（画面内のページ移動のたび）、`/_api/v3/page/exist?path=`、`.` を含むページ名、`/trash/*` など。
- handler に書かれた URL の一部（`page/check-page-existence`、`page/get-page-paths-with-descendant-count`、`page-listing/ancestors-children`）は実際のルートと食い違っており、何にも一致していない。
- どの URL をどう匿名化するかの一覧がどこにも無く、ルートの追加・改名に handler が追随しているかを確かめる手段が無い。
- `http.url`・`url.path`・`url.query` に元の URL が残る問題は、既存の契約の範囲内の不具合として PR #12151 で別途修正する（本 spec の対象外）。

**何を変えたいか**:

1. ユーザーが入力したデータ（ページパス・検索キーワード・タグ名・ユーザー名）を URL に含むリクエストを一覧にし、それぞれを「匿名化する（どう匿名化するか）」「意図的にそのまま残す（permalink や ObjectId だけを含む API など）」「未対応（既知の残課題）」のどれかに分類して spec に記載する。
2. 検索に関する上記の漏れを塞ぐ。
3. 同じ調査で見つかったページパスの漏れについて、対応するか・残課題とするかを決め、対応するものを塞ぐ。実際のルートと食い違っている handler の URL を直す。
4. handler の URL 判定を、「URL の形 → 匿名化するパラメータ」を並べた宣言的な一覧に寄せる。spec の一覧表・コード・hook を通したテストが 1 対 1 で対応し、ずれたら気づける状態にする。

**Amend target**: `.kiro/specs/opentelemetry/`（要件 6「HTTP リクエストの best-effort anonymization」と、design.md の Layer 4 / Extension Templates / Revalidation Triggers、research.md の handler 登録順に関する記述）。本 spec は一時的な修正用 spec であり、最後のタスクで変更内容を `opentelemetry` spec に書き戻し、本 spec を削除する（`.claude/rules/spec-lifecycle.md`）。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
