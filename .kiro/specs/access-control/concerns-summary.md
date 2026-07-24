# 権限管理まわりの検討まとめ

> 2026-07 時点でのセッションログ。`access-control` umbrella（横断的な認可基盤）と
> `enhanced-guest`（外部ゲスト受け入れ。read/edit分離・guest-users・time-limited-access 等）を
> 横断して検討した内容・懸念点・未決事項の記録。各 spec の brief/requirements/design/
> research とは別に、意思決定の経緯を残すためのサマリ。

## 全体像

```
access-control（新規 umbrella・横断的な認可基盤）
├── authorization-core          … design 生成済み・未承認（依存なし）
├── admin-permission-delegation … design 生成済み・未承認・design review 済み（core 依存）
└── account-scope-roles         … brief のみ（core 依存）

enhanced-guest（既存 umbrella）
├── granular-page-permissions   … design 生成済み・未承認
├── guest-users                 … brief のみ（granular-page-permissions 依存とされているが要検証）
└── time-limited-access         … brief のみ（依存なし）
```

## 各 spec の位置づけ整理（検討の出発点）

| | 会話での位置づけ | 担当スペック | 内容 |
|---|---|---|---|
| 最初に挙げた機能案 | `granular-page-permissions` | ページの **read/edit 分離**（「Public だが編集可」「グループ限定だが閲覧のみ」） |
| 同じ会話で追加で挙げた機能案① | `admin-permission-delegation` | 管理者ではないが **usergroup 管理だけできる**（部分的な管理権限の委譲） |
| 同じ会話で追加で挙げた機能案② | `account-scope-roles` | **閲覧＋コメントのみ**できるアカウント全体ロール |
| 基盤 | `authorization-core` | 上記2つを*表現できるようにする*土台（`authorize()` 判定点＋Role/Capability モデル） |

> これは単に会話の中で挙がった順番の記録であり、優先度でも外部要望の有無でもない。
> 実際の外部要望（実証拠）は後述「実証拠の発見」節（#7709/#11148）を参照。
> 実装の優先順位は後述「優先順位の再検討」節を参照。
> なお `granular-page-permissions` は `access-control` 側の完了を待たず単独で着手できる（依存なし）。

---

## 統一の設計方針（access-control 側）

- **単一の判定入口**：`authorize(user, action, resource?)` に権限判定を集約。
- **統一は「判定インターフェース」レベルで行い、「データモデル」レベルでは行わない**：
  - admin/account 系 → ロール × capability（主体にロールを持たせる、RBAC 型）
  - ページ系（`page:*`）→ 既存の `PageGrantService`（grant がリソースに宿る、ツリー継承型）へ**委譲**（作り直さない）
- capability の語彙は **既存の `SCOPE`**（`packages/core/src/interfaces/scope.ts`）を再利用（新しい語彙を発明しない）。
- 導入は**後方互換**：`user.admin === true` ⇒ 全 capability。ロール未設定時は既存挙動と完全一致。データ移行不要。

---

## `authorization-core`（基盤）— 懸念は少ない

- Role/RoleAssignment の永続化は **Mongoose**（User/UserGroup と同居、Prisma 移行時に追随）で確定。
- `Scope` 型は既に TS2589（型が深すぎるエラー）を避けるよう手書き union で定義済み → **参照するだけなら安全**。
- 単体では**加算的・非活性**（誰もまだ呼ばない）ため、実行時のクリティカルな懸念はほぼ無い。
- 残る小さな論点：`composeCapabilities` の null 安全性、削除時の cascade（孤児 RoleAssignment）程度。

---

## `admin-permission-delegation`（usergroup 委譲など）

### 変更範囲（gap 分析で確定）
- `adminRequired` は **28〜29ファイル・約145経路**に per-route で散在（router 一括ゲートなし）。
- 朗報：各経路は既に `accessTokenParser([SCOPE.READ|WRITE.ADMIN.<section>])` で**必要 capability を宣言済み** → ゲート置換はこの既存注釈を再利用するだけで済む。

### Design Review で見つかり反映した3点
1. **網羅の検証方法**：既存の route-middleware スナップショット＋`route-middleware-baseline.json` に接地。vault/g2g/news の変種ゲート形も明示列挙。
2. **capability 粒度**：enforcement は per-scope のまま、ロール構成 UI は「セクション束（`AdminSection`）＝ `none/view/manage`」で扱う（生スコープを直接並べない）。
3. **後方互換の検証**：既存 `authz-matrix-baseline.json` に回帰基準を接地。

