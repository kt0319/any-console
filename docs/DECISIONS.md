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

### 14. ターミナルのリサイズはサイズ変化時のみ ioctl + tmux resize-window を適用する

- **Status**: Superseded by 15
- **Date**: 2026-06
- **Context**: ターミナルのリサイズ処理が、attach した PTY の `ioctl(TIOCSWINSZ)` と `tmux resize-window` の両方を呼んでいた。フロントは入力のたびに（`onKey`→`sendResize`、差分ガードなし）resize メッセージを送るため、**同一サイズでも毎回 `tmux resize-window`（subprocess）が走り、ウィンドウ再描画を連打して表示が崩れていた**（行折り返しの乱れ・残骸）。当初これを「ioctl 一本化（resize-window を呼ばない）」で解消したが、ioctl(SIGWINCH) だけではウィンドウが追従しない環境があり（tmux の window-size 設定や状態に依存）、モバイル→PC のようにクライアントサイズが変わっても tmux ウィンドウがリサイズされない不具合が出た。崩れの真因は「resize-window を呼ぶこと」自体ではなく「同一サイズで連打すること」だった。
- **Decision**: リサイズ経路は ioctl + `tmux resize-window` の両方を維持しつつ、**サイズが実際に変化した時だけ適用する**。`TerminalSession.applied_size` に直近適用サイズを保持し、`_apply_pty_size()` が一致時は no-op する（非正値も無視）。新しい PTY ブリッジを張り直した直後は `applied_size=None` にして必ず再適用する。`resize_pty` の ioctl は stale fd でのクラッシュを避けるため `OSError` を握りつぶす。接続時/アクティブクライアント切替時/resize メッセージ受信時はすべてこの `_apply_pty_size()` を通す（ルータ側で raw ioctl を直接叩かない）。
- **Consequences**: 同一サイズでの resize-window 連打が止まり崩れが解消する。実際のサイズ変化（端末を開く・デバイス移動）では ioctl と tmux ウィンドウの両方が確実にリサイズされる。リサイズ処理の入口が `_apply_pty_size()` に一本化され、冪等性をテストで担保できる（`tests/test_terminal_jobs.py::TestApplyPtySize`）。**フロントの差分ガード欠如（`sendResize` が毎回送る）に依存せず、バックエンド側の冪等化で崩れを防いでいる点に注意。`_apply_pty_size` の冪等ガードを外す/迂回すると崩れが再発する。**
- **Alternatives considered**: ioctl 一本化（resize-window を呼ばない）— 二重リサイズ連打は止まるが、ioctl(SIGWINCH) だけではウィンドウが追従しない環境があり、リサイズが効かなくなった（本 ADR の旧案で、リグレッションのため却下）。フロント側で `sendResize` に差分ガードを足す — 有効だが、サーバが受け取る経路（接続時クエリ・複数クライアント）すべてを守るにはバックエンド側の冪等化が確実。`window-size manual` を明示設定 — 単一クライアント前提では過剰。

---

### 15. ターミナルは WS クライアントごとに grouped tmux session で独立アタッチする

- **Status**: Superseded by 16
- **Date**: 2026-06
- **Context**: ADR 14 で同一サイズ連打は止めたが、ターミナル崩れが再発し続けた。真因は「**1 つの tmux ウィンドウを、サイズの異なる・競合する・再接続のたびに重複しうる複数 WS クライアントが共有していた**」という構造にあった。旧モデルは 1 セッション = 1 つの PTY ブリッジ（`session.fd`/`pid`）+ 全クライアントへの出力ブロードキャストで、リサイズは `client_sizes` にクライアント別サイズを持ちながら**共有ウィンドウに last-writer-wins で適用**していた（`_apply_pty_size` / `switch_active_client`）。その結果、スマホ(80x24)↔PC(200x50) の同時接続や、再接続オーバーラップ（refreshTab / reconnect backoff で旧 socket と新 socket が一瞬重なる）で applied_size がスラッシングし、xterm の寸法と tmux ウィンドウの寸法が食い違って折り返し崩れが起きた。ADR 14 の冪等ガードは「同一サイズ連打」しか守らず、「交互サイズのスラッシング」と alt-screen 再生崩れはノーガードだった。
- **Decision**: PTY ブリッジを**クライアント単位**にする。ベースセッション（`session.tmux_session_name`）はシェルとスクロールバックの保持役として常駐し、アプリは直接アタッチしない。各 WS 接続は専用の **grouped tmux session**（`tmux new-session -t <base> -s <base>__c<rand>`）を作り、そこに PTY で独立アタッチする（`ClientBridge` = 自分の fd/pid/reader_task/applied_size）。リサイズは各クライアントの **PTY winsize（ioctl）だけ**で行い、**アプリから `tmux resize-window` は叩かない**。ウィンドウサイズはベース／grouped 双方に設定した `window-size latest` で「直近にアクティブなクライアント」に tmux 自身が追従させる。出力ブロードキャストは廃止し、各ブリッジの reader が自分の ws にだけ送る。切断時は当該 grouped session を kill（ベースは残す）。`history` エンドポイントの capture 前 resize は、他クライアント接続中（`session.bridges` 非空）はウィンドウを乱すため行わない。その場合、現在のウィンドウ幅が要求 cols と一致する時だけ capture し、不一致なら復元自体をスキップする（不一致のまま capture すると誤った幅で wrap された全スクロールバックが xterm に書き戻されて崩れるため。可視領域は接続時の tmux 再描画で揃う）。また `tmux resize-window` はウィンドウの `window-size` オプションを `manual` に書き換えるため、resize 直後に同一コマンド内で `latest` へ戻す（戻さないと以後のクライアント PTY リサイズにウィンドウが追従しなくなる）。grouped session は `TMUX_SESSION_PREFIX`（`ac-`）とは別の `TMUX_GROUPED_PREFIX`（`acg-`）で命名し、`/terminal/sessions`（タブ生成元）の一覧に混ざって余計なタブが出ないようにする。一覧では現行 `acg-` に加え旧版が leak させた `ac-...__c...` も後方互換で除外する（`is_grouped_session_name`）。さらに起動時に残存 grouped session を全 kill して自己修復する（`cleanup_orphan_grouped_sessions`）— grouped session は接続中だけ意味を持つ使い捨てビューで、再起動をまたいで残ってもセッション上限（`MAX_TERMINAL_SESSIONS`）の枠を食うだけのため。
- **Consequences**: サイズの取り合いと last-writer-wins 崩れが構造的に消える。再接続オーバーラップは「tmux が正規に扱う 2 つ目のクライアント」になり、tmux がリサイズ時に全クライアントへ完全再描画を送るため崩れない（最悪でもレターボックス/リフロー）。ただしこれはサーバ側の話で、**クライアント側で同一 xterm に 2 本の WS が並走すると再描画が交錯して崩れる**ため、フロントは `connectTerminalWs` に二重接続ガード（`tab.ws || tab._connecting` で締め出し）を持ち、復帰処理（`useSessionResume`）では残存する再接続タイマーを必ず破棄する。また grouped attach は接続時サイズでウィンドウを `latest` 追従させるため、サイズ未指定の接続はデフォルト 80x24 アタッチ→食い違う再描画となって崩れる。フロントは非表示フレームでも xterm の現在サイズ（`term.cols/rows`）を必ずクエリで渡す。スマホ↔PC は触った側のサイズに自然追従する。コストは接続ごとに grouped session 作成（tmux subprocess）が増える点と、grouped session が異常終了時にリークしうる点（ベース kill で連鎖的に片付くため実害は小さい）。`_apply_pty_size`/`switch_active_client`/出力ブロードキャスト/共有 `fd` は廃止。冪等性は `ClientBridge` 単位で担保（`tests/test_terminal_jobs.py::TestApplyBridgeSize`）。
- **Alternatives considered**: 同一ベースセッションへ複数回 attach（grouped を作らない）— 単一ウィンドウ前提なら機能的に等価だが、grouped にすると「ベースは状態保持専用・接続は使い捨てビュー」という責務分離が明確になり、後片付け（grouped を kill）も単純。`window-size manual` で固定サイズ＋レターボックス — 崩れは消えるが大画面で余白が無駄。読み取り専用のセカンダリクライアント — 同時編集ができず UX が落ちる。

