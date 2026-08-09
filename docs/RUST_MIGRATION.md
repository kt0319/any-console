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

### Phase 1 — 低リスク API 群（状態レス・ファイル CRUD）— **完了**

**目的**: 実ルートの移行実績を作り、パターン（handler / テスト / エラー変換）を確立する。

**状況**: 認証の配線（`RequireAuth` 抽出子・auth.json の mtime 監視による
トークン動的リロード）と system router 一式（`server/src/system.rs`）を移行済み。
Rust front はこれらのルートを proxy せずネイティブ応答する。実機で Python 直結と
Rust 応答のキー・値の同等性を比較検証済み（`user` は getpwuid 解決まで一致）。

続いて **config.json 書き込みエンジン**（`config.rs` / `config_schema.rs` /
`config_migrations.rs`）を移植し、settings（auth / recent-jobs 除く）・groups・
workspace-order を移行済み。要点:

- Python の `config.lock` fcntl flock に Rust も参加し、プロセス間の
  read-modify-write を直列化する
- Pydantic の正規化（extra 保持・デフォルト値とnullの除去・グローバルの
  部分救済）と .bak ローテーション・バージョンマイグレーションを同一挙動で
  再現。実機の相互書き込みテストで、Python 書き→Rust 書き→Python 書きの
  往復後に config.json が**バイト単位で安定**することを確認済み
- subprocess 層に CPython の C ロケール強制（PEP 538 相当:
  `LC_CTYPE=C.UTF-8` 注入）を移植。これが無いと tmux が `-F` フォーマットの
  タブを `_` にサニタイズし、detached sessions 一覧が空になる（E2E で検出・
  修正済み。**subprocess 移植時はロケール差に注意** — Phase 2 の git でも同様）

**実装時に確定した順序変更**: `routers/devices.py` / `routers/api_tokens.py` は
Phase 1 から**除外**し、認証ドメイン全体の移管時へ後ろ倒しした。
devices.json / auth.json への書き込み排他が Python 側ではプロセス内
`threading.Lock` のみで、config.json と違い fcntl ファイルロックが無いため、
両プロセスが同時にこれらを書くと lost update が起きうる。
一方 workspaces / groups / settings（config.json 書き込み）は fcntl ロックに
Rust も参加すればプロセス間で安全に書けるため、Phase 1 の残り対象はこちらだった。

認証ドメインは最終的に、config.json 系で使った「Rust も fcntl ロックに参加する」
方式ではなく、**atomic cutover**（`/devices/*`・`/auth/check`・`/auth/logout`・
`/auth/pairing/*/claim`・`/api-tokens/*`・`/settings/auth` を Rust の
`build_router` へ同時に配線する）で解決した。terminal/dispatch/job_runner
（Phase 5）で既に使っていたのと同じパターンで、これにより Python 側の
devices.json/auth.json 書き込みコードパスは配線と同時に永久に到達不能になり、
Python 側へ fcntl ロックを追加で持ち込む必要が無くなった（詳細は下記
「認証ドメイン（devices / api_tokens / pairing / auth.json）」参照）。

| 対象 | 行数目安 | 状況 |
|------|---------|------|
| `routers/system.py`（システム情報） | 493 | **移行済み** |
| `routers/settings.py` + `icons.py` | 469 | **移行済み**（/settings/auth 含め全移行 — /recent-jobs は Phase 3 で先行移行済み） |
| `routers/workspaces.py` + `routers/groups.py` | 452 | **移行済み**（workspaces 本体は Phase 4 で移行 — 一覧/statuses/登録/設定/削除/suggest。status stream への nudge は migration_bridge 経由） |
| `routers/devices.py` + `devices.py` | 339 | **移行済み**（認証ドメイン一括移行 — 下記「認証ドメイン」参照） |
| `routers/api_tokens.py` | 52 | **移行済み**（認証ドメイン一括移行 — 下記「認証ドメイン」参照） |
| `activity.py` | 23 | **移行済み**（`server/src/activity.rs`。git/terminal/dispatch 等、依存する各ルートの移行時に併せて移植済み） |
| `gh_utils.py` | 56 | **移行済み**（`server/src/github.rs`。gh CLI 30秒 TTL キャッシュ込み） |
| 画像アップロード（main.py 内） | 105 | **移行済み**（`server/src/upload_image.rs`。`POST /upload-image` を `build_router` へ配線済み — macOS は osascript 経由の NSPasteboard 書き込み、Linux は `sudo -u $SUDO_USER/$USER xclip` を移植） |

**リスク**: 低。JSON ファイル CRUD が中心で pytest も厚い。Phase 1 の全対象を移行済み。

### Phase 2 — Git 系（subprocess の主戦場）— **実装済み**

**目的**: 本アプリの中核機能の一つ。subprocess 実行・パース・ロックのパターンを確立する。

**状況**: git 実行コア（`git_utils.rs`: run_git_raw / run_git_command /
worktree porcelain パース / 動的 worktree 名解決 / resolve_workspace_path）、
ワークスペース書き込みロック（`git_lock.rs`: tokio Mutex map + 30秒タイムアウト）、
activity ログ（`activity.rs`: JSONL 追記 — O_APPEND のため Python との相互追記も
安全）、履歴/差分/コミット/スタッシュ系ルート一式
（git-log / file-history / commit-message / cherry-pick / revert / merge /
rebase / reset / commit / stash 5種 / diff 3種 / discard）を移行済み。

