# バックエンド Rust 移行計画（優先順位付き）

Python (FastAPI) バックエンド全体を Rust へ移行するためのロードマップ。
「何から手を付けるか」を依存関係・リスク・検証のしやすさから優先順位付けする。

- 対象規模: `api/` 7,194 行 + `api/routers/` 4,994 行 = **約 12,200 行**（テスト除く）
- フロントエンド（Vue 3）・tmux 前提のアーキテクチャ・API 契約は**変更しない**
- 既存の E2E スイート（Playwright）を回帰検証の要とする

---

## 1. 目的と期待効果

| 項目 | 現状 (Python) | 移行後 (Rust) |
|------|--------------|---------------|
| 配布 | venv + pip（`./any-console setup` で依存解決） | **単一バイナリ**。venv・pip・ビルドツールチェーン不要 |
| 起動 | uvicorn 起動で数秒 | ミリ秒オーダー |
| メモリ | 数十〜百 MB | 大幅減（Raspberry Pi 等の低スペック機で有利） |
| 並行処理 | asyncio + ThreadPoolExecutor 併用 | tokio に一本化。GIL 起因の制約消滅 |
| 型安全 | mypy（実行時は保証なし） | コンパイル時保証 |

pywebpush のネイティブ依存（http-ece）ビルド失敗問題（requirements-optional.txt 参照）も、Rust では `web-push` crate を静的リンクするだけで解消する。

---

## 2. 移行戦略: ストラングラー方式（段階的置換）

**ビッグバン書き換えは行わない。** Rust サーバを前段に立て、移行済みルートは Rust が処理し、未移行ルートは Python バックエンドへリバースプロキシする。

```
Browser ──▶ Rust (axum) ──┬─▶ 移行済みルート: Rust が直接処理
                          └─▶ 未移行ルート:   127.0.0.1 の Python へ proxy
```

これが成立する根拠（本プロジェクト固有の好条件）:

1. **永続状態はプロセス外にある** — セッションは tmux、設定・キュー・トークンは `data/` 配下の JSON ファイル。プロセス内に閉じた状態は WebSocket ブリッジ・レートリミッタ・TTL キャッシュ程度で、これらはルート群単位で丸ごと移行すれば分割問題が生じない。
2. **Git は subprocess のみ**（docs/DECISIONS.md）— ライブラリ移植不要。`tokio::process` で同じコマンドを叩くだけ。
3. **E2E が使い捨てサーバモードで完備** — `ANY_CONSOLE_URL` を Rust サーバに向けるだけで全スペックが回帰網になる。

### 移行単位の原則

- **ルート群（router）+ その依存モジュール**を 1 単位とし、単位ごとに「Rust 実装 → テスト移植 → E2E 通過 → proxy 対象から外す」を繰り返す
- WebSocket を含む単位（terminal / status stream）は proxy の透過が面倒なため、**依存が揃った段階で一括切替**する
- `data/` 配下の JSON・`config.json` の**ファイルフォーマット互換を絶対条件**とする（serde でスキーマを固定し、既存ファイルの読み書きラウンドトリップをテストで保証）

---

## 3. 技術スタック対応表

| Python | Rust | 備考 |
|--------|------|------|
| FastAPI + uvicorn | **axum** + tokio + tower | ミドルウェア（rate limit / security headers / client log）は tower Layer |
| pydantic | **serde** + validator | エラーフィールド `detail` の互換維持（Backend API ルール） |
| websockets | axum 組み込み WS (tokio-tungstenite) | |
| watchfiles (git_watch) | **notify** + debouncer | イベント粒度の差異に注意（§6 リスク） |
| pty.fork (terminal_pty) | **nix** crate (`openpty`/`forkpty`) or **portable-pty** | Linux / macOS 両対応必須 |
| subprocess | tokio::process | `OSError` 相当の捕捉規約は `io::Error` ハンドリングへ写像 |
| cryptography (VAPID 鍵生成) | **p256** + base64 | push.py の SECP256R1 鍵と互換 |
| pywebpush | **web-push** crate | ECE 暗号化込み。ネイティブ依存問題が消える |
| qrcode | **qrcode** crate | 起動ログの端末 QR 描画 |
| StaticFiles | tower-http `ServeDir` | `ui/dist` 配信 |
| httpx（manifest_update / preview proxy） | **reqwest** / hyper client | |
| pytest | cargo test + **axum::TestServer** 相当 | カバレッジは cargo-llvm-cov |