---

### 16. ターミナルは WS クライアントごとにベースセッションへ直接アタッチする

- **Status**: Accepted
- **Date**: 2026-06
- **Context**: ADR 15 で「クライアントごとに独立した PTY/tmux クライアントを持つ」ことで崩れを構造的に解消したが、その実装は接続ごとに専用の **grouped session**（`tmux new-session -t <base> -s acg-...`）を作ってそこへアタッチしていた。これにより 1 ターミナル（1 シェル）あたり tmux セッションが「ベース + 接続数分の grouped」と増え、`tmux ls` 上の見え方が直感に反する・grouped のリーク対策（`cleanup_orphan_grouped_sessions` / `is_grouped_session_name`）という恒常的な複雑さを抱えていた。崩れを直した本質は「クライアントごとの独立アタッチ」であって grouped session そのものではなく、ADR 15 自身も "Alternatives considered" で「同一ベースセッションへ複数回 attach は機能的に等価」と認めていた。grouped は責務分離の明快さのためだけに選ばれていた。
- **Decision**: grouped session を廃止し、各 WS クライアントは**ベースセッション（`session.tmux_session_name`）へ直接、別個の tmux クライアントとしてアタッチ**する（`attach_client_bridge` が `attach_tmux_session(base, cols, rows)` を呼ぶだけ）。`ClientBridge` から `grouped_name` を除去し、切断時は PTY（＝`tmux attach` プロセス）を閉じるだけにする — tmux クライアントは PTY 終了で自動 detach し、ベースセッションは残る。サイズは各クライアントの PTY winsize に閉じ、`window-size latest`（ベースセッションに設定済み）で直近アクティブなクライアントにウィンドウが追従する（ADR 15 と同一挙動）。`create_grouped_session` は削除。`is_grouped_session_name` / `cleanup_orphan_grouped_sessions` と一覧フィルタは、旧アーキテクチャから移行直後の tmux サーバに残る grouped session を掃除・除外する**後方互換専用**として残す（現行は新規作成しないため通常は何もしない）。
- **Consequences**: 1 ターミナル = tmux セッション 1 個になり、`tmux ls` の見え方が直感に一致する。接続のたびの grouped session 作成（tmux subprocess）が消えて接続が軽くなり、grouped のリークという失敗モード自体が無くなる。ADR 15 の崩れ対策（クライアントごと独立アタッチ・`window-size latest`・出力非ブロードキャスト・接続時に必ず実サイズを渡す・フロントの二重接続ガード）はすべて維持される。冪等性は引き続き `ClientBridge` 単位で担保（`tests/test_terminal_jobs.py::TestApplyBridgeSize`）。後方互換の掃除コードは将来 grouped session が現実的に絶滅したら削除してよい。
- **Alternatives considered**: ADR 15 の grouped 方式を維持 — 機能的には等価だが、セッションが増える非直感さとリーク対策の恒常コストが残る。grouped を消すと同時に後方互換の掃除コードも全部消す — 移行直後の tmux サーバに旧 grouped session が残った場合に `tmux ls` やセッション一覧へ漏れるため、一度きりの掃除は残す方が安全。