| 対象 | 行数目安 | 状況 |
|------|---------|------|
| `git_utils.py` / `git_lock.py` | 323 | **移行済み**（background_fetch 含む — Phase 4 で追加） |
| `git_info.py` | 317 | **移行済み**（Phase 4 — 11 クエリ並列 + 5秒 TTL キャッシュ + 世代ガード。Python 側は git_watch の refresh 用に併存） |
| `routers/git_history.py` / `git_diff.py` / `git_diff_utils.py` / `git_helpers.py` | 485 | **移行済み** |
| `routers/git_branches.py`（checkout / pull / push / fetch） | 337 | **移行済み**（ssh_env・追跡情報・未push件数アルゴリズム含む） |
| `routers/git_files.py` / `git_file_utils.py`（ファイル CRUD / zip） | 399 | **移行済み**（multipart アップロード・zip ダウンロード・ref 指定閲覧含む） |
| `routers/git_worktree.py` | 171 | **移行済み** |
| `routers/github.py` | 45 | **移行済み**（gh CLI 30秒 TTL キャッシュ含む） |

**実装時の確定事項**:

- Python の `execute_git_action` は成功時に `invalidate_git_info`
  （= status stream への即時 nudge）を行う。Phase 2 時点では git_watch の
  FS イベント検知（デバウンス 300ms）が下支えする設計だったが、Phase 4 で
  loopback 限定の `POST /internal/git-nudge`（`api/routers/migration_bridge.py`）
  を追加し、Rust の git 操作からも即時 nudge を復元済み（fire-and-forget、
  失敗時は従来どおり FS 監視が下支え）
- ワークスペースロックはプロセス内のみ（Python と同等）。Python に残る
  dispatch の checkout は元々このロックを取らないため、プロセス間の保護
  レベルは移行前と同等（後退なし）

**注意**: git 出力のパースは Python 実装と**同一入力・同一出力**のゴールデンテストを移植する。

### Phase 3 — ジョブ・ディスパッチ — **ジョブ CRUD 移行済み・実行系は再スコープ**

**状況**: ジョブ定義の CRUD 系（`jobs_common.rs` / `jobs.rs` / `icons.rs`）と、
Phase 1 から保留していた /recent-jobs（除去計算 + compare_and_update）を移行済み。
アイコン正規化（data URI 保存・favicon ダウンロード）も含む。

**実装時に確定した再スコープ**: dispatch / job_runner は実行時に
`TERMINAL_SESSIONS`（Python プロセス内のターミナル状態）と tmux セッション生成に
直接依存するため、**ターミナルサブシステムと同時（Phase 5）に移行**する。
pairing は devices.json への書き込み（認証ドメイン）依存のため後ろ倒しし、
最終的に「認証ドメイン」節の atomic cutover にまとめて移行した。

| 対象 | 行数目安 | 状況 |
|------|---------|------|
| `job_models.py` / `jobs_common.py` / `routers/jobs.py` + `icons.py` | 459 | **移行済み**（TTL キャッシュ・worktree のジョブ共有・/jobs/workspaces の動的 worktree 列挙含む） |
| `/recent-jobs`（settings.py 内） | — | **移行済み**（Phase 1 保留分を解禁） |
| `job_match.py` | 112 | **移行済み**（`server/src/job_match.rs`。`agent_watch.rs` の前面ジョブ argv 照合から利用中） |
| `routers/job_runner.py` | 131 | Phase 5（ターミナル依存） |
| `routers/dispatch.py`（承認キュー・dedup・dispatch scope トークン） | 651 | Phase 5（ターミナル依存） |
| `routers/pairing.py`（QR ペアリング・短命トークン） | 277 | **移行済み**（`server/src/pairing.rs`。認証ドメインの atomic cutover に含めて配線 — 下記参照） |

**ジョブキャッシュの補足**: Python 側は TTL 60 秒のキャッシュを持ち、Rust の
書き込みを即時無効化はできないが、TTL 以内に必ず再読込されるため staleness の
上限は移行前と同じ（Python 内部でも他プロセス書き込みは TTL 待ちだった）。

**注意**: dispatch はキュー JSON の互換とステータスストリームへのスナップショット配信（Phase 4 と接続）が要。dispatch トークンの権限境界（direct: true 拒否）はセキュリティ要件なのでテストを厚く移植する。

### Phase 4 — リアルタイム系（WebSocket / FS 監視 / ポーリング）— **移行済み（status stream WS 本番切替完了）**

**目的**: status stream ソケットに相乗りする監視系一式。ここから難度が上がる。

**完了**: `/workspaces/statuses/ws` を Python proxy から Rust ネイティブ実装
（`status_stream::status_stream_ws`）へ本番切替済み。git_watch の FS 監視
ループ（`notify` + debounce 300ms）・agent_watch のポーリングループ（2秒間隔）・
dispatch のネイティブ配信（`broadcast_current_queue`）をすべて実装し、
単一の `tokio::sync::broadcast` channel（`StatusStreamState`）へ統合した
（Python 版の 4 モジュール個別購読者 set + `call_soon_threadsafe` 方式より
簡素化）。Rust front + Python upstream の二重構成で E2E スイート全体を実行し、
環境依存の既知失敗（`preview.spec.js`）以外は全通過を確認済み。
Python 側の bridge 呼び出し（`nudge_git` / `notify_session_event` /
`broadcast_dispatch_queue`）は Phase 6（Python 撤去）まで並行稼働のまま残す
（無害な二重配信）。

