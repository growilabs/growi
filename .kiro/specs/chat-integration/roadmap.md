# chat-integration Sub-spec Roadmap

> 本ファイルは umbrella spec `chat-integration` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

`apps/slackbot-proxy`（Slack 専用の中継サーバ、以下 Gen 1）を、Slack・Mattermost・Discord・Microsoft Teams の
4 サービスに対応した中継サーバへ**完全に作り直す**。Gen 1 との後方互換は取らず、段階的な移行も考えない。
Gen 1 には手を入れず、GROWI 本体で両方を同時に有効にできる形で併存させる。

前提・確定済みの決定（決定 1〜10）・調査の記録は、本ディレクトリの `brief.md` と `research.md` にある。
要件（14 件・受け入れ条件 85 件）は本 umbrella の `requirements.md` が持ち、**sub-spec は要件 ID を参照する。番号は振り直さない。**

## 分割の経緯

当初は単一 spec として設計し、`design.md` が 1882 行まで肥大した
（テンプレートの警告水準 1000 行の約 2 倍）。敵対的レビューを Opus のサブエージェント 4 体・のべ 5 巡かけた結果、
**2 種類の欠陥が別々の原因で出続けた**。

1. **修正が別の箇所を壊す。** 4 回の修正すべてが「A 節を直したら B 節と食い違った」型だった
   （口の向きが逆・鍵の口が片方向・資格情報が 1 組・返信の経路が古いまま）。
   1882 行を一望できないことによる取りこぼしで、設計判断の誤りではない
2. **境界に散った欠陥が見つからない。** 新しいレビュアーに替えたところ、
   3 巡かけて誰も見つけていなかった critical が 6 件出た。**うち 2 件は両側の境界の問題**
   （相手が付けた識別子を自分側の一意キーにしていた／層の順序と部品の依存が食い違っていた）で、
   通信契約が独立していれば構造として気づけたはずのものだった

そこで **3 つの sub-spec に分割する**。1 の出血を止め、2 を構造で防ぐことが目的。

## Approach Decision

- **Chosen**: 「どの資格情報とデータストアに触れるか」を境界として 3 つに割る。
  通信契約（`packages/chat`）を独立させ、proxy と GROWI 本体をその両側に置く。
- **Why**: 壊れ続けたのがまさに**両側の境界**だった — 口の向き、鍵の向き、封筒に何を載せるか、識別子の一意性。
  「両者の間を何がどちら向きに流れるか」だけを扱う spec があれば一望できる。
  contract が固まれば proxy と app は**並行して実装できる**。
- **Rejected alternatives**:
  - 単一 spec のまま修正を続ける案: 4 回中 4 回、修正が別の箇所を壊している。5 回目も同じになる公算が高い
  - 機能で割る案（通知 / 検索 / ページ作成 …）: どの機能も 3 つの成果物すべてにまたがるので、境界が引けない
  - proxy と app の 2 つに割る案: 契約が両方に重複して置かれ、食い違いを止められない。**契約を独立させることが分割の主目的**

## Sub-specs

| Sub-spec | 成果物 | 責務 | 状態 |
|---|---|---|---|
| [chat-integration-protocol](../chat-integration-protocol/) | `packages/chat`（`@growi/chat`） | GROWI ⇄ proxy の通信契約、RFC 9421 署名、チャンネル権限の判定（両側が使う純粋関数） | design 生成中 |
| [chat-integration-proxy](../chat-integration-proxy/) | `apps/chat-integration-proxy` | 4 サービスとのやり取り、関係管理、コマンドの解釈、検索の統合、常時接続 | design 生成中 |
| [chat-integration-app](../chat-integration-app/) | `apps/app/src/features/chat-integration/` | 通知の送出、コマンドの処理、利用者の紐付け、鍵の保持、管理画面 | design 生成中 |

**依存の向き**: `protocol` ← `proxy` / `app`。protocol は他の 2 つを知らない。
proxy と app は互いを知らず、protocol の契約だけで話す。

## Scope

- **In**: 要件 1〜14（`requirements.md`）のすべて
- **Out**: Gen 1（`apps/slackbot-proxy`、`packages/slack`）の変更 / Chatwork と Google Chat / 公式アプリ審査 /
  LLM を使ったページ作成 / Cloudflare Workers 向けの 2 つ目のビルド（決定 10 で不採用）

## Constraints

- **要件 ID を振り直さない。** テストとタスクが番号を直接参照するため（`.claude/rules/spec-lifecycle.md`）
- **契約の変更は 3 spec すべてに効く。** `protocol` の design を変えたら `proxy` と `app` を必ず再確認する
- **Gen 1 には手を入れない**
