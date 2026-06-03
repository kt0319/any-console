# Architecture Decisions

このドキュメントは any-console の主要な設計判断と、その背景にある理由を記録する。

## フォーマット

各エントリは以下のテンプレートで記述する:

### N. タイトル

- **Status**: Accepted / Superseded / Deprecated
- **Date**: YYYY-MM
- **Context**: なぜこの判断が必要だったか
- **Decision**: 何を決めたか
- **Consequences**: この決定の利点と代償
- **Alternatives considered**: 検討して却下した選択肢

---

### 1. 単一プロセスのみの採用

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: ターミナルセッション・レートリミッタ・TTL キャッシュをプロセス内 state に持つ設計のため、複数ワーカーでは state が分断される。
- **Decision**: `_acquire_singleton_lock` により `uvicorn --workers > 1` を起動時に拒否する。
- **Consequences**: 水平スケールは不可能。ただし pty/tmux はホストローカルなリソースであり、そもそも複数プロセスでの共有は不可能。個人ツールとして問題なし。
- **Alternatives considered**: Redis 等の外部 state ストアで state を共有 → 運用コストが個人ツールの用途に見合わない。

---

### 2. Git 操作は subprocess のみ、ライブラリ不使用

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: Git 操作の実装方針として、Python バインディングライブラリを使うか subprocess で git CLI を直接呼ぶかを選択する必要があった。
- **Decision**: GitPython・pygit2 等を使わず、subprocess で git コマンドを直接呼び出す。
- **Consequences**: 依存を最小限に保てる。git 本体の挙動と完全一致し、git のアップデートに自動追従する。subprocess 呼び出しのオーバーヘッドは対話的ツールとして許容範囲。
- **Alternatives considered**: GitPython — 依存追加かつ git 本体と挙動が微妙にずれる場合がある。pygit2 (libgit2) — ビルド依存が増える。

---

### 3. 認証は単一 Bearer Token、ユーザー分離なし

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: 個人ツールとして設計されており、複数ユーザーによる同時利用は想定していない。
- **Decision**: 単一トークンで HTTP / WebSocket 両方を保護する。user 概念・セッション管理・ロール管理は持たない。
- **Consequences**: マルチユーザー運用は不可。設計がシンプルで実装・審査コストが低い。Tailscale 等の閉域ネットワーク前提では認証自体を無効化できる。
- **Alternatives considered**: OAuth / OIDC — 過剰。ユーザーテーブル + セッション管理 — 個人ツールには不要な複雑性。

---

### 4. tmux × pty.fork × WebSocket ブリッジを自前実装

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: ブラウザ上でターミナルを提供する方法として、既存 OSS の統合か自前実装かを選ぶ必要があった。
- **Decision**: WeTTY / GoTTY を採用せず、薄いブリッジ層を自前実装する。
- **Consequences**: 永続セッション・フリック入力・他 UI との統合が自由に実現できる。実装・保守コストはかかるが、製品の中核なので妥当。
- **Alternatives considered**: WeTTY / GoTTY の統合 — ターミナル以外の機能（Git UI・ジョブランナー）との統合が困難。製品の境界線が外部ツールに依存する。

---

### 5. モバイルファースト UI

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: スマホから開発操作を行うことが主要ユースケース。PC でも同等の機能を提供したい。
- **Decision**: モバイルを基準に設計し、広い画面では情報密度を上げる方向で PC にも対応する。独自フリック入力キーボードを実装し、44px タップターゲット規約を設ける。
- **Consequences**: PC ファーストのツールより UI 実装コストが高い。一方、スマホ体験が一級市民になる。
- **Alternatives considered**: PC ファースト + モバイル対応 — モバイル体験が二級になり、ツールのコアバリューが失われる。

---

### 6. ジョブ実行のデフォルトタイムアウト 300 秒