**状況**: ポーリング系のスライス（workspaces ルーター本体 + git_info パイプライン +
プロセス間 nudge ブリッジ）を移行済み:

- `workspaces.rs`: GET /workspaces（サマリ並列取得・workspace_order ソート・
  動的 worktree 列挙・background fetch 並列 4）/ GET /workspaces/statuses /
  POST・DELETE /workspaces / PUT /workspaces/{name}/config / GET /workspaces/suggest。
  サマリのパス判定が expanduser しない挙動もバグ互換で維持
- `git_info.rs`: 11 の git クエリを並列実行し branch / upstream / ahead-behind /
  diff 統計を集約。5 秒 TTL キャッシュ + 計算中 invalidate の世代ガード（Python と同一設計）
- `api/routers/migration_bridge.py`（**Python 側に新設・移行完了時に削除**）:
  loopback 限定 `POST /internal/git-nudge`。Rust の git 操作・ワークスペース変更から
  Python 側 status stream（git_watch）への即時 push を復元する
- `config.rs` に save/delete_workspace_config（flock 下 read-modify-write、
  workspace_order の掃除含む）を追加

| 対象 | 行数目安 | 状況 |
|------|---------|------|
| `routers/workspaces.py` 本体 + `git_info.py` + background_fetch | 660 | **移行済み** |
| `ws_broadcast.py` / `routers/status_stream.py` | 141 | **移行済み**（`server/src/status_stream.rs` — WS エンドポイント本番配線済み） |
| `git_watch.py`（watchfiles → notify、自動 fetch） | 433 | **移行済み**（`server/src/git_watch.rs` — FS 監視ループ・自動 fetch ループとも本番稼働） |
| `session_watch.py` | 74 | **移行済み**（`server/src/session_watch.rs`。`terminal_session.rs`/`terminal.rs`/`dispatch.rs`/`job_runner.rs` から配線済み） |
| `agent_watch.py`（3値状態判定・自動紐付け） | 584 | **移行済み**（`server/src/agent_watch.rs` — ポーリングループ本体・push 連携とも本番稼働） |
| `screen_manifest.py` + `agent_manifests/`（herdr ルール） | 562 | **移行済み**（`server/src/screen_manifest.rs`。`agent_watch.rs` から利用中） |
| `manifest_update.py`（リモートマニフェスト更新） | 272 | **一部移行済み**（`server/src/manifest_update.rs` — 検証ロジックのみ。定期実行ループは未移植・Python 側の `start_updater` が稼働中のため配線しない。下記注意参照） |
| `agent_hooks.py` + `routers/agent_hooks.py` | 180 | **移行済み**（`server/src/agent_hooks.rs`。`POST /agent-hooks/events` を `build_router` に配線済み。Python 側 agent_watch ポーリングが status stream 切替により恒久休眠したため配線可能になった） |
| `foreground.py`（/proc・ps の前面 argv 検査） | 176 | **移行済み**（`server/src/foreground.rs`。`agent_watch.rs` から利用中） |
| `routers/preview.py` + `preview.py`（dev server 検出 + proxy） | 563 | **移行済み**（`server/src/preview.rs`。配線済み） |

**注意**:
- git_watch は「購読者ゼロで全停止」のライフサイクル管理が肝。tokio の task 管理で等価に
- foreground.py の Linux(/proc) / macOS(ps) 二系統分岐はそのまま移植（クロスプラットフォーム一級サポートの方針）
- 状態判定の優先順位（hooks > manifest > 画面差分）はロジック単体テストを先に移植してから配線する
- `foreground.rs` / `job_match.rs` / `agent_hooks.rs` / `screen_manifest.rs` は
  agent_watch より先に単体（ロジック・TOML パース・TTL キャッシュ）で完成させた。
  `agent_hooks.rs` の `POST /agent-hooks/events` ハンドラは当初、Python の
  `agent_watch.py` ポーリングループが同一プロセス内メモリの `_hook_states` dict を
  直接参照している間は `build_router` に配線しない方針だった（Rust が先取りすると
  Rust 側の状態に記録される一方で Python 側の `_hook_states` は永久に空のままとなり、
  hooks 優先度のフォールバック（hooks > manifest > 画面差分）が機能しなくなる —
  ターミナルの pending_text で踏んだのと同型のクロスプロセス不整合）。
  Phase 4 完了で `/workspaces/statuses/ws` が Rust ネイティブに切り替わり、
  Python の `agent_watch.py` は WS 購読者を得られず `_poll_task` が永久に起動
  しなくなった（`ensure_phrase_task` は `subscribe()` からしか呼ばれず、
  その `subscribe()` 自体が Python 側の同エンドポイントの中でしか呼ばれないため）
  ことを確認した上で配線した
- `screen_manifest.rs` の `\x{...}` 波括弧 hex エスケープ・`\p{Alphabetic}`
  Unicode プロパティは Rust `regex` クレートがネイティブ対応するため、Python 版の
  `translate_rust_regex()`（Rust regex 記法 → Python `re` 変換）に相当する処理は
  不要（同梱 21 マニフェスト全件のコンパイル成功をテストで確認済み）
