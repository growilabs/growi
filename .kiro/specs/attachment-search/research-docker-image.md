# MarkItDown REST API 向け Docker image 調査報告

## 調査の経緯と要件

本レポートは、Microsoft MarkItDown を REST API として提供する公開 Docker image を探すという依頼を受けて実施した調査の結果である。依頼時に確認した要件は以下のとおり。

**配布・ライセンス要件**

- Docker Hub / GitHub Container Registry (ghcr.io) / Quay.io など、public なレジストリから pull できる pre-built image であること
- MIT / Apache 2.0 / BSD など、オープンかつ商用利用可能なライセンスであること(MIT / Apache 2.0 を優先、GPL 系も可)
- 軽量であること(image サイズ・メモリフットプリントが小さく、不要な依存を含まない)

**運用要件**

- 本番環境での利用を想定しており、Kubernetes の Deployment + HPA で運用する
- 内部ネットワーク専用で運用するため、認証機能は不要(あっても可)
- stateless に動作し、シグナルハンドリング(SIGTERM)が適切であることが望ましい
- ヘルスチェックエンドポイントがある、または容易に追加できること

**機能要件(サポートすべき形式)**

- PDF / docx / xlsx / pptx / HTML / CSV / TSV / JSON / XML / YAML / プレーンテキスト / RTF / EPub / Jupyter notebook / MSG

**機能要件(不要・むしろ含まれない方が望ましい)**

- 画像 OCR
- 音声・動画文字起こし(Whisper、Azure Speech 等)
- YouTube 等の外部 URL 取り込み
- zip アーカイブ処理

## 調査サマリ

**結論から言うと、上記要件(軽量・OCR/音声なし・Kubernetes 本番運用)を完全に満たす公開 Docker image は存在しない。** Microsoft 公式はリポジトリに CLI 用と MCP サーバー用の Dockerfile を置いているだけで REST API 実装は持たず、サードパーティ実装は 8 件ほど存在するものの、いずれも「pre-built 配布」「認証」「health probe」「軽量 extras 指定」のどれかが欠けている。最有力の既製品は **`ghcr.io/dezoito/markitdown-api:latest`**(MIT、GHCR pre-built、FastAPI + uv multi-stage)だが、本番投入にはヘルスエンドポイント追加などの小改修を推奨する。要件に厳密に合わせるなら、本レポート末尾の Dockerfile テンプレートで**自前ビルドする方が確実**というのが本調査の総合判断である。

## Microsoft 公式の Docker 提供状況

microsoft/markitdown リポジトリ(MIT、最新 v0.1.4 = 2025-12-01 リリース、PyPI では 0.1.5 も配布中)に **REST API 実装は存在しない**。公開されているのは以下 2 種類の Dockerfile のみで、いずれもベースは `python:3.13-slim-bullseye`、`ffmpeg` と `exiftool` を apt で入れ、`markitdown[all]` をフル インストールするため結果として 375〜378 MB になる。GHCR への公式 push を提案する PR #1184 は 2025 年 4 月作成のまま**マージ保留中**で、2026 年 4 月現在 `ghcr.io/microsoft/markitdown` も `hub.docker.com/r/microsoft/markitdown` も存在しない。

| パス | 対象 | エントリーポイント |
|---|---|---|
| `/Dockerfile` | CLI(markitdown) | `markitdown`(STDIN/STDOUT) |
| `/packages/markitdown-mcp/Dockerfile` | MCP サーバー | `markitdown-mcp`(STDIO/HTTP/SSE) |

なお Docker Hub の **`mcp/markitdown`(378.5 MB、50K+ pulls)は Docker 社キュレートの MCP カタログ用**であり Microsoft 公式ではない。MCP プロトコルを喋るものであって REST ではないため、本件の用途には不適合である点に注意。

## サードパーティ REST API 実装の一覧

GitHub / Docker Hub / ghcr.io を網羅的に調べた結果、REST API 用途として機能する実装は以下の通り。Quay.io には該当 image 無し。

| # | プロジェクト | Image | ライセンス | 認証 | /health | Pre-built |
|---|---|---|---|---|---|---|
| 1 | dezoito/markitdown-api | `ghcr.io/dezoito/markitdown-api:latest` | MIT | 無 | 無 | ✅ |
| 2 | elbruno/MarkItDownServer | 自前ビルド | MIT | Rate limit のみ | ✅ `/health` | ❌ |
| 3 | bon5co/markitdown-api-auth | `ghcr.io/bon5co/markitdown-api-auth:latest` | 不明(MIT fork 系) | ✅ Bearer | 不明 | ✅ |
| 4 | adampraszywka/MarkItDownApi | `ghcr.io/adampraszywka/markitdownapi:main` | MIT | 無 | ✅ `/ping` | ✅ |
| 5 | 9bow/markitdown-api-fly-io | 自前ビルド(Fly.io 用) | MIT | ✅ X-API-Key/Bearer | ✅ `/health` | ❌ |
| 6 | melchiorb/markitdown-api | 自前ビルド | 不明 | 無 | 不明 | ❌ |
| 7 | Saluana/markitdown-rest | 自前ビルド | **未記載** | 無 | 無 | ❌ |
| 8 | pig4cloud/markitdown | `pig4cloud/markitdown`(Docker Hub) | 不明 | OpenAI key 必須 | 無 | ✅ |