---

## 4. 優先順位の判断基準

1. **依存の根 → 葉の順**: 全ルートが使う基盤（config / auth / errors / rate limit）が先。基盤なしにルートは移せない
2. **リスクの低い順に実績を積む**: 純粋ロジック・ファイル CRUD → subprocess → WebSocket → pty の順で難度が上がる
3. **テストで挟める順**: pytest が厚いモジュール（git / jobs / dispatch）は移植検証が容易。カバレッジ除外されている terminal 系（pyproject.toml 参照）は最も検証が薄いため**最後に最大の注意を払って**移す
4. **切替の可逆性**: 各フェーズ完了時点で proxy 設定を戻せば Python に即時ロールバック可能な状態を保つ

---

## 5. フェーズ計画

### Phase 0 — 基盤とプロキシ骨格（最優先）— **実装済み**

**目的**: Rust サーバが前段に立ち、全ルートを Python へ透過 proxy した状態で E2E 全通過。ここが移行全体の土台。

**状況**: `server/` crate として実装済み。cargo test（unit 30 + 統合 7）、
実機スモーク（Python バックエンドを 8889 に立て Rust front 8890 経由で
HTTP / WS / 静的配信 / 認証を確認）、E2E 全スペック通過
（42/43 — 唯一の失敗 preview.spec.js は Python 直結でも同様に失敗する
実行環境要因: コンテナに `ss` が無くポート検出が動かない）。

起動方法（移行期間中の手動 2 プロセス構成）:

```bash
# Python バックエンドを内部ポートで起動（X-Forwarded-For を信頼させる）
python3 -m uvicorn api.main:app --host 127.0.0.1 --port 8889 \
  --proxy-headers --forwarded-allow-ips 127.0.0.1

# Rust front を公開ポートで起動
cd server && cargo build --release
ANY_CONSOLE_PROJECT_ROOT=$(pwd)/.. \
ANY_CONSOLE_RS_PORT=8888 \
ANY_CONSOLE_UPSTREAM=http://127.0.0.1:8889 \
./target/release/any-console-server
```

Phase 0 のスコープ判断（実装時に確定した事項）:

- **config.json / auth.json / devices.json は Rust 側では読み取り専用**。
  書き込み（正規化・マイグレーション・.bak ローテーション・トークン更新・
  デバイス登録）は Python が唯一のライターであり続け、プロセス間の
  read-modify-write 競合を作らない。ライターの移管は該当 API を移す
  Phase 1 で行う（計画の「config 書き込み系」はここへ後ろ倒し）。
- 認証コア（メイントークン・デバイス cookie HMAC・Tailscale 信頼判定）は
  `server/src/auth.rs` に移植・テスト済みだが、Phase 0 では Rust 側に
  認証必須ルートが無いため配線は Phase 1 から。
- WS proxy は upstream のハンドシェイク拒否（401/403）をそのまま HTTP で
  ミラーする（Python 直結と同じ挙動）。
- `./any-console` ランチャーの 2 プロセス統合起動は未着手（Phase 1 以降、
  移行済みルートが実利を持つ段階で組み込む）。

| 対象 (Python) | 内容 |
|---------------|------|
| — | cargo workspace 新設（`server/` crate）、CI に cargo test / clippy / fmt 追加 |
| — | リバースプロキシ層（HTTP + WS 透過）と移行済みルートのルーティング表 |
| `common.py` (440行) | `DATA_DIR` / `CONFIG_FILE` / `PROJECT_ROOT` / `ANY_CONSOLE_DATA_DIR` 隔離、JSON ファイル load/save、定数 |
| `errors.py` / `validators.py` | エラー形式（`detail` フィールド）、パス検証 |
| `config.py` / `config_schema.py` / `config_migrations.py` (682行) | config.json 読み書き・スキーマ検証・バージョンマイグレーション。**既存ファイルとのラウンドトリップ互換テスト必須** |
| `auth.py` (386行) | Bearer トークン検証、API トークン（scope 付き）、trusted-proxy 判定、`data/auth.json` 互換 |
| `rate_limiter.py` / `security_headers.py` / `client_log.py` | tower Layer 化 |
| `main.py` の静的配信・singleton lock・起動ログ（QR 含む） | `ui/dist` 配信、`/auth/check` |

