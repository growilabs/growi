# enhanced-guest Sub-spec Roadmap

> 本ファイルは umbrella spec `enhanced-guest` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md`（現在 stub）を参照すること。

## Overview

外部パートナーや一時メンバーの受け入れを、安全かつ柔軟に行えるようにする取り組み
（[Discussion #11139 "Enhanced Guest"](https://github.com/growilabs/growi/discussions/11139)）。

出発点は「読み取り専用（ROM）ユーザーを作りたい」だったが、調査の結果 ROM 自体はほぼ
実装済み（`User.readOnly` フラグ・付与/解除 API・`exclude-read-only-user` ミドルウェア・
新規ユーザーのデフォルト ROM 設定）であることが判明した。Discussions の裏付けから、現場
（導入検討者・既存ユーザー）が本当に求めているのは次の2点だと明確になった:

1. **ロールを区別できる粒度の細かいページ権限**（read/edit 分離）— [#8815](https://github.com/growilabs/growi/discussions/8815) / [#8250](https://github.com/growilabs/growi/discussions/8250)、非所属グループへの付与は [#9091](https://github.com/growilabs/growi/discussions/9091)。
2. **明示的に許可した領域しか見えないゲスト**（Public ページが自動では見えない）— 複数の導入検討者から繰り返し聞かれる「外部の人には designated area だけ見せたい」という要件。

本ロードマップは Enhanced Guest を責務境界で3 sub-spec に分割し、依存順に進める。

## Approach Decision

- **Chosen**: 既存のページ grant モデルを段階的に拡張する。まず権限モデルの粒度を上げ
  （read/edit 分離・非所属グループ付与）、その上にゲスト固有のアクセスモデル（Public
  非自動公開）と期限付きアクセスを乗せる。
- **Why**: GROWI の権限は元々ページ側に乗っており、ツリー整合・継承（`page-grant.ts` /
  `GrantedGroupsInheritanceSelectModal`）も実装済み。並行する権限システムや早すぎる「ゲスト
  区分」導入を避け、既存資産を再利用しつつ最小の追加で価値を出すため。レビュー指摘
  （readOnly を作り直さない／期限は直交軸／本丸は柔軟な権限管理）とも整合する。
- **Rejected alternatives**:
  - *アカウント期限だけ付ける案*: ROM＋期限の薄い追加にとどまり、現場要望（柔軟な権限）に
    届かない。
  - *最初からゲスト userType を新設して ROM＋期限を内包する案*: ROM＋期限はゲスト固有でない
    ため正当化できなかった。ただし「Public 非自動公開」というゲスト固有の振る舞いが見つかった
    ため、その要件に限って `guest-users` で userType を導入する。

## Scope

- **In**: スコープ単位の read/edit ロール、非所属グループへの付与、配下ツリーへの権限付与 UI、
  Public が自動では見えないゲストユーザー（ホワイトリスト型）、ゲスト招待・管理、期限付き
  アクセス。
- **Out**: 承認/編集ワークフロー（[#9453](https://github.com/growilabs/growi/discussions/9453)）、
  グローバル `User.readOnly` の挙動変更、外部 IdP 連携の新規追加。

## Constraints

- 既存 grant の後方互換（観測されるアクセスを変えない移行。既存のグループ付与 ⇒ `edit`）。
- 既存のツリー正規化・継承（`page-grant.ts` / `GrantedGroupsInheritanceSelectModal`）を
  退行・重複させない。
- スコープ単位ロールとグローバル `User.readOnly` を厳密に分離する。
- TDD（リポジトリ方針）。ドキュメント・コメントは各 spec の `spec.json.language`（`ja`）に従う。

## Boundary Strategy

- **Why this split**: 「権限モデルの粒度」「ゲストのアクセスモデル」「アクセスの有効期限」は
  変更箇所・リスク・レビュー観点が異なる。基盤（権限モデル）を独立で固めることで、ゲストと
  期限を安全に積み上げられる。各 spec は 8–15 タスク程度の粒度に収まる見込み。
- **Shared seams to watch**:
  - `page-grant.ts` の実効ロール算出 — `granular-page-permissions` が所有し、`guest-users` が
    「Public 非自動公開」判定を重ねる。二重定義しないこと。
  - User モデルの属性追加（`guest-users` の userType、`time-limited-access` の expiredAt）は
    同じスキーマ／`IUser`（`packages/core/src/interfaces/user.ts`）に並ぶ。互いの概念を混ぜ
    ないこと。
  - grant 選択 UI（`GrantSelector` / `SelectGroupModal`）— `granular-page-permissions` が
    read/edit トグルと非所属グループ選択を追加し、`guest-users` が「ゲストを含む/のみ」の
    フィルタを重ねる。

## Specs (dependency order)

- [ ] granular-page-permissions -- スコープ単位の read/edit ロール分離＋非所属グループ付与＋配下ツリー権限付与 UI（⋮ メニュー）。ゲスト概念は持たない汎用の権限モデル基盤。Dependencies: none
- [ ] guest-users -- Public ページが自動では見えないゲスト userType（ホワイトリスト型アクセス）＋ゲスト招待フロー＋管理画面でのゲスト管理。Dependencies: granular-page-permissions
- [ ] time-limited-access -- アカウント単位の有効期限＋期限切れ自動停止（全ユーザーに適用可、ゲストと併用）。Dependencies: none（直交軸。guest-users と組み合わせて使う）