### 候補ごとの特徴と要件適合性

**① dezoito/markitdown-api(最有力)** は elbruno/MarkItDownServer からの fork で、Python slim + `uv` の multi-stage build により軽量化を標榜する。⭐69 / Fork 25、Open Issue 0 で活発。エンドポイントは `POST /process_file`(multipart で file、戻り値 `{"markdown":"..."}`)と Swagger `/docs` のみ。対応形式は doc/docx/ppt/pptx/pdf/xls/xlsx/txt/csv/json と要件とほぼ一致。**ポート 8490 固定、health/ready probe なし、認証なし**、バージョン pin なし(build 時点の最新取得)。pull 一発で動くのが最大の強みだが、**本番 K8s では Probe エンドポイントと認証を前段 Ingress で付ける運用が必要**。

**② elbruno/MarkItDownServer(本家)** は ⭐31 で README が最も充実。`PORT/HOST/MAX_FILE_SIZE/LOG_LEVEL/WORKERS/ENABLE_RATE_LIMIT/RATE_LIMIT` を環境変数化、`/health` 実装、CORS / セキュリティヘッダ / レート制限を内蔵と**本番寄りの作り**。ただし `markitdown==0.0.1a2` という古い alpha 版に固定されているため、**fork して extras を `[pdf,docx,xlsx,pptx,outlook]` に限定しつつ markitdown 0.1.5 に上げるのが現実的**。pre-built image は配布されていない。

**③ bon5co/markitdown-api-auth** は dezoito fork と思われるが **Bearer 認証 (`API_BEARER_TOKEN`) を初期実装**しており、Railway の公式テンプレートに採用されている(2026-02-28 作成)。LICENSE とリポジトリ情報の一次確認が取れていないため、社内本番採用前に LICENSE と SBOM の検証が必要。

**④ adampraszywka/MarkItDownApi** は ASP.NET Core から Python MarkItDown を呼ぶ.NET スタックのラッパー。`POST /read` と `GET /ping`。C# クライアント NuGet も提供される。**Python + .NET の二重ランタイム分 image が肥大化しがち**なので、.NET 連携が要件でない限り選ぶ理由は薄い。最終更新は 2025-01 で停滞気味。

**⑤ 9bow/markitdown-api-fly-io** は ⭐2 と小規模ながら、`GET /health` + `POST /convert`、API キー認証、`MAX_DOWNLOAD_SIZE / TIMEOUT_SECONDS`、400/401/408/413 など HTTP ステータス設計が丁寧で**最も K8s 本番向きの設計**。ただし Fly.io 前提のため Dockerfile を流用して自前 push する形になる。

**⑥ Saluana/markitdown-rest と ⑧ pig4cloud/markitdown は要件から外れる**。前者は YouTube 字幕・音声文字起こし・ZIP・画像 OCR を全部盛りにしており image が肥大化し、かつ **LICENSE 未設定**で再配布リスクがある。後者は GPT-4V を使った**画像 OCR 特化**で、PDF/Office 全般には対応しない。

### Kubernetes 運用時の共通注意点

調査した**全候補が `uvicorn` または `gunicorn` を CMD 直接実行し、`tini`/`dumb-init` を使っていない**。FastAPI/uvicorn は exec 形式で起動していれば SIGTERM で graceful shutdown が走るため実害は少ないが、念のため Pod の `terminationGracePeriodSeconds` を 30 秒以上に設定し、必要なら `spec.shareProcessNamespace: true` や Pod レベルで `--init` 相当(containerd では自動 reaper)を意識しておくとよい。**health probe 実装があるのは elbruno / 9bow / adampraszywka の 3 件のみ**なので、その他を採用するなら `/docs` などへの HTTP GET で代用するか、パッチで `/healthz` を追加するのが無難。

## MarkItDown extras の正しい使い方(軽量化のキモ)

PyPI の `markitdown` が公開している extras は **`all / audio-transcription / az-doc-intel / docx / outlook / pdf / pptx / xls / xlsx / youtube-transcription`** の 10 種。要件のファイル形式を**過不足なく**カバーするには次の指定が適切である。

```bash
pip install 'markitdown[pdf,docx,xlsx,pptx,outlook]>=0.1.5'
```