### さらに深掘りで見つかった懸念（未反映・要判断）
- **admin 判定はルート以外にも散在**：socket-io の admin namespace（`adminRequired` を再利用）、サービス層の `operator.admin`（ページ削除）、client の操作ゲート（Maintenance/GrantSelector/ShareLink 等）。ルート網羅だけでは委譲が中途半端になる。
- **アクティビティ（監査ログ）への記録が design に未反映**：ロールの作成・付与・剥奪・capability 拒否（403）を、既存の `Activity`/`SupportedAction`（`ADMIN_*` 系）の仲間として記録すべきだが、現 design.md にはまだ明記されていない。
- 要決定（DEC-1〜DEC-5、`admin-permission-delegation/research.md` に記録済み）：非ルート admin 判定のスコープ、socket 必要 capability、cascade、TS2589 対策、null-safety テスト。

---

## `granular-page-permissions`（read/edit分離）— 深掘りの結論

### 本当に効く懸念は1つだけ
> **①権限が read×edit の2次元になり、以後ページ権限を触る・テストするたびに両軸を考える前提が恒久的に続く。** これは規模にもデータ量にも依存しない、モデルの性質そのもの。

### ①の具体的な現れ（要決定リスト）
| # | 決めどころ |
|---|---|
| 1 | RESTRICTED（リンク共有）× edit の意味 |
| 2 | OWNER（自分のみ）× edit の扱い |
| 3 | 後から read を狭めたとき、既存 editScope が宙に浮く問題 |
| 4 | 移動でサブツリーが再正規化され、編集者が権利を失いうる問題 |
| 5 | 新規子ページの editScope 初期値 |
| 6 | 継承／一括適用 UI での2軸提示 |

### 精査の結果、懸念から外れたもの
- **editScope のデータ形（片道ドア説）**：任意フィールドで未設定ページは対象外、追加変更は移行不要、作り替え時のみ一部ページの通常移行 → **懸念に挙げるほどではない**。
- **権限判定のキャッシュ不在**：`getUserRelatedGroups` は populate で都度取得するが、実際の規模（1人あたり最大70グループ・1グループ200人程度）では**軽い**。limit で打ち切るのは正確性を壊すため不可（懸念そのものが規模依存で、この規模では顕在化しない）。

### 他に見つかった論点（①とは別軸、注意では消えない設計判断）
- **A. 編集権＝公開範囲の変更権も持つ**：design は「edit があれば grant/editScope も変更可」を既存踏襲として採用。「編集を任せた」つもりが「権限管理まで任せた」ことになる（将来分離する余地はあるが本 spec では先送り）。
- **B. editScope は機密性の制御ではない**：「編集を制限＝守った」という誤解が生まれやすい（中身は read scope のまま全公開）。
- **C. 既存の書き込みトークン/ボットが editScope 設定ページで 403 になりうる**（設定した場合のみ、仕様どおりだが運用者には想定外になりうる）。

### 朗報（影響なし）
- Elasticsearch・Plugin機構・Revision モデルには**影響なし**（検索は read scope のまま、edit は無関係）。
- 既存ページは editScope 未設定 ⇒ 従来どおり。**移行不要**。
- リアルタイム共同編集（Yjs）は、**既存 ROM と同じ防ぎ方（画面で隠す＋保存ルートで弾く）を踏襲すればよい**。Yjs 接続自体に新しい鍵は不要（ROM も同じレベルの防御のため、残留リスクとして許容可能）。

---

## 優先順位の再検討（スコープが広がりすぎた反省）

- **元々のゴールはもっと狭かった**：「外部ユーザーが有効期限付きで GROWI のページを見れる機能」。
  これは理論上 `guest-users`＋`time-limited-access` の2つだけで達成できる（「編集させない」は既存の
  グローバル ROM の流用で済み、read/edit 分離は不要）。
- 「柔軟な権限設定」へスコープを広げた結果、実装が大きくなりすぎるため、優先順位の取捨選択が必要になった。
- **page-grant.ts を複雑化させるのは read/edit 分離（`granular-page-permissions`）だけ**と判明:
  - 🔴 複雑化する：read/edit 分離（新しい軸をツリー正規化エンジンに通す必要がある）
  - 🟡 軽く触るだけ：`guest-users`（Public 非公開の1条件を追加）、`authorization-core` の page 委譲（呼ぶだけ）、`account-scope-roles`（読み取り専用の呼び出し）
  - 🟢 無関係：`time-limited-access`、`admin-permission-delegation`（管理画面ドメインで、ページ grant と無関係）