- `git_watch.rs` は監視対象の収集（`collect_watch_targets` — 登録済みワークスペース
  + 動的 worktree、実 git リポジトリでの統合テスト込み）に加え、FS 監視ループ本体
  （`watch_loop` — `notify` + `notify-debouncer-full`、デバウンス 300ms）・
  タスクライフサイクル管理（`ensure_tasks`/`maybe_stop_tasks` — 購読者ゼロで
  `JoinHandle::abort()`）・自動 fetch ループ（`auto_fetch_loop` — 180秒間隔、
  並列度 4）・`nudge_workspace`（git 操作直後の即時 push）まで実装済み。
  実 git リポジトリへのファイル書き込みで FS イベントが検知されることを
  統合テスト（`test_status_stream.rs`）で確認済み
- `agent_watch.rs`: `tmux.rs` に `list_session_ids`/`list_pane_meta` を追加した
  上で、ポーリング1周期分の判定を丸ごと行う `collect_agent_states` を実装し、
  これを 2 秒間隔で回す `poll_loop`（`ensure_tasks`/`maybe_stop_tasks` による
  ライフサイクル管理・push 通知連携込み）まで実装済み（tmux 一括問い合わせ →
  hooks 優先の状態判定 → 未紐付けセッションの cwd 照合によるワークスペース
  自動紐付け・前面ジョブ argv 照合によるジョブ自動タグ付け（いずれも
  `TerminalSession` への書き戻し + `session_watch.rs` 経由の `StatusStreamState`
  配信込み）→ notify_phrase の猶予判定・`state.proxy.send_push` 経由の push 配信）。
  実 tmux セッション（linked worktree・前面 `sleep` プロセスでのジョブ照合含む）
  での統合テスト済み。`AppState` に `screen_manifest::ManifestStore` を追加し、
  manifest 階層解決の TTL キャッシュをアプリ全体で共有する
- `status_stream.rs` / `session_watch.rs`: Python 版は git_watch/agent_watch/
  session_watch/dispatch がそれぞれモジュールローカルな購読者 set を持ち、
  `call_soon_threadsafe` 経由でイベントループへスケジュールしてから fan-out する
  設計だった（同期ハンドラの threadpool から呼ばれるため）。Rust 版は `AppState`
  が保持する単一の `tokio::sync::broadcast` channel（`StatusStreamState`）へ
  全プロデューサが直接 `send()` するだけでよく、スレッドセーフなスケジューリングも
  購読者数管理（`receiver_count()`）も broadcast channel が元々備えているため、
  モジュールごとの購読者 set 管理は不要にした（Python 版からの単純化）。
  `session_watch.rs` はこの基盤の上にセッション作成・削除・自動紐付けの通知
  ペイロードを実装し、`terminal_session.rs` のセッション作成・`terminal.rs` の
  削除ハンドラ・`job_runner.rs` のジョブセッション作成・`dispatch.rs` の
  セッション作成ヘルパーから配線済み。`/workspaces/statuses/ws` を
  `status_stream::status_stream_ws` へ配線し（`lib.rs`）、接続時に
  `git_watch::ensure_tasks` / `agent_watch::ensure_tasks` を起動・切断時に
  `maybe_stop_tasks` で停止する構成で本番稼働している
- `manifest_update.rs` はカタログ・マニフェストの取得検証とコミット判定
  （純粋ロジック + reqwest 経由の fetch）のみ移植した。Python 側の
  `start_updater`/`stop_updater`（`AGENT_MANIFEST_UPDATE_STARTUP_DELAY_SEC` 後に
  開始し `AGENT_MANIFEST_UPDATE_INTERVAL_SEC` ごとに実行する定期タスク）は
  まだ稼働中のため、Rust 側の定期実行ループはあえて実装・起動しない —
  両実装が同時に herdr.dev を叩いて `data/agent-detection/remote/` へ
  二重に書き込むと、ファイル rename の競合や意図しない version 判定になり得る。
  agent_watch 一式を配線するタイミングで Python 側の `start_updater` 呼び出しを
  停止しつつ Rust 側のループを起動する一括切替が必要

### Phase 5 — ターミナル（最難関・最後に最大の注意で）— **配線完了（terminal/run/dispatch）**

**目的**: 製品の心臓部。pty × tmux × WebSocket の三つ巴で、pytest カバレッジ除外領域＝自動テストが最も薄い。

**状況**: 最もリスクの高い OS プリミティブ（PTY fork/exec と tmux セッション制御）、
その上に乗るセッションレジストリ、`routers/terminal.py`・`job_runner.py`・
`dispatch.py` 相当の HTTP + WS ルート一式を実装し、`build_router` へ一括配線した
（下記「重要な設計判断」の通り、この3つはプロセス間の pending_text 不整合を
避けるため同時配線が必須だった）。実 tmux での統合テスト（cargo test）に加え、
本番相当の Rust front + Python upstream 二重構成での実機スモーク（dispatch →
セッション作成 → WS 接続 → pending text flush の一連が実際に動作すること、
Python 側ブリッジへの到達を python.log で確認）、および `ANY_CONSOLE_URL` を
Rust front に向けた Playwright 全 E2E スペックで検証済み。

