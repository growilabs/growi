# Requirements Document

## Introduction

GROWI 本体に、PAT(personal access token) で認証した利用者が「自分が最近編集した内容」を
全ページ横断・増分で取得するための汎用 API を新設する。責務を2つに分割する:

- **Changes Index API（変更インデックス）** — 期間を指定すると、差分本文は返さず「どのページの、
  どの版からどの版を見ればよいか」の参照メタデータをページングで返す（＝変更の発見）。
- **Revision Diff API（リビジョン差分）** — 版ペア（複数ページ・バッチ）を渡すと、各ペアの差分を返す
  （＝差分の中身）。

背景: 現状の GROWI には「PAT 認証した本人の編集を全ページ横断・時刻 T 以降で増分取得する」入口が無い
（既存の単一ページ版一覧・cookie 専用のユーザー活動・admin 専用の監査ログのいずれも該当しない）。
最初の既知の利用者は外部の取り込み処理（PrimaVista の agent-memory-ingest-growi）だが、両 API は
特定利用者に依存しない汎用部品として設計し、GROWI 自身の画面や他の利用者からも使えるようにする。

詳細な発見過程・設計上の決定は `brief.md` を参照。

## Boundary Context

- **In scope**:
  - Changes Index API: 認証ユーザー本人の変更を全ページ横断・期間指定・cursor ページングで返す。
    差分本文は返さず版ペア参照メタ＋アクセス可否/削除フラグを返す。連続編集のまとめ。
  - Revision Diff API: 版ペアのバッチ（上限あり）を受け、ペアごとに権限検証して unified diff を返す。
  - PAT 認証と、ページ閲覧権限に基づく可視性の判定。
- **Out of scope**:
  - 利用者側（agent-memory-ingest-growi）の取り込み実装・SDK 利用。
  - GROWI 画面 UI の変更、既存のクライアント側差分表示の置き換え。
  - admin 監査ログ（activity）の改修。
- **Adjacent expectations**:
  - 既存の PAT/権限スコープ基盤（ページ閲覧の読み取り権限）を再利用する。本 API はこの基盤を前提とし、
    認証・スコープ機構そのものは新設・改変しない。
  - 既存のページ閲覧アクセス制御（誰がどのページを見られるか）の判定結果に従う。
  - 既存のリビジョン保存（ページごとの版と作成者・作成時刻）を前提とする。
- **想定上限の目安**: Revision Diff API の1リクエストあたりの版ペア数の上限は約 20。正確な値は design で確定する。

## Requirements

### Requirement 1: 本人の変更インデックス取得（全ページ横断・期間指定）

**Objective:** As an API利用者(PAT で認証), I want 自分が編集したページの変更を全ページ横断で期間指定して取得する, so that 増分同期のためにどの版を差分すべきかを発見できる

#### Acceptance Criteria

1. When 利用者が `since`（下限時刻）または `fromDate`/`toDate`（期間）を指定して変更インデックスを要求したとき, the Changes Index API shall その範囲内で認証ユーザー自身が作成した変更を全ページ横断で返す
2. The Changes Index API shall 各変更エントリについて、差分取得に必要な参照（対象ページ識別子・baseline 版参照・最新版参照）とメタdata（作成者・作成時刻）を返し、差分本文は含めない
3. When 指定範囲内に認証ユーザーの変更が存在しないとき, the Changes Index API shall 空の結果を返す
4. Where 要求が時間範囲を一切含まないとき, the Changes Index API shall 認証ユーザーの全期間の変更を（ページング前提で）対象として返す
5. If `fromDate` が `toDate` より後など範囲指定が不正なとき, the Changes Index API shall 要求を不正として拒否し、その旨を返す

### Requirement 2: 本人限定（なりすまし防止）

**Objective:** As an システム運用者, I want 変更インデックスが必ず認証主体本人の変更だけを返すことを保証する, so that 他人の編集履歴が漏れない

#### Acceptance Criteria

1. The Changes Index API shall 結果の対象ユーザーをアクセストークン由来の認証ユーザーに固定する
2. If 要求が対象ユーザーを別人に切り替えるパラメータ（任意の userId 等）を含むとき, the Changes Index API shall そのパラメータによる対象切り替えを行わず、常に認証ユーザー本人を対象とする

### Requirement 3: 増分のための安定したページング

**Objective:** As an API利用者, I want 件数不明の結果を安定してページ送りする, so that 増分同期で取りこぼし・重複なく全件を取得できる

#### Acceptance Criteria

1. The Changes Index API shall 結果を、件数上限のあるページ単位で cursor 方式により返す
2. The Changes Index API shall エントリを、増分取得に適した時系列順で返す
3. When 利用者が前ページで得た cursor を指定して次ページを要求したとき, the Changes Index API shall その位置の続きから返し、ページ要求の合間に新しい変更が発生しても既出エントリの重複や取りこぼしを生じさせない
4. While さらに結果が残っているとき, the Changes Index API shall 次ページが存在することと、その継続位置（次の cursor）を示す
5. When これ以上結果が無いとき, the Changes Index API shall 結果の終端であることを示す

