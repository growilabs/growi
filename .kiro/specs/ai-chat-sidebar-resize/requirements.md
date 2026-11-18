# Requirements Document

## Introduction
GROWI の AI チャットサイドバー（画面右端に重なって表示されるチャットパネル）の幅を、既存の左サイドバーと同じ操作感でドラッグして変更できるようにする。変更した幅はユーザーごとに保存され、ページを開き直しても、別のスレッドを開いても同じ幅で表示される。小さな画面では従来どおり全幅表示とし、リサイズ操作は提供しない。

## Project Description (Input)
AI チャットサイドバー（`apps/app/src/features/mastra/client/components/ChatSidebar/`、画面右端に `position: fixed` で重なるオーバーレイパネル）の幅を、既存の左サイドバーと同じようにドラッグでリサイズできるようにする。

事前調査で合意済みの方針:

- 既存の左サイドバー用リサイズ部品 `ResizableArea`（`apps/app/src/client/components/Sidebar/ResizableArea/`）を `apps/app/src/client/components/Common/ResizableArea/` へ移設し、`anchor: 'left' | 'right'` と `maxWidth` を追加して右端固定パネルでも使えるよう汎用化する。幅の計算は純関数として切り出す。左サイドバーの挙動は変えない（移設のみのコミットを先行させ、その上に機能追加を積む）。
- 「最小幅の半分未満までドラッグしたら折りたたむ（`onCollapsed`）」は `onCollapsed` が渡されたときだけ発火させる。チャットサイドバーは `onCollapsed` を渡さず、最小幅でクランプする（ドラッグで閉じない。閉じるのはヘッダーの × ボタンのみ）。
- 幅は `IUserUISettings` に `aiChatSidebarWidth?: number` として永続化する。Mongoose スキーマ、`PUT /user-ui-settings` のバリデータ（`isInt({ min: 1 })` で形式のみ検証し、`toInt()` で数値化）、ハンドラ内の `updateData` allow-list、Swagger コメント、ゲスト用の session 書き込みを `currentProductNavWidth` / `aiChatSelectedModelKey` と同様に対応する。
- クライアント側は Mastra feature 内に幅 atom と、確定時に `scheduleToPut({ aiChatSidebarWidth })` を呼ぶ派生 atom を置く（`currentProductNavWidth` と同じ形）。初期値の注入は feature 内に `useHydrateChatSidebarAtoms(userUISettings)` を用意し、`apps/app/src/pages/basic-layout-page/hydrate.ts` から呼ぶ（`~/states/ui/sidebar` から feature を import する向きにはしない）。注入時に min/max へクランプする。
- パラメータ: デフォルト幅 500px、最小幅 360px、最大幅は 960px と「ビューポート幅 − 320px」の小さい方（本文は `tw:max-w-4xl` = 896px で中央寄せされるため、それ以上は余白になる）。
- Bootstrap の sm ブレークポイント（576px）未満では従来どおり 100% 幅（CSS メディアクエリ）とし、リサイズを無効化する（`useDeviceLargerThanSm`）。
- ChatSidebar 外側コンテナの `overflow-hidden` がドラッグハンドルをクリップしないように overflow 制御の位置を見直す。SCSS の固定幅（sm 以上 500px）は撤去し、デフォルト幅は atom の初期値に移す。
- スレッド切替で ChatSidebar が remount されても幅は維持される（atom はグローバル）。リロード後も永続化された幅が復元される。
- テスト: 純関数 spec、ResizableArea のドラッグ操作 spec（右アンカーの幅計算、disabled 時はハンドル非表示、onCollapsed 未指定時は折りたたまない）、`user-ui-settings.spec.ts` への追加（ログイン時 `$set` 到達、ゲスト時 session、バリデータ受理/拒否）、幅 atom / hydrate フックの spec、`ChatSidebar.spec.tsx` への追加（atom の幅が style に反映、sm 未満でハンドル非表示）。

## Boundary Context
- **In scope**: AI チャットサイドバーの幅のドラッグ変更、幅の上下限、幅のユーザー別保存と復元、小画面での無効化、既存の左サイドバーのリサイズ挙動の維持。
- **Out of scope**: チャットサイドバーの開閉操作の変更（閉じる操作はヘッダーの閉じるボタンのまま）、チャットサイドバーを本文と並べて表示する（本文を押し広げる）レイアウト、キーボードやタッチ操作によるリサイズ（既存の左サイドバーと同様にマウス操作のみ）、左サイドバーの幅やリサイズ仕様の変更。
- **Adjacent expectations**: 既存の左サイドバーのリサイズ機能は本機能と同じ部品を共有するが、ユーザーから見える挙動（ドラッグ、最小幅、折りたたみ）は一切変わらない。ユーザー UI 設定の保存の仕組み（ログインユーザーはアカウントに、ゲストはセッションに保存）は既存のものをそのまま利用する。

## Requirements

### Requirement 1: ドラッグによる幅の変更
**Objective:** As a GROWI ユーザー, I want AI チャットサイドバーの左端をドラッグして幅を変えたい, so that 会話の内容量や画面の広さに合わせて見やすい幅で使える