- `pty.rs`: `nix::pty::forkpty`（glibc `forkpty(3)` = openpty+fork+login_tty を1ステップ
  で行う。CPython の `os.forkpty()` と同じ土台）で PTY 上に子プロセスを fork+exec する。
  fork 後の子プロセス分岐は execve 呼び出しまで一切のメモリ確保を行わない
  （argv/envp の `CString` 化・`PATH` 探索は fork **前**に完了させる — マルチスレッド
  プロセスの fork 直後にアロケータのロックを取ろうとして永久ブロックする既知の踏み穴を
  避けるため）。読み取りは `tokio::io::unix::AsyncFd` で non-blocking fd を async 化
  （Python の `PTY_EXECUTOR` スレッドプールに対する epoll ベースの代替。外部から見た
  挙動は同一）。EIO（tmux セッション終了時に PTY マスタから返る）は EOF として扱う。
  `terminate(pid)` で fd クローズと signal 送出を分離し、`Arc<AsyncPty>` を複数箇所
  （reader task・ClientBridge）が安全に共有できるようにした
- `tmux.rs`: セッション作成（`systemd-run --user --scope --quiet` 優先 → プレーン
  `tmux` へフォールバック）、PTY 経由のアタッチ（`attach_tmux_session`）、
  メタデータの読み書き（tmux 環境変数 = `set-environment`/`show-environment`。
  `TMUX_PENDING_TEXT`/`TMUX_PENDING_ENTER` も読み取り対象に含む — 後述）、
  ペイン状態問い合わせ（capture-pane・display-message 各種）を移行。hook 用環境変数
  （`ANY_CONSOLE_HOOK_URL`/`_TOKEN`）の組み立ても含む（`data/hook_token` は
  Python の `agent_hooks.get_hook_token` と同一ファイル・同一 best-effort 挙動）
- `config.rs` に `match_workspace_by_path`（最長前方一致でのワークスペース自動判定。
  tmux アタッチ時の workspace 検出に使う）を追加
- `terminal_session.rs`: `TerminalSession`（tmux ベースセッション1つ = 1シェル）と
  `ClientBridge`（WS クライアント1接続 = 1 tmux アタッチ）、レジストリ
  `TerminalRegistry`（`Arc<Mutex<TerminalSession>>` ごとの粒度でロック — セッション
  単位の同時実行を registry 全体のロックで塞がない）。WebSocket/axum には依存せず、
  PTY からの読み取りは `mpsc::UnboundedSender<PtyEvent>` へ流すだけに留める（実際の
  WS 送受信は router 側の責務として分離）
  - `create_registered_session`: 容量チェック（`MAX_TERMINAL_SESSIONS`=20）→ ID 生成
    → tmux 作成 → 登録 → メタデータ保存。workspace 名からの ID 生成は動的 worktree
    表示名からベース名を剥がす（`worktree_base_of`、`git_utils.rs` に追加）
  - `get_or_register`: レジストリ未登録でも tmux 実在確認 → 環境変数からのメタデータ
    復元で on-demand 登録する（`from_tmux`）。これにより「別プロセスが作成した
    tmux セッション」も透過的に解決できる（tmux 自体が永続化層のため）
- `terminal.rs`: `routers/terminal.py` の HTTP 全エンドポイント（sessions 一覧・history
  capture（複数クライアント接続中の resize-window 抑止ロジック込み）・削除・cwd・
  files/file-content（`git_files.rs` の `list_directory_entries`/
  `read_file_content_response` を `pub(crate)` 化して再利用）・workspace/detached
  更新・tab order）とネイティブ WS ハンドラ（axum の `WebSocketUpgrade` を直接処理 —
  初めて proxy を経由しない WS エンドポイント）を移行。WS 接続後に
  `TMUX_PENDING_TEXT`/`_ENTER`（後述）を flush する処理も含む
- `job_runner.rs`: `POST /run`（`[[var]]` プレースホルダ置換 — `shlex.quote` 互換の
  シェルクォート含む・コメント行除去・NUL 拒否・自動実行コマンドの send-keys）を移行
- `dispatch.rs`: `POST /dispatch`・`/dispatch/{id}/decision`・`/dispatch/{id}/rerun`
  を移行。承認待ちキュー（`_PENDING`/`_RECENT` 相当）は `DispatchState`（`AppState`
  に保持）で管理し、`dispatch_queue.json`/`dispatch_recent.json`（Python と同一の
  legacy パス規則 — `ANY_CONSOLE_DATA_DIR` 未指定時は `PROJECT_ROOT` 直下）へ永続化。
  起動時に読み込んで Python 側 status stream（ブリッジ経由・Phase 4 完了後は
  実際には到達しない）へ初期スナップショットを送る
  （`load_persisted_and_seed_bridge`、`main.rs` から起動時に一度だけ呼ぶ）。
  `dispatch()`（HTTP ハンドラ）は認証確定後の本体を `dispatch_core` へ切り出し、
  `dispatch_rerun` の「承認キューを経由せず実行」以外の分岐から関数呼び出しで
  再利用する（Python 版が `dispatch(req, (auth_label, False))` と直接呼んでいたのと
  同じ構造）。dispatch scope の API トークン認証はメイン/Tailscale/デバイス認証が
  Rust 側で失敗した場合のみ Python へブリッジする

