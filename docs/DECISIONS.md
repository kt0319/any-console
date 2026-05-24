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