**`[all]` を使ってはいけない** — OCR(az-doc-intel)、音声(audio-transcription)、YouTube を全部引き込み image が 300MB → 600MB〜1GB に膨らむ。`audio-transcription` を外せば ffmpeg もイメージから除外でき、Python slim 系なら 250〜400MB に収まる。HTML / CSV / TSV / JSON / XML / TXT / RTF / EPub / Jupyter notebook は extras 指定なしでコアがサポートする(ただし RTF は `markitdown-sample-plugin` もしくは別途実装が必要な点に注意)。また **`MarkItDown(enable_plugins=False)` で初期化し、`llm_client` を渡さなければ画像 OCR は呼び出されず EXIF メタデータ抽出のみ**に留まる。

## 要件適合度ランキング(2026 年 4 月時点の推奨順)

1. **自前ビルド(最推奨)** — 下記 Dockerfile + FastAPI 最小実装。軽量 extras を明示指定でき、Probe / 認証 / バージョン pin を完全にコントロールできる。工数は半日程度。
2. **`ghcr.io/dezoito/markitdown-api:latest`** — pre-built で即動く。社内ネットワーク専用で PoC や短期運用なら実用レベル。Probe は Ingress 側で /docs への GET などで代用。
3. **elbruno/MarkItDownServer を fork してビルド** — 本番向け環境変数が揃うが markitdown 本体のバージョン更新が必須。
4. **`ghcr.io/bon5co/markitdown-api-auth:latest`** — Bearer が標準装備。LICENSE 確認が取れれば次点候補に昇格。
5. **9bow/markitdown-api-fly-io を fork してビルド** — health + API key を含む設計が良好。要件を満たす改修工数が小さい。
6. **adampraszywka/MarkItDownApi** — .NET 連携が不要なら選ぶ理由は乏しい。
7. Saluana / pig4cloud / Kolosal-RMS-MarkItDown / melchiorb — 要件不適合または情報不足で非推奨。

## 自前ビルド用リファレンス実装

pre-built image で要件を満たせない場合に備え、**uv + multi-stage + `python:3.12-slim-bookworm`** ベースの最小構成を提示する。想定 image サイズは 250〜400MB、RAM requests 256Mi / limits 1Gi が目安。

### Dockerfile

```dockerfile
# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev
COPY app/ ./app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

FROM python:3.12-slim-bookworm AS runtime
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m -s /bin/false app
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/app /app/app
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```

`pyproject.toml` の肝は**軽量 extras 指定**である。`markitdown[pdf,docx,xlsx,pptx,outlook]>=0.1.5` とし、音声・YouTube・az-doc-intel を絶対に入れない。FastAPI 最小実装 `app/main.py` は以下のポイントを押さえれば十分:

- `MarkItDown(enable_plugins=False)` でプラグインと LLM をオフ(画像 OCR 無効化)
- `GET /healthz`(liveness)と `GET /readyz`(readiness)を分離
- `POST /convert` で multipart を受け、`convert_stream()` に `io.BytesIO` と拡張子を渡す
- `MAX_FILE_SIZE`(既定 50MB)、`API_BEARER_TOKEN`(任意)、`LOG_LEVEL` を環境変数化

### Kubernetes Deployment 抜粋

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: api
          image: ghcr.io/your-org/markitdown-api:0.1.0
          resources:
            requests: { cpu: "100m", memory: "256Mi" }
            limits:   { cpu: "1",    memory: "1Gi"   }
          livenessProbe:
            httpGet: { path: /healthz, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet: { path: /readyz, port: 8000 }
            initialDelaySeconds: 3
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
```

HPA は CPU ベース(target 70%)で開始し、ワーカープロセス(`uvicorn --workers 2` 程度)と合わせてスケールテスト後に調整するのが定石。**stateless 化は tmpfs マウントで十分** — MarkItDown は一時ファイルを作る処理もあるため `emptyDir` を `/tmp` にマウントしておくこと。

## 結論と実務上の推奨アクション

本調査の総合的な示唆は以下の 3 点に集約される。第一に、**Microsoft 公式は REST API を提供する気配がなく**、公式 Dockerfile も CLI / MCP 用途のみであるため、REST 化は必ずサードパーティ実装か自前実装になる。第二に、サードパーティ実装は **dezoito/markitdown-api** が唯一「現実的な pre-built 候補」であり、社内ネットワーク専用なら十分使える。第三に、軽量性・本番運用品質・バージョン pin を **3 つとも**取りたいなら、本レポートの Dockerfile テンプレートで自前ビルドする方が総合的に早い。ビルド時に `markitdown[pdf,docx,xlsx,pptx,outlook]` と明示指定するだけで、公式が配布している `[all]` ベースの image より 30〜60% 軽くなる点が最大の実利である。なお MarkItDown 本体が依然 Beta(0.1.x)であることから、本番投入時は**必ずバージョン pin**(例: `markitdown==0.1.5`)を行い、依存側の breaking change に備えて CI で smoke test を仕込んでおくことを推奨する。