**重要な設計判断（後続作業のために記録）**: `/dispatch`（`routers/dispatch.py`）は
`create_registered_session` で作成した `TerminalSession` に `pending_text`
（承認された text をクライアント接続後に送る仕組み）をインメモリで持たせていた。
ターミナル WS がプロセス分離されると、この状態は生成元プロセスにしか見えないため
**`/run`・`/dispatch` はターミナル WS 移行と同時に移行しなければならない**
（`_find_existing_session` の再利用判定も同様に、セッションレジストリを持つプロセスと
揃っていないと機能しない）。この対応として、pending text の永続化先を
インメモリフィールドから **tmux 環境変数**（`TMUX_PENDING_TEXT`/`TMUX_PENDING_ENTER`）
へ変更した（`dispatch.rs` 実装時に同様に設定する）。tmux 自体が永続化層になるため、
どちらの言語がセッションを作った/WS が誰に繋がったかに依存せず安全に受け渡せる。

push 通知（VAPID/RFC 8291）・dispatch scope の API トークン検証は、当初 Python 側への
loopback ブリッジで当面つないでいたが、いずれもその後ネイティブ移行済み（下記
「push.py」節・「認証ドメイン」節を参照）。dispatch キューの
ステータスストリーム配信（`type="dispatch_queue"`）は Phase 4 完了により
`state.status_stream.broadcast()` でネイティブ配信されるようになったが、下記の
ブリッジ呼び出しは Phase 6（Python 撤去）まで無害な二重配信として残す
（`/workspaces/statuses/ws` が Rust ネイティブに切り替わったため、Python 側の
`ws_broadcast`/`status_stream`/`git_watch`/`agent_watch` には実接続者がおらず、
以下のブリッジ先エンドポイントの一部は実質到達しても効果を持たない）:
- `POST /internal/session-event`（Rust→Python）: ターミナルセッションの作成/削除を
  session_watch へ即時反映（削除時は `agent_hooks.clear_session` も呼ぶ）。
  Rust 側は `session_watch.rs` 経由のネイティブ配信で同等の通知を行うため実質冗長
- `POST /internal/dispatch-queue`（Rust→Python）: dispatch キューの全量スナップ
  ショットを Python 側 status stream WS 購読者へ中継しようとするが、実接続者が
  いないため到達しても無意味。`routers/dispatch.py` 側の `set_bridged_payload`
  受け入れコード自体は削除していない
- `POST /internal/verify-dispatch-api-token`（Rust→Python）: 既存の
  `auth._verify_api_token`（auth.json の api_tokens 配列照合）を再利用する。
  メイン/Tailscale/デバイス認証は Rust の `Auth.authenticate()` で完結するため、
  このブリッジは「どれにも該当しなかった場合」だけ呼ばれる
- `agent_watch.py` は `TERMINAL_SESSIONS` のインメモリキャッシュがヒットしなければ
  tmux 環境変数へ直接フォールバックする既存の設計（cache-miss 時は
  `_run_tmux_cmd`/`load_tmux_metadata` を直接叩く）のおかげで、Rust がレジストリを
  持つようになっても変更不要で動き続けることを確認した（コード調査のみ、実装変更なし）

| 対象 | 行数目安 | 状況 |
|------|---------|------|
| `tmux.py` | 259 | **移行済み**（`server/src/tmux.rs`） |
| `terminal_pty.py`（forkpty / read / resize / close） | 77 | **移行済み**（`server/src/pty.rs`） |
| `terminal_session.py`（ClientBridge・マルチクライアントアタッチ） | 375 | **移行済み**（`server/src/terminal_session.rs`） |
| `routers/terminal.py` | 416 | **移行済み**（`server/src/terminal.rs`。配線済み） |
| `routers/job_runner.py`（`/run`） | 131 | **移行済み**（`server/src/job_runner.rs`。配線済み） |
| `routers/dispatch.py` | 651 | **移行済み**（`server/src/dispatch.rs`。配線済み） |
| `push.py`（VAPID / Web Push） | 180 | **移行済み**（`server/src/push.rs`。下記「push.py」節参照） |

Python 側の `routers/terminal.py`・`routers/job_runner.py`・`routers/dispatch.py`・
`terminal_session.py`・`tmux.py`（create/attach 系）・`terminal_pty.py` は
**削除していない**（このリポジトリの既存方針 — Rust 側が同じパスを `build_router`
で先取りするため実トラフィックはもう到達しないが、ロールバック時の安全網として
Phase 6（Python 撤去）まで残す）。`main.py` の `app.include_router(...)` も変更していない。

**注意**:
- tmux の `window-size latest` ポリシー・複数クライアント同時アタッチ・detached セッション（adopt/close）の E2E（`terminal.spec.js` / `detached-sessions.spec.js` / `mobile-terminal.spec.js`）を macOS / Linux 両方で回す
- 配線（`build_router` への登録）は `terminal.rs`（WS 含む）+ `/run`/`/dispatch` を一括して行った（上記の pending_text 不整合を避けるため）
- 実機スモーク（iOS Safari / Android Chrome）は継続してウォッチする（このセッションでは Linux コンテナ内の自動テスト + curl/websockets での手動検証まで実施）

### dev server ポートプレビュー（`preview.py`）— **移行済み**

