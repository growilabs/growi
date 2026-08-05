# UI デザイン参照 (Claude Design)

- 出典: https://claude.ai/design/p/d2b98505-e2cb-4a5a-87d4-ca8d2e8d2f08 (プロジェクト「GROWI AI機能設定UI改善」)
- 取得日: 2026-07-02
- ファイル:
  - `AI Settings Multi-Provider.dc.html` — 管理画面全体(AI 有効トグル / グローバル既定モデルセレクタ / プロバイダタブ / Update ボタン)
  - `ProviderPanel.dc.html` — プロバイダ 1 件分のパネル(API キー / モデル一覧 + provider options JSON / モデル追加 picker / Azure 接続設定)
- 注意: `.dc.html` は Claude Design のコンポーネント形式(`support.js` ランタイム前提)であり、そのままはレンダリングできない。レイアウト・インタラクションの参照用。実装は design.md のコンポーネント設計に従う。