#### Acceptance Criteria
1. While AI チャットサイドバーが開いていてリサイズが有効な状態のとき, the AI チャットサイドバー shall パネルの左端にドラッグ可能なハンドル領域を表示する
2. When ユーザーがハンドル領域にマウスカーソルを重ねたとき, the AI チャットサイドバー shall 左サイドバーと同じ見た目のリサイズ用の線を表示し、カーソルを左右リサイズ用の形状にする
3. When ユーザーがハンドル領域をドラッグしているとき, the AI チャットサイドバー shall マウスの横位置に追随して幅をリアルタイムに変更する（幅 = 画面右端からマウス位置までの距離）
4. When ユーザーがドラッグを終えたとき, the AI チャットサイドバー shall その時点の幅を確定幅として採用する
5. While ユーザーがドラッグしている間, the AI チャットサイドバー shall 幅変更のアニメーションを行わず、マウスに即時追随する
6. While ユーザーがドラッグしていない間に幅が変わるとき, the AI チャットサイドバー shall 左サイドバーと同じ短いアニメーションで幅を変化させる
7. The AI チャットサイドバー shall 本文領域に重なるオーバーレイとして表示され、幅を変えても本文領域のレイアウトを変化させない

### Requirement 2: 幅の上下限
**Objective:** As a GROWI ユーザー, I want 幅が使いものにならない値にならないようにしたい, so that 入力欄が潰れたり、元のページが完全に隠れたりしない

#### Acceptance Criteria
1. The AI チャットサイドバー shall 幅の最小値を 360px とする
2. The AI チャットサイドバー shall 幅の最大値を「960px」と「画面幅から 320px を引いた値」のうち小さい方とする
3. If ユーザーが最小値より狭くなる位置までドラッグしたとき, then the AI チャットサイドバー shall 幅を最小値に留め、サイドバーを閉じたり折りたたんだりしない
4. If ユーザーが最大値より広くなる位置までドラッグしたとき, then the AI チャットサイドバー shall 幅を最大値に留める
5. The AI チャットサイドバー shall 初回表示時（保存された幅がないとき）の幅を 500px とする

### Requirement 3: 幅の保存と復元
**Objective:** As a GROWI ユーザー, I want 一度調整した幅が次回以降も維持されてほしい, so that 開くたびに幅を直す手間がなくなる

#### Acceptance Criteria
1. When ユーザーがドラッグを終えて幅が確定したとき, the GROWI shall その幅をユーザーの UI 設定として保存する（ログインユーザーはアカウントに、ゲストはセッションに、既存の UI 設定と同じ方法で）
2. When ユーザーが短時間に何度も幅を変えたとき, the GROWI shall 既存の UI 設定と同様に保存要求をまとめ、最後の幅だけを保存する
3. When ユーザーがページを再読み込みして AI チャットサイドバーを開いたとき, the AI チャットサイドバー shall 保存された幅で表示する
4. When ユーザーが別のスレッドを開いたり新規チャットを開始したりして AI チャットサイドバーの内容が入れ替わったとき, the AI チャットサイドバー shall 直前と同じ幅を維持する
5. If 保存された幅が最小値未満または最大値超過であったとき, then the AI チャットサイドバー shall 上下限の範囲内に丸めた幅で表示する
6. If 幅の保存要求に数値でない値、整数でない値、または 1 未満の値が含まれていたとき, then the GROWI shall その要求を入力エラーとして拒否し、他の UI 設定と同じ形式のエラー応答を返す
7. When 幅以外の UI 設定だけを含む保存要求を受け取ったとき, the GROWI shall 保存済みの幅を変更しない
8. The GROWI shall 幅の保存・取得を既存のユーザー UI 設定の API と同じエンドポイント・同じ応答形式で行い、API 利用者に新しいエンドポイントを要求しない

### Requirement 4: 小画面での挙動
**Objective:** As a スマートフォンや狭いウィンドウのユーザー, I want 狭い画面ではこれまでどおり全幅でチャットを使いたい, so that 狭い画面で中途半端な幅になって使いにくくならない

#### Acceptance Criteria
1. While 画面幅が Bootstrap の sm ブレークポイント（576px）未満のとき, the AI チャットサイドバー shall 従来どおり画面の全幅で表示する
2. While 画面幅が sm ブレークポイント未満のとき, the AI チャットサイドバー shall ドラッグ用のハンドル領域を表示せず、リサイズ操作を受け付けない
3. While 画面幅が sm ブレークポイント以上のとき, the AI チャットサイドバー shall 保存された幅（または初期幅）で表示し、リサイズ操作を受け付ける
4. When 画面幅が sm ブレークポイントをまたいで変化したとき, the AI チャットサイドバー shall 新しい画面幅に応じた表示（全幅、または保存された幅）に切り替える

### Requirement 5: 表示の整合性
**Objective:** As a GROWI ユーザー, I want リサイズ機能を追加しても既存の表示が崩れないでほしい, so that 従来どおり安心してチャットを使える

#### Acceptance Criteria
1. The AI チャットサイドバー shall ハンドル領域がパネルの外枠に隠れて操作できなくなることなく、常に操作可能な位置に表示する
2. While チャット内のドロップダウン（モデル選択など）が開いているとき, the AI チャットサイドバー shall 従来どおり画面右端に固定されたまま横方向にずれない
3. While AI チャットサイドバーが任意の幅で表示されているとき, the AI チャットサイドバー shall ヘッダー、会話領域、入力欄をその幅に収めて表示し、横スクロールを発生させない

### Requirement 6: 左サイドバーの挙動維持
**Objective:** As a GROWI ユーザー, I want 左サイドバーのリサイズがこれまでどおり動いてほしい, so that 新機能の追加で既存の操作感が変わらない

#### Acceptance Criteria
1. The 左サイドバー shall 本機能の追加後も、ドック表示時のドラッグによる幅変更、最小幅 348px での制限、最小幅の半分未満までドラッグしたときの折りたたみ、確定幅の保存を従来どおり行う
2. The 左サイドバー shall 本機能の追加後も、ドロワー表示および折りたたみ表示のときはリサイズ操作を受け付けない
3. The 左サイドバー shall 本機能の追加後も、初回描画時に保存された幅で表示される（描画後に幅が飛ばない）