**状況**: ポートスキャン（Linux `ss -ltnp` / macOS `lsof -iTCP -sTCP:LISTEN`）・
プロセス情報取得（cmdline/cwd、Linux は `/proc`、macOS は `ps`/`lsof`）・
workspace 自動紐付け（`ConfigStore::match_workspace_by_path` を再利用）・
TCP/TLS proxy（`target + 20000` へ listen、Tailscale IP からもアクセス可能）・
HTTP プローブ（非 HTTP upstream の除外）・idle 連動のバックグラウンドスキャン
まで `server/src/preview.rs` へ移植し、`GET /preview/ports` を `build_router`
へ配線済み。TLS 終端は `tokio-rustls` + `rustls-pemfile`（`SSL_CERTFILE`/
`SSL_KEYFILE` または `certs/*.crt`+`.key` を探索 — Python 版と同じ規則）。

- Python の `_scan_listening_ports_linux`/`_macos` の出力パース部分は純粋関数
  （`parse_ss_listen_lines`/`parse_lsof_listeners`）に切り出し、Python 側テスト
  と同じ固定出力フィクスチャで検証した
- OS 分岐は `system.rs` の `IS_DARWIN` と同じ規約（`const IS_MACOS: bool =
  cfg!(target_os = "macos")` による実行時 if 分岐）を踏襲し、両ブランチが
  どちらの OS でもコンパイル・テストできるようにした（`#[cfg(target_os)]`
  による条件コンパイルは使わない）
- `main.rs` は自分自身の bind ポートに加え、`ANY_CONSOLE_UPSTREAM` が
  loopback を指している場合はその Python upstream のポートも self_ports に
  含める（移行期間中に自分自身が dev server として誤検出されるのを防ぐ）
- `ss` が使えない実行環境（このセッションのコンテナ含む）ではスキャンが
  空振りするだけで例外にはならないこと、実バイナリでの起動 + `curl` による
  `/preview/ports` 疎通（401 without auth / 200 `[]` with auth）を確認済み

### 認証ドメイン（devices / api_tokens / pairing / auth.json）— **移行済み**

**状況**: `routers/devices.py` + `devices.py`（デバイス cookie 認証の登録・一覧・
失効・自動登録）、`auth.py` の API トークン CRUD 部分 + `routers/api_tokens.py`、
`routers/pairing.py`（QR ペアリング）、`main.py` に直書きされていた
`/auth/check`・`/auth/logout`、`routers/settings.py` の `/settings/auth`
（メイントークンのローテーション）を、`server/src/devices.rs` /
`server/src/auth.rs`（拡張）/ `server/src/pairing.rs` へ移植し、
`/devices/*`・`/api-tokens/*`・`/auth/pairing/*`・`/auth/check`・`/auth/logout`・
`/settings/auth` を**同時に** `build_router` へ配線した。

**設計判断（atomic cutover）**: devices.json / auth.json への書き込みは
config.json と異なり Python 側に fcntl ファイルロックが無い（プロセス内
`threading.Lock` のみ）。Rust 側にも fcntl ロックを追加で持ち込む代わりに、
これらのファイルに触れる**全ルートを一括で** Rust ネイティブへ切り替え、
Python 側の対応コードパスを配線と同時に永久に到達不能にした
（terminal/dispatch/job_runner — Phase 5 — で既に確立したパターンと同じ）。
これにより Python/Rust 両プロセスが同じファイルへ read-modify-write する
瞬間が原理的に存在しなくなり、排他はプロセス内 `Mutex`（`DevicesState`/
`Auth` が持つ）だけで十分になった。

**実装のポイント**:

- `devices.rs`: `DevicesState`（`devices_lock` + `server_key_lock` の2本の
  `Mutex`）を `Auth` 構造体へ内包する設計にした。新たに `AppState` へ
  トップレベルフィールドを追加すると `Auth::authenticate()` の公開シグネチャ
  が変わり既存呼び出し箇所（テスト含む）へ波及するため、代わりに
  `Auth::devices()` / `Auth::data_dir()` というアクセサを増やして
  `devices.rs`/`pairing.rs`/API トークンハンドラから触れるようにした
- `hash_secret`（HMAC-SHA256、鍵は `data/server_key`）は devices・API トークン
  共通のロジックとして `devices.rs` 側に実装し、`auth.rs` はそれを呼ぶだけに
  した（Python 版でも `auth.py` が `devices.py` の `_hash_secret` を再利用して
  いたのと同じ構造）
- cookie の `Secure` 属性は常に `false` を返す実装にした。本番運用は
  Tailscale Serve が外部で TLS を終端し plain HTTP でこのプロセスへ転送する
  構成（README のセットアップ手順）で、`python3 -m api.main` の実運用起動も
  `--proxy-headers` を渡さないため、`request.url.scheme` は本番で常に
  `"http"` になる（Python 版の実際の挙動そのもの）。`--proxy-headers` は
  本ドキュメントの Phase 0 手動デュアルプロセス検証手順にのみ登場し、
  実運用では使われない
- QR ペアリングの URL 組み立て（`pairing.rs`）は MagicDNS 名解決を
  `subprocess.rs` の `run_tailscale_json` に委譲し、bind が loopback 専用の
  場合・発行元自身が loopback からアクセスしている場合のガードを
  Python 版と同一のロジックで再現した
- dispatch scope API トークンの検証（`POST /dispatch` 専用）は、それまで
  Python 側 `_verify_api_token` への loopback ブリッジ
  （`/internal/verify-dispatch-api-token`）経由だったが、`Auth::verify_api_token`
  がネイティブに使えるようになったため `dispatch.rs` の呼び出し先を差し替え、
  ブリッジ自体（`migration_bridge.py` 側のエンドポイントと
  `Proxy::verify_dispatch_api_token`/`Proxy::touch_device`）を削除した