- **Status**: Accepted
- **Date**: 2024-06
- **Context**: subprocess でジョブを実行するため、無限に待ち続けるリスクがある。
- **Decision**: デフォルト 300 秒でタイムアウトし、ジョブごとに `timeout_sec` で上書き可能（上限 86400 秒）にする。
- **Consequences**: 長時間ジョブは `timeout_sec` の明示設定が必要。暴走プロセスを自動的に停止できる。
- **Alternatives considered**: タイムアウト無し — バックグラウンドでプロセスが残留するリスク。固定値のみ — 長時間ジョブへの対応ができない。

---

### 7. CLAUDE.md を主とし AGENTS.md は symlink

- **Status**: Accepted
- **Date**: 2024-12
- **Context**: AI コーディングエージェントが読む規約ファイルの命名が `CLAUDE.md`（Claude Code）と `AGENTS.md`（他ツール）で分かれている状況。
- **Decision**: `CLAUDE.md` を実体ファイルとし、`AGENTS.md` はそのシンボリックリンクにする。
- **Consequences**: どちらの命名規則にも対応しつつ、内容の二重管理を避けられる。
- **Alternatives considered**: 両方を実体ファイルにする — 内容の乖離が生じやすい。`AGENTS.md` のみにする — Claude Code が読めない。

---

### 8. Python 3.11+ を最低要件とする

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: Python のバージョン要件をどこに設定するかを決める必要があった。
- **Decision**: Python 3.11 以上を要件とする。
- **Consequences**: `tomllib` 標準化・`TaskGroup`・型ヒントの改善・パフォーマンス向上の恩恵を受けられる。古い環境への対応コストを払わなくて済む。個人ツールなので LTS 範囲であれば十分。
- **Alternatives considered**: 3.9 / 3.10 — 対応バージョンは広がるが、型ヒントの表現力と標準ライブラリの充実度で 3.11 が明確に優れる。

---

### 9. Vue 3 + Pinia + Vite の採用

- **Status**: Accepted
- **Date**: 2024-01
- **Context**: フロントエンドのフレームワーク・状態管理・ビルドツールを選定する必要があった。
- **Decision**: Vue 3 (Composition API) + Pinia + Vite を採用する。
- **Consequences**: Composition API による composable 分割でロジックの再利用がしやすい。Vite のビルド速度は開発ループを短縮する。React に比べ学習済みの技術スタックであるため選択。
- **Alternatives considered**: React — 個人的な慣れの問題で Vue を選択。Next.js / Nuxt — SSR 不要なため SPA で十分。

---

### 10. PWA (Service Worker + manifest) の採用