**完了条件**: `ANY_CONSOLE_URL` を Rust サーバに向けて `npm run test:e2e` 全通過（実処理はまだほぼ Python）。

### Phase 1 — 低リスク API 群（状態レス・ファイル CRUD）

**目的**: 実ルートの移行実績を作り、パターン（handler / テスト / エラー変換）を確立する。

| 対象 | 行数目安 |
|------|---------|
| `routers/system.py`（システム情報） | 493 |
| `routers/settings.py` + `icons.py` | 469 |
| `routers/workspaces.py` + `routers/groups.py` | 452 |
| `routers/devices.py` + `devices.py` | 339 |
| `routers/api_tokens.py` | 52 |
| `activity.py` / `gh_utils.py` | 79 |
| 画像アップロード（main.py 内） | — |

**リスク**: 低。JSON ファイル CRUD が中心で pytest も厚い。

### Phase 2 — Git 系（subprocess の主戦場）

**目的**: 本アプリの中核機能の一つ。subprocess 実行・パース・ロックのパターンを確立する。

| 対象 | 行数目安 |
|------|---------|
| `git_utils.py` / `git_lock.py` / `git_info.py` | 639 |
| `routers/git_*.py` 一式（branches / files / diff / history / worktree / helpers） | 1,522 |
| `routers/github.py` | 45 |

**注意**: git 出力のパースは Python 実装と**同一入力・同一出力**のゴールデンテストを移植する。ワークスペースロック（`git_lock.py`）は tokio の `Mutex` map で等価実装。

### Phase 3 — ジョブ・ディスパッチ

| 対象 | 行数目安 |
|------|---------|
| `job_models.py` / `job_match.py` | 135 |
| `routers/jobs.py` / `jobs_common.py` / `job_runner.py` | 519 |
| `routers/dispatch.py`（承認キュー・dedup・dispatch scope トークン） | 651 |
| `routers/pairing.py`（QR ペアリング・短命トークン） | 277 |

**注意**: dispatch はキュー JSON の互換とステータスストリームへのスナップショット配信（Phase 4 と接続）が要。dispatch トークンの権限境界（direct: true 拒否）はセキュリティ要件なのでテストを厚く移植する。

### Phase 4 — リアルタイム系（WebSocket / FS 監視 / ポーリング）

**目的**: status stream ソケットに相乗りする監視系一式。ここから難度が上がる。

| 対象 | 行数目安 |
|------|---------|
| `ws_broadcast.py` / `routers/status_stream.py` | 141 |
| `git_watch.py`（watchfiles → notify、自動 fetch） | 433 |
| `session_watch.py` | 74 |
| `agent_watch.py`（3値状態判定・自動紐付け） | 584 |
| `screen_manifest.py` + `agent_manifests/`（herdr ルール） | 562 |
| `manifest_update.py`（リモートマニフェスト更新） | 272 |
| `agent_hooks.py` + `routers/agent_hooks.py` | 180 |
| `foreground.py`（/proc・ps の前面 argv 検査） | 176 |
| `routers/preview.py` + `preview.py`（dev server 検出 + proxy） | 563 |

**注意**:
- git_watch は「購読者ゼロで全停止」のライフサイクル管理が肝。tokio の task 管理で等価に
- foreground.py の Linux(/proc) / macOS(ps) 二系統分岐はそのまま移植（クロスプラットフォーム一級サポートの方針）
- 状態判定の優先順位（hooks > manifest > 画面差分）はロジック単体テストを先に移植してから配線する

### Phase 5 — ターミナル（最難関・最後に最大の注意で）

**目的**: 製品の心臓部。pty × tmux × WebSocket の三つ巴で、pytest カバレッジ除外領域＝自動テストが最も薄い。

| 対象 | 行数目安 |
|------|---------|
| `tmux.py` | 259 |
| `terminal_pty.py`（forkpty / read / resize / close） | 77 |
| `terminal_session.py`（ClientBridge・マルチクライアントアタッチ） | 375 |
| `routers/terminal.py` | 416 |
| `push.py`（VAPID / Web Push。通知トリガが agent_watch と絡むためここで） | 180 |

