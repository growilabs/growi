# git bisectによるメモリ消費量増加の原因特定調査計画

## 調査目的
2025/7/1以降、production buildしたサーバーのメモリ利用量（Heap Total）が約25%～33%増加した原因コミットを特定する。

## 判定基準
- **Good:** Heap Total ≒ 90MB
- **Bad:** Heap Total ≒ 110MB

## 調査範囲
- 開始コミット: タグ `v7.2.9` (acdccb05538b72a593d690ce042922d6b71a4a63)
- 終了コミット: master (db1d378da55ffa8c08b4f1a0cca3b6a2a3e2c219)

## 実行手順
1. 対象コミットをチェックアウト
   ```bash
   git checkout {target-commit}
   ```
2. ビルド
   ```bash
   cd /workspace/growi/apps/app
   turbo run bootstrap
   turbo run build
   ```
3. サーバー起動
   ```bash
   NODE_ENV=production node --inspect -r dotenv-flow/config dist/server/app.js
   ```
   サーバーはバックグラウンドで起動し、プロセスIDを /tmp/growi_server.pid に記録
4. 10秒 sleep してからメモリ消費量計測
   ```bash
   sleep 10
   cp /home/vscode/print-memory-consumption.ts tmp/
   node --experimental-strip-types --experimental-transform-types --experimental-detect-module --no-warnings=ExperimentalWarning tmp/print-memory-consumption.ts
   ```
5. サーバー停止
  ```bash
  kill $(cat /tmp/growi_server.pid) && rm /tmp/growi_server.pid
  ```
6. Heap Total値でGood/Bad判定

## 注意事項
- サーバー起動直後の値で判定する（アクセスによるメモリリークの可能性もあるため、なるべくアクセス前に計測）。
- 必要に応じて複数回計測し、安定した値を採用する。
- bisectの自動化には、Heap Total値の判定をスクリプト化することで効率化可能。

---

# git bisect 実施指示書

1. bisect開始
   ```bash
   git bisect start
   git bisect bad master
   git bisect good v7.2.9
   ```
2. 各コミットで以下を実施
   - 上記「実行手順」に従いビルド・起動・計測
   - Heap Total値でGood/Bad判定
   - 判定結果に応じて
     ```bash
     git bisect good
     # または
     git bisect bad
     ```
3. bisect終了後、原因コミットを記録
   ```bash
   git bisect reset
   ```

---

## 参考: 判定自動化例（bashスクリプト）

```bash
HEAP_TOTAL=$(node .../print-memory-consumption.ts | grep 'Heap Total' | awk '{print $3}')
if (( $(echo "$HEAP_TOTAL < 100" | bc -l) )); then
  exit 0  # good
else
  exit 1  # bad
fi
```
bisect runで自動化する場合はこのスクリプトを利用してください。