- 旧 `maybe_touch_device`（Rust 側デバイス cookie 認証成功時に Python の
  devices.json last_seen_at をブリッジ経由でスロットリング更新していた仕組み。
  これ自体がこの移行より前のセッションで追加された一時しのぎ）も削除した。
  今は `devices::verify_and_touch_device` が devices.json を直接
  read-modify-write するため、ブリッジ往復自体が不要になった
- CI の `e2e-rust-front` ジョブ相当（Python upstream + Rust front の
  2プロセス構成で `tests/e2e/api-contract.spec.js` を Rust front 経由で実行）
  をローカルでも再現して確認した。`/auth/check`・`/auth/logout`・
  `/devices/*`・`/api-tokens/*`・`/settings/auth`・`/auth/pairing/start`
  を curl で疎通確認した上で、api-contract.spec.js の 10 ケース全てが
  Rust front 経由で成功することを確認済み

### push.py（VAPID / Web Push）— **移行済み**

**状況**: `push.py`（VAPID 鍵管理・購読 CRUD・RFC 8291 `aes128gcm` 暗号化・
プッシュ送信）を `server/src/push.rs` へ移植し、`GET /push/vapid-public-key`・
`POST /push/subscribe`・`DELETE /push/subscribe` を `build_router` へ配線した。
`migration_bridge.py` の `POST /internal/send-push`（Rust→Python ブリッジ）は
不要になったため削除した。

**設計判断（`web-push` crate を採用しなかった理由）**: `cargo add web-push`
で入る v0.11 は内部で `isahc`（`reqwest` とは別の HTTP クライアントスタック）
と `ece` crate に依存し、`ece` は RustCrypto 実装を持たず `openssl-sys` 必須の
`backend-openssl` feature しか無い（`cargo tree`/`cargo add --dry-run` で確認）。
本プロジェクトは Phase 6 で Linux x86_64/aarch64・macOS arm64/x86_64 向けに
クロスコンパイルする方針（OpenSSL 依存はクロスビルドの障害になりやすい）のため、
`web-push` は不採用にし、RFC 8291（メッセージ暗号化）・RFC 8292（VAPID JWT）を
RustCrypto ファミリ（`p256` / `aes-gcm` / `hkdf` / `hmac` / `sha2`）で
直接実装した。

**実装のポイント**:

- 鍵導出チェイン（ECDH → HKDF-Extract → HKDF-Expand → HKDF-Extract →
  HKDF-Expand → CEK/NONCE）は IETF 草稿
  （`webpush-wg/webpush-encryption`）Appendix A の中間値と完全一致することを
  ユニットテストで確認済み（`rfc8291_key_derivation_matches_appendix_a_intermediate_values`）。
  RFC 本文（rfc-editor.org / datatracker.ietf.org）はこの環境の egress proxy
  でブロックされていたため、GitHub 上の同一原文（raw.githubusercontent.com）
  を参照した
- VAPID 鍵ファイル形式は Python（`cryptography` ライブラリ）が書き出す
  ものと完全互換にした（秘密鍵 = 32byte 生の big-endian スカラー、公開鍵 =
  65byte 非圧縮 SEC1 point、いずれも base64url no-pad）。これにより移行時に
  ブラウザ側の再購読（re-subscribe）を強制せずに済む（既存
  `vapid_private.txt`/`vapid_public.txt` をそのまま Rust が読む）
- Origin ヘッダから vapid sub（`mailto:` の代わりに使う識別 URL）を検出する
  正規表現 `re.match(r"(https?://[^/:]+)", origin)`（ポート番号を意図的に
  除外）は正規表現クレートを追加せず手書きの文字列パースで再現した
- push 送信はダイレクトなプロセス内呼び出しに変更し、呼び出し元
  （`dispatch.rs`・`agent_watch.rs`）では `tokio::spawn` で fire-and-forget
  にすることで、旧 `Proxy::send_push`（これも内部で spawn して即返す実装
  だった）と同じノンブロッキング特性を維持した
- **`api/main.py` の `lifespan()` から `init_vapid()` / `ensure_phrase_task()`
  の呼び出しを削除した**（このセッションで唯一 Python 側コードへ直接手を
  入れた変更）。この2つはルート配線ではなくプロセス起動時に無条件で走る
  処理のため、atomic cutover（ルートの配線でコードパスを到達不能にする
  パターン）では防げなかった。特に `ensure_phrase_task()` は
  `has_subscriptions()` が true なら Python 側でも独立した agent_watch
  ポーリングループを起動してしまい、Rust が購読を書くようになった後は
  常に true になる → push 通知の二重送信と `push_subscriptions.json` への
  同時書き込みという実害が出るバグだったため、コード読み込みで発見し
  そのまま削除した
- CI の `e2e-rust-front` ジョブ相当（Python upstream + Rust front の
  2プロセス構成）を手元で再現し、`/push/vapid-public-key`・
  `/push/subscribe` の疎通と `api-contract.spec.js` 10 ケース全成功を確認。
  実際のプッシュサービスへの配信確認はこのサンドボックスでは検証できない
  ため、モック push サービスへの実送信（暗号化ペイロードが `aes128gcm`
  content-coding・VAPID JWT 付き Authorization ヘッダで届くこと）を
  `server/tests/test_dispatch.rs` の統合テストで代替検証した

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