**注意**:
- `pty.fork` → `nix::pty::forkpty`。EOF / EAGAIN / SIGCHLD 処理のセマンティクス差異を重点確認
- tmux の `window-size latest` ポリシー・複数クライアント同時アタッチ・detached セッション（adopt/close）の E2E（`terminal.spec.js` / `detached-sessions.spec.js` / `mobile-terminal.spec.js`）を macOS / Linux 両方で回す
- 切替前に**手動スモーク期間**を設ける（iOS Safari / Android Chrome の実機確認を含む）

### Phase 6 — Python 撤去・配布切替

- proxy 層を削除し、Rust 単独バイナリ化
- `./any-console` を「venv セットアップ」から「バイナリ取得 or cargo build」へ変更（systemd / launchd 両対応は維持）
- requirements*.txt / pyproject.toml / pytest 一式の削除、CI から Python ジョブ撤去
- README / ARCHITECTURE.md / DECISIONS.md 更新（本移行の ADR 追記）
- release-please の対象調整、バイナリリリース（Linux x86_64 / aarch64、macOS arm64 / x86_64）

---

## 6. 主要リスクと対策

| リスク | 対策 |
|--------|------|
| pty / tmux 周りの OS 差異（Linux vs macOS） | Phase 5 を最後に置き、両 OS の E2E + 実機スモークを切替条件にする |
| `notify` と `watchfiles` のイベント粒度差（inotify 上限、rename 系） | git_watch は元々「API 起点 nudge + 自動 fetch が下支え」の設計。イベント欠落があっても機能劣化に留まることをテストで確認 |
| `data/` JSON・config.json の互換破壊 | 実ファイルのフィクスチャで Python 産→Rust 読み / Rust 産→Python 読みの双方向テスト（移行期間中は両実装が同じファイルを触るため必須） |
| WS proxy の透過性（Phase 0） | terminal / status stream は proxy 経由期間を作らず、依存が揃った時点で一括切替 |
| 移行中の二重メンテ（Python に新機能、Rust が追いつけない） | フェーズ単位を小さく保ち、移行済み領域への Python 側変更を凍結するルールを CLAUDE.md に追記 |
| レートリミッタ等インメモリ状態の分断 | ミドルウェアは Phase 0 で Rust 側に一本化（Python 側はしきい値を実質無効化して二重制限を防ぐ） |

---

## 7. テスト戦略

1. **E2E が最上位の回帰網**: 各フェーズの完了条件は「使い捨てサーバモードで `npm run test:e2e` 全通過」。Rust サーバ起動に対応するよう `playwright.config.js` の webServer を段階的に切替
2. **pytest の移植**: 移行モジュールに対応する `tests/test_*.py` を cargo test へ移植してから実装を差し替える（テストファースト）。カバレッジ閾値 85% は Rust 側でも cargo-llvm-cov で維持
3. **契約テスト**: `tests/e2e/api-contract.spec.js`（実装済み）がワイヤレベルの契約
   （`detail` エラー形式・セキュリティヘッダ・静的配信キャッシュ規則・WS 認証拒否等）を
   UI を介さず固定する。`ANY_CONSOLE_URL` の向き先を変えるだけで Python 直結 /
   Rust front 経由の両方に同一検証を適用できる（Phase 0 で両構成の通過を確認済み）。
   ルート群を移行するたびに、そのルートの応答形をこのスペックへ追記してから
   実装を差し替える

---

## 8. 進め方サマリ

```
Phase 0  基盤 + 透過proxy      ★★★ 最優先。ここが全ての土台
Phase 1  低リスクAPI群          リスク小・実績づくり
Phase 2  Git系                  subprocess パターン確立
Phase 3  ジョブ・ディスパッチ    キュー互換とトークン境界に注意
Phase 4  リアルタイム系(WS/監視) 難度上昇。ロジック単体テスト先行
Phase 5  ターミナル + push       最難関。両OS実機スモーク必須
Phase 6  Python撤去・配布切替    単一バイナリ化の完成
```

各フェーズ完了ごとに main へマージし、proxy ルーティング表の切替だけでロールバック可能な状態を維持する。
