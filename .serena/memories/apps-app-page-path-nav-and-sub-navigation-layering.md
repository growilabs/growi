# PagePathNav と SubNavigation の z-index レイヤリング

## 概要

PagePathNav（ページパス表示）と GrowiContextualSubNavigation（PageControls等を含むサブナビゲーション）の
Sticky 状態における z-index の重なり順を修正した際の知見。

## 修正したバグ

### 症状
スクロールしていって PagePathNav がウィンドウ上端に近づいたときに、PageControls のボタンが
PagePathNav の要素の裏側に回ってしまい、クリックできなくなる。

### 原因
z-index 的に以下のように重なっていたため：

**[Before]** 下層から順に：
1. PageView の children - z-0
2. ( GroundGlassBar = PageControls ) ← 同じ層 z-1
3. PagePathNav

PageControls が PagePathNav より下層にいたため、sticky 境界付近でクリック不能になっていた。

## 修正後の構成

**[After]** 下層から順に：
1. PageView の children - z-0
2. GroundGlassBar（磨りガラス背景）- z-1
3. PagePathNav - z-2（通常時）/ z-3（sticky時）
4. PageControls（nav要素）- z-3

### ファイル構成

- `GrowiContextualSubNavigation.tsx` - GroundGlassBar を分離してレンダリング
  - 1つ目: GroundGlassBar のみ（`position-fixed`, `z-1`）
  - 2つ目: nav 要素（`z-3`）
- `PagePathNavSticky.tsx` - z-index を動的に切り替え
  - 通常時: `z-2`
  - sticky時: `z-3`

## 実装のポイント

### GroundGlassBar を分離した理由
GroundGlassBar を `position-fixed` で常に固定表示にすることで、
PageControls と切り離して独立した z-index 層として扱えるようにした。

これにより、GroundGlassBar → PagePathNav → PageControls という
理想的なレイヤー構造を実現できた。

## CopyDropdown が z-2 で動作しない理由（解決済み）

### 問題

`PagePathNavSticky.tsx` の sticky 時の z-index について：

```tsx
// これだと CopyDropdown（マウスオーバーで表示されるドロップダウン）が出ない
innerActiveClass="active z-2 mt-1"

// これだと正常に動作する
innerActiveClass="active z-3 mt-1"
```

### 原因

1. `GrowiContextualSubNavigation` の sticky-inner-wrapper は `z-3` かつ横幅いっぱい(Flex アイテム)
2. この要素が PagePathNavSticky（`z-2`）の上に重なる
3. CopyDropdown は `.grw-page-path-nav-layout:hover` で `visibility: visible` になる仕組み
   （参照: `PagePathNavLayout.module.scss`）
4. **z-3 の要素が上に被さっているため、hover イベントが PagePathNavSticky に届かない**
5. 結果、CopyDropdown のアイコンが表示されない

### なぜ z-3 で動作するか

- 同じ z-index: 3 になるため、DOM 順序で前後が決まる
- PagePathNavSticky は GrowiContextualSubNavigation より後にレンダリングされるため前面に来る
- hover イベントが正常に届き、CopyDropdown が表示される

### 結論

PagePathNavSticky の sticky 時の z-index は `z-3` である必要がある。
これは GrowiContextualSubNavigation と同じ層に置くことで、DOM 順序による前後関係を利用するため。

## 関連ファイル

- `apps/app/src/client/components/PageView/PageView.tsx`
- `apps/app/src/client/components/Navbar/GrowiContextualSubNavigation.tsx`
- `apps/app/src/client/components/Navbar/GrowiContextualSubNavigation.module.scss`
- `apps/app/src/client/components/PagePathNavSticky/PagePathNavSticky.tsx`
- `apps/app/src/client/components/PagePathNavSticky/PagePathNavSticky.module.scss`
- `apps/app/src/components/Common/PagePathNav/PagePathNavLayout.tsx`（CopyDropdown を含む）

## ライブラリの注意事項

### react-stickynode の deprecation
`react-stickynode` は **2025-12-31 で deprecated** となる予定。
https://github.com/yahoo/react-stickynode

将来的には CSS `position: sticky` + `IntersectionObserver` への移行を検討する必要がある。

## 注意事項

- z-index の値を変更する際は、上記のレイヤー構造を壊さないよう注意
- Sticky コンポーネントの `innerActiveClass` で z-index を指定する際、
  他のコンポーネントとの相互作用を確認すること