- **Status**: Accepted
- **Date**: 2025-05
- **Context**: モバイルファースト (ADR #5) の帰結として、ホーム画面への追加・standalone 表示・Tailscale 経由でのコールドスタート短縮が必要だった。
- **Decision**: `manifest.json` + `ui/sw.js` を採用。キャッシュ名は `any-console-{git-short-hash}` とし、ビルド時に vite.config.js が置換することでデプロイごとに自動で cache busting される。API リクエストは fetch ハンドラの bypass リストで除外し、network-first の対象外とする。
- **Consequences**: オフラインで動くのは静的アセットのみ（terminal / git / jobs はバックエンド必須）。API ルートを追加・変更した際は `ui/sw.js` の bypass リストも同時に更新しなければならない保守負担がある。
- **Alternatives considered**: PWA なし — モバイル UX が一段下がる (ブラウザの UI バーが常に表示される等)。Workbox 導入 — 個人ツールには設定コストが過剰。

---

### 11. git worktree を動的検出でワークスペースとして扱う

- **Status**: Accepted
- **Date**: 2026-05
- **Context**: 同一リポジトリで複数の作業（特に並行して走らせるエージェント）を干渉なく進めたい。clone を増やすとディスク・fetch コストとリポジトリ管理が煩雑になる。当初は worktree を config.json に登録する設計にしていたが、登録・削除のたびに config を書き換える運用コストと、config の worktree エントリが実ファイルシステムと乖離するリスクが問題になった。
- **Decision**: worktree を config.json に登録せず、各ワークスペースのベースリポジトリに対して `git worktree list --porcelain` を実行し実行時に動的検出する。ベースリポジトリから `git worktree add` で作業ツリーを作るだけでよく、config 操作は不要。表示名は `{ベース名} [{ブランチ名}]` 形式とし、バックエンドは `_WORKTREE_NAME_RE` でパースしてパスを解決する。ベースが config に未登録の孤立 worktree は worktree として扱わない（誤ったアイコン・動作を防ぐ）。worktree の作成・削除は Branches タブ（`GitChangeBranch.vue`）に統合し、専用タブは設けない。ジョブは config からではなくベースワークスペースのものを共有する。UI ではワークスペースピッカーとターミナルタブに worktree アイコン（`mdi-file-tree`）を表示する。
- **Consequences**: config とファイルシステムの乖離が起きない。worktree の追加・削除は git コマンドだけで完結する。作業ツリー＝ワークスペースなので、既存のステータスポーリング（dirty/branch/ahead）やタブの編集済みマークがそのまま各 worktree の進捗シグナルになる。ブランチは worktree 削除後も残す（成果を失わない）。`resolve_workspace_path` の解決ロジックが動的 worktree を考慮する必要がある。
- **Alternatives considered**: config.json に登録する（旧設計） — config が実ファイルシステムと乖離するリスクがある。clone を都度作る — ディスク・fetch コストと管理が重い。worktree を独自概念として別管理する — 既存のワークスペース機構（一覧・切替・ステータス）を再利用できず実装・UI が二重化する。

---

### 12. config スキーマのバージョニングと自動マイグレーション

- **Status**: Accepted
- **Date**: 2026-05
- **Context**: 本ツールは公開しており、利用者が任意のタイミングでコードを更新する。スキーマを変更した際、利用者の既存 `config.json` が新しいコードと噛み合わず壊れる懸念があった。フィールド追加は Pydantic のデフォルト値と `extra="allow"`（前方互換）でカバーできるが、フィールドのリネーム・削除・意味変更といった破壊的変更には、版を識別して変換する仕組みが必要だった。
- **Decision**: `__global__.config_version` にスキーマ版を保存し、コード側の `CONFIG_SCHEMA_VERSION`（`api/common.py`）を基準に `_read_config_unlocked()` の読み込み時へ自動マイグレーションを挟む。変換は `_CONFIG_MIGRATIONS`（版 N → N+1 の関数レジストリ）に登録し、現行版まで順次適用してから版を刻んで永続化する。空 config（初回起動）は何もしない。コードが対応する版より新しい config は、変換も再書き込みもせず警告のみ出して best-effort で動作する（誤った downgrade でデータを失わせない）。新しい版を検知した場合は `check_config_health()` が `__version__` エラーとして返し、フロントが起動時にトーストで「アプリを更新してください」と通知する。
- **Consequences**: 破壊的なスキーマ変更を入れても、利用者の古い config を起動時に無停止で移行できる。移行の追加は `_CONFIG_MIGRATIONS` に関数を足し `CONFIG_SCHEMA_VERSION` を上げるだけで済む。既存の workspace 名→ID 移行（`_migrate_workspace_keys_to_ids`）とは独立に動く。新しい版の config を古いコードで開くと一部設定が解釈できない可能性は残るが、破壊せず警告する方針で被害を最小化する。
- **Alternatives considered**: 版を持たず Pydantic のデフォルト＋`extra="allow"` のみに頼る — 追加方向には強いがリネーム・削除でサイレントにデータが失われる。config を読むたびに全フィールドを総当たりで補正する — 版がないと「いつ何を変換すべきか」を判断できず、冪等性とテスト容易性を損なう。

---

### 13. アクセシビリティの自動検査に axe-core を採用

- **Status**: Accepted
- **Date**: 2026-06
- **Context**: a11y はこれまで手動コードレビュー（`docs/A11Y_AUDIT.md`）のみで担保しており、ある時点のスナップショットに留まっていた。コンポーネントの追加・変更で ARIA・ロール・アクセシブルネームの欠落がサイレントに再混入するのを CI で継続的に防ぎたかった。
- **Decision**: `axe-core` を devDependency に追加し、既存の Vitest + happy-dom + @vue/test-utils 環境に統合する。共通ヘルパー `tests/ui/components/axe-helper.js` の `expectNoA11yViolations(element)` で、mount したコンポーネントを WCAG 2.0/2.1 の A・AA ルールで検査する。検査は `tests/ui/components/test_a11y.js` に置き、`npm run test:coverage`（CI）で毎回実行する。happy-dom はレイアウト・描画を持たないため `color-contrast` ルールは無効化する。`@axe-core/vue`（開発ランタイム専用で CI ゲートにならない）と Lighthouse（実ブラウザ・サーバ起動が必要）は採用しない。
- **Consequences**: 構造的な a11y 違反を CI で機械的に防げる。新規・変更コンポーネントはテストに1行追加するだけで担保対象に入る。導入時に PromptDialog の入力ラベル欠落・GitActionBtn のアクセシブルネーム欠落を検出・修正した。一方、色コントラストと実機スクリーンリーダー検証は自動化の対象外で、引き続き手動 / Lighthouse が担当する。検査対象は現状監査済みコンポーネントに限られ、網羅には `test_a11y.js` の段階的な拡張が必要。
- **Alternatives considered**: 手動監査のみ継続 — スナップショットで陳腐化し再混入を防げない。`@axe-core/vue` — 開発モードのランタイム警告のみで CI ゲートにならない。Lighthouse / Playwright + axe — 実ブラウザとサーバ起動が必要で、既存の happy-dom テスト基盤より重く CI コストが高い。

---

### 14. ターミナルのリサイズは ioctl(TIOCSWINSZ) に一本化する

- **Status**: Accepted
- **Date**: 2026-06
- **Context**: ターミナルのリサイズ処理が、attach した PTY の `ioctl(TIOCSWINSZ)` と `tmux resize-window` の両方を呼んでいた。tmux はデフォルト（`window-size latest`）では attach 中クライアントの PTY サイズに自動でウィンドウを追従させるため、そこへ明示的に `resize-window` を呼ぶとウィンドウが手動サイズモードに固定され、以後クライアントの実サイズ変更に追従しなくなる。結果として tmux 内部サイズとクライアント実サイズが乖離し、表示が崩れる（行折り返しの乱れ・残骸）原因になっていた。
- **Decision**: リサイズ経路では PTY の `ioctl(TIOCSWINSZ)` のみを呼び、明示的な `tmux resize-window` は呼ばない。tmux のネイティブなクライアント追従に委ねる。本ツールは「1 セッション = 1 tmux セッションに 1 クライアント attach」（attach 前に既存ブリッジを切る）構成のため、追従先は常に一意に定まる。`resize_pty` の ioctl は stale fd でのクラッシュを避けるため `OSError` を握りつぶす。
- **Consequences**: 二重リサイズによる手動サイズモード固定が起きず、表示崩れを防げる。リサイズ経路が ioctl 一箇所に集約され単純になる。一方、detached（誰も attach していない）セッションは作成時のデフォルトサイズ（80×24）のままで、サーバ側 `capture-pane` の整形が実クライアントサイズと一致しないケースは残る（attach 時に ioctl で是正される）。**この設計上、リサイズ経路に `tmux resize-window` を再追加してはならない（崩れが再発する）。**
- **Alternatives considered**: `window-size manual` を明示設定し ioctl + resize-window の両方を維持する — detached での固定サイズ保持や同一 tmux の複数クライアント共有が必要なら有効だが、本ツールの単一クライアント前提では過剰で、二重リサイズの整合管理コストが残る。`tmux resize-window` のみに統一する — クライアントの PTY サイズが追従せず、ウィンドウがクライアント PTY に収まらないと表示が破綻する。