### Requirement 4: 連続編集のまとめと新規作成の扱い

**Objective:** As an API利用者, I want 自分の連続編集を1エントリにまとめて受け取る, so that 冗長なエントリを避けつつ、他人の変更を自分の差分に混入させない

#### Acceptance Criteria

1. When 認証ユーザーが同一ページを、他の作成者の版に中断されずに連続して複数回編集したとき, the Changes Index API shall それらを1つの変更エントリにまとめ、baseline をその連続編集の直前の版、最新版をその連続編集の最後の版とする
2. If 認証ユーザーの同一ページへの編集の間に他の作成者の版が割り込んだとき, the Changes Index API shall その割り込みを境に変更エントリを分割する
3. When 認証ユーザーの編集が当該ページの最初の版で、直前の版が存在しないとき, the Changes Index API shall baseline 参照を空（新規作成を示す）として返す

### Requirement 5: アクセス権限・削除のフラグ付け（インデックス）

**Objective:** As an システム運用者, I want アクセス不能・削除済みのエントリを黙って除外せずフラグで示す, so that 利用者が状態を区別でき、かつ現在制限されている情報が漏れない

#### Acceptance Criteria

1. When 変更エントリの対象ページを認証ユーザーが現在閲覧できるとき, the Changes Index API shall そのエントリにページパスを含める
2. If 変更エントリの対象ページを認証ユーザーが現在閲覧できないとき, the Changes Index API shall そのエントリを「閲覧不可」として印付けし、現在のページパスおよびそのページの現在の内容を一切含めない
3. If 変更エントリの対象ページが削除（ゴミ箱・完全削除）されているとき, the Changes Index API shall そのエントリを「削除済み」として印付けする
4. The Changes Index API shall 「閲覧不可」「削除済み」と印付けされたエントリも結果に含める（黙って除外しない）

### Requirement 6: 版ペアのバッチ差分取得（複数ページ）

**Objective:** As an API利用者, I want 複数ページにまたがる版ペアをまとめて差分取得する, so that インデックスで得た参照から実際の変更内容を効率よく取得できる

#### Acceptance Criteria

1. When 利用者が版ペアの集合（各ペアは対象ページ・baseline 版・対象版を指す）を送信したとき, the Revision Diff API shall 各ペアについて差分を返す
2. The Revision Diff API shall 各差分を、前後の文脈行を含む unified diff 形式で返す
3. Where ペアの baseline 参照が空のとき, the Revision Diff API shall 対象版の全文を「追加」として返す
4. Where 利用者が文脈行数を指定したとき, the Revision Diff API shall 各変更箇所の周囲にその行数の文脈行を含める
5. If 1リクエストに含まれる版ペア数が許容上限を超えるとき, the Revision Diff API shall 要求を拒否し、上限を示す

### Requirement 7: ペア単位の独立した権限検証（不正参照対策）

**Objective:** As an システム運用者, I want 差分 API が呼び出し元を信用せずペアごとに権限検証する, so that 他人のページや無関係な版を指定して内容を覗かれない

#### Acceptance Criteria

1. When the Revision Diff API が版ペアを受け取ったとき, the Revision Diff API shall そのペアの差分を返す前に、認証ユーザーが対象ページを現在閲覧できるかを検証する
2. If 認証ユーザーが対象ページを閲覧できないとき, the Revision Diff API shall そのペアについて「権限なし」結果を返し、当該ページの内容や認可失敗を超える詳細を明かさない
3. If ペアの baseline 版または対象版が指定された対象ページに属していないとき, the Revision Diff API shall そのペアを不正として拒否する
4. When バッチ内に認可されるペアと認可されないペアが混在するとき, the Revision Diff API shall 認可されたペアの差分を返しつつ、残りはペア単位のエラーとして返し、リクエスト全体は失敗させない
5. The Revision Diff API shall 参照が変更インデックス由来か否かにかかわらず、すべての要求について独立に権限検証を行う

### Requirement 8: 認証と権限（PAT）

**Objective:** As an システム運用者, I want 両 API がページ読み取り権限を持つ PAT を要求する, so that 認可された主体だけが本人の変更と差分を取得できる

#### Acceptance Criteria

1. The Changes Index API および the Revision Diff API shall 要求が有効な personal access token で認証されることを要求する
2. If 要求が有効な認証情報を提示しないとき, the APIs shall 未認証として要求を拒否する
3. If トークンがページのリビジョン読み取りに必要な読み取り権限を欠くとき, the APIs shall 権限不足として要求を拒否する

### Requirement 9: 大規模データでの増分取得の実用性

**Objective:** As an システム運用者, I want 編集履歴やページ数が大きくても増分取得が実用的に動く, so that 大規模な wiki でも同期処理が破綻しない

#### Acceptance Criteria

1. The Changes Index API shall リビジョン総量によらず、1ページ分の（件数上限のある）結果を実用的な応答時間で返す
2. The Revision Diff API shall 1リクエストあたりの版ペア数上限により処理量を制限し、応答時間と応答サイズを予測可能な範囲に保つ