- 検討した実装順序案：
  ```
  guest-users ＋ time-limited-access（複雑化回避・低リスク）
    → authorization-core（土台。admin-permission-delegation/account-scope-roles の前提）
    → admin-permission-delegation
    → account-scope-roles
    → granular-page-permissions（read/edit分離・最後。最も複雑）
  ```
- ただし、**「複雑化を避ける順」よりも「実際のユーザー需要がある順」を優先したい**という方針転換があり、下記の実証拠調査に繋がった。

## 実証拠の発見（GitHub discussion 調査）

`gh` CLI で GROWI リポジトリの discussion を実際に検索し、以下を確認した（推測ではなく実在確認済み）：

| discussion | 内容 | 対応 spec | 備考 |
|---|---|---|---|
| **[#7709](https://github.com/growilabs/growi/discussions/7709)**（原点・最重要） | 「数百ユーザのいる環境では管理者の負担が大きすぎる…グループの設定画面だけを一般利用者が使えるようにしてほしい」。コアメンテナーが**「アビリティ」概念**（capability をユーザー/グループに付与）を提案し、他の参加者が「同じ仕組みでページの閲覧/編集権限も管理できるのでは」と発展させている | `admin-permission-delegation` **と** `authorization-core` 両方の直接の実証拠 | Role×Capability モデル（ユーザー/グループ双方へ付与）の方向性が、数年前からコミュニティで既に構想されていたことが判明 |
| **[#11148 のコメント](https://github.com/growilabs/growi/discussions/11148#discussioncomment-17669027)**（最近の再提起） | 「グループ管理者を指定してグループ管理は委譲できるようにしていただきたいです。エンタープライズの運用を考えると大変なので。」 | 同上 | #7709 と同根の要望が、年数を経た現在も継続して求められている証拠 |
| **#9091**（要注意：無関係と判明） | 「閲覧権限設定に、自分を含んでいないグループを含めて複数設定したい」 | `granular-page-permissions`（ページの grant 共有 UI の話） | 一見似ているが、**グループ管理の委譲とは別物**（ページ共有時のグループ選択 UI 制約の話）。当初の憶測で「近い」としていたが訂正 |

- **新しい未決事項として発見**：#11148 の文脈（「自分の所属するグループ」のメンバー可視化スレッドへの
  派生コメント）は、委譲の粒度が「admin セクション丸ごと（全 UserGroup 管理）」ではなく
  **「特定の1グループだけを管理できる（per-group 委譲）」を求めている可能性を示唆する**。
- 両 discussion は `authorization-core/brief.md`・`admin-permission-delegation/brief.md` の
  Problem 節に正式引用として追記済み。per-group 粒度の論点は `admin-permission-delegation/brief.md`
  に「要検討（open question）」として明記済み（requirements フェーズで確定させる）。

---

## 未決事項（次に握るべきこと）

1. **`admin-permission-delegation`：委譲の粒度が「セクション単位（全グループ管理）」か「per-group（特定の1グループだけ）」か**（#11148 の文脈から新たに浮上。requirements フェーズで確定）。
2. `admin-permission-delegation`：非ルート admin 判定（socket/サービス層/client）をどこまでスコープに含めるか。
3. `admin-permission-delegation`：ロール変更のアクティビティ（監査ログ）記録を design に追加するか。
4. **実装順序**：複雑化回避（granular を最後に）か、実証拠のある需要優先（admin-permission-delegation を早める）か、最終的な優先順位の確定。
5. **`guest-users`：本当に `granular-page-permissions`（read/edit分離）に依存する必要があるか**。実は「非所属グループへの付与」機能だけで足りる可能性があり、そうであれば granular の完了を待たずに着手できる（`guest-users` の gap 分析で検証）。
6. `granular-page-permissions`：①の6つの要決定リスト（RESTRICTED/OWNER の扱い、read 縮小時の後始末、移動時の再正規化、子ページ既定値、UI 提示）。
7. `granular-page-permissions`：A（編集権＝権限管理権も持つ）の思想を今回のスコープで受け入れるか。
