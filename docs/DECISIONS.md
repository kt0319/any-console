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
- **Date**: 2026-02
- **Context**: ターミナルセッション・レートリミッタ・TTL キャッシュをプロセス内 state に持つ設計のため、複数ワーカーでは state が分断される。
- **Decision**: `_acquire_singleton_lock` により `uvicorn --workers > 1` を起動時に拒否する。
- **Consequences**: 水平スケールは不可能。ただし pty/tmux はホストローカルなリソースであり、そもそも複数プロセスでの共有は不可能。個人ツールとして問題なし。
- **Alternatives considered**: Redis 等の外部 state ストアで state を共有 → 運用コストが個人ツールの用途に見合わない。

---

### 2. Git 操作は subprocess のみ、ライブラリ不使用

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: Git 操作の実装方針として、Python バインディングライブラリを使うか subprocess で git CLI を直接呼ぶかを選択する必要があった。
- **Decision**: GitPython・pygit2 等を使わず、subprocess で git コマンドを直接呼び出す。
- **Consequences**: 依存を最小限に保てる。git 本体の挙動と完全一致し、git のアップデートに自動追従する。subprocess 呼び出しのオーバーヘッドは対話的ツールとして許容範囲。
- **Alternatives considered**: GitPython — 依存追加かつ git 本体と挙動が微妙にずれる場合がある。pygit2 (libgit2) — ビルド依存が増える。

---

### 3. 認証は単一 Bearer Token、ユーザー分離なし

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: 個人ツールとして設計されており、複数ユーザーによる同時利用は想定していない。
- **Decision**: 単一トークンで HTTP / WebSocket 両方を保護する。user 概念・セッション管理・ロール管理は持たない。
- **Consequences**: マルチユーザー運用は不可。設計がシンプルで実装・審査コストが低い。Tailscale 等の閉域ネットワーク前提では認証自体を無効化できる。
- **Alternatives considered**: OAuth / OIDC — 過剰。ユーザーテーブル + セッション管理 — 個人ツールには不要な複雑性。

---

### 4. tmux × pty.fork × WebSocket ブリッジを自前実装

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: ブラウザ上でターミナルを提供する方法として、既存 OSS の統合か自前実装かを選ぶ必要があった。
- **Decision**: WeTTY / GoTTY を採用せず、薄いブリッジ層を自前実装する。
- **Consequences**: 永続セッション・フリック入力・他 UI との統合が自由に実現できる。実装・保守コストはかかるが、製品の中核なので妥当。
- **Alternatives considered**: WeTTY / GoTTY の統合 — ターミナル以外の機能（Git UI・ジョブランナー）との統合が困難。製品の境界線が外部ツールに依存する。

---

### 5. モバイルファースト UI

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: スマホから開発操作を行うことが主要ユースケース。PC でも同等の機能を提供したい。
- **Decision**: モバイルを基準に設計し、広い画面では情報密度を上げる方向で PC にも対応する。独自フリック入力キーボードを実装し、44px タップターゲット規約を設ける。
- **Consequences**: PC ファーストのツールより UI 実装コストが高い。一方、スマホ体験が一級市民になる。
- **Alternatives considered**: PC ファースト + モバイル対応 — モバイル体験が二級になり、ツールのコアバリューが失われる。

---

### 6. ジョブ実行のデフォルトタイムアウト 300 秒

- **Status**: Deprecated (2026-07)
- **Date**: 2026-05
- **Context**: subprocess でジョブを実行するため、無限に待ち続けるリスクがある。
- **Decision**: デフォルト 300 秒でタイムアウトし、ジョブごとに `timeout_sec` で上書き可能（上限 86400 秒）にする。
- **Consequences**: 長時間ジョブは `timeout_sec` の明示設定が必要。暴走プロセスを自動的に停止できる。
- **Alternatives considered**: タイムアウト無し — バックグラウンドでプロセスが残留するリスク。固定値のみ — 長時間ジョブへの対応ができない。
- **Note**: 2026-07 に前提だった同期実行パス（`/run` の非ターミナルジョブ、`api/runner.py`）自体を利用実績が無いため削除した。ジョブは常に tmux セッション内で実行される（タイムアウトの概念なし）ため、`timeout_sec` 設定も合わせて廃止した。

---

### 7. CLAUDE.md を主とし AGENTS.md は symlink

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: AI コーディングエージェントが読む規約ファイルの命名が `CLAUDE.md`（Claude Code）と `AGENTS.md`（他ツール）で分かれている状況。
- **Decision**: `CLAUDE.md` を実体ファイルとし、`AGENTS.md` はそのシンボリックリンクにする。
- **Consequences**: どちらの命名規則にも対応しつつ、内容の二重管理を避けられる。
- **Alternatives considered**: 両方を実体ファイルにする — 内容の乖離が生じやすい。`AGENTS.md` のみにする — Claude Code が読めない。

---

### 8. Python 3.11+ を最低要件とする

- **Status**: Accepted
- **Date**: 2026-02
- **Context**: Python のバージョン要件をどこに設定するかを決める必要があった。
- **Decision**: Python 3.11 以上を要件とする。
- **Consequences**: `tomllib` 標準化・`TaskGroup`・型ヒントの改善・パフォーマンス向上の恩恵を受けられる。古い環境への対応コストを払わなくて済む。個人ツールなので LTS 範囲であれば十分。
- **Alternatives considered**: 3.9 / 3.10 — 対応バージョンは広がるが、型ヒントの表現力と標準ライブラリの充実度で 3.11 が明確に優れる。

---

### 9. Vue 3 + Pinia + Vite の採用

- **Status**: Accepted
- **Date**: 2026-03
- **Context**: フロントエンドのフレームワーク・状態管理・ビルドツールを選定する必要があった。
- **Decision**: Vue 3 (Composition API) + Pinia + Vite を採用する。
- **Consequences**: Composition API による composable 分割でロジックの再利用がしやすい。Vite のビルド速度は開発ループを短縮する。React に比べ学習済みの技術スタックであるため選択。
- **Alternatives considered**: React — 個人的な慣れの問題で Vue を選択。Next.js / Nuxt — SSR 不要なため SPA で十分。

---

### 10. PWA (Service Worker + manifest) の採用

- **Status**: Accepted
- **Date**: 2026-05
- **Context**: モバイルファースト (ADR #5) の帰結として、ホーム画面への追加・standalone 表示・Tailscale 経由でのコールドスタート短縮が必要だった。
- **Decision**: `manifest.json` + `ui/sw.js` を採用。キャッシュ名は `any-console-{git-short-hash}` とし、ビルド時に vite.config.js が置換することでデプロイごとに自動で cache busting される。キャッシュ対象は API を denylist で除外するのではなく、**静的アセットを allowlist する**方式とする（`isCacheableAsset`：ナビゲーション・`STATIC_ASSET_PATHS`・`STATIC_ASSET_PREFIXES` のみ network-first でキャッシュし、該当しないリクエスト＝API ルート・動的リソースは素通し）。precache 一覧（`ASSETS_TO_CACHE`）はビルド時に vite.config.js の `closeBundle` が `dist/` を再帰走査して `__PRECACHE_ASSETS__` プレースホルダへ注入し、手で保守しない（sw.js 自身は除外、ナビゲーション用に `./` を補う）。
- **Consequences**: オフラインで動くのは静的アセットのみ（terminal / git / jobs はバックエンド必須）。allowlist 方式により、API ルートを追加・変更しても更新漏れの failure mode は「キャッシュされず素通し（＝正しい挙動）」に倒れ、API レスポンスが stale になる事故は起きない（旧 denylist 方式が抱えていた手動同期の保守負担は解消済み）。precache 一覧もビルド時に dist から自動生成するため、新しい静的アセットを増やしても sw.js を手で更新する必要はない。ハッシュ付きの本体バンドル（`/assets/*.js`,`.css`）も precache 対象に入る。
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
- **Consequences**: 破壊的なスキーマ変更を入れても、利用者の古い config を起動時に無停止で移行できる。移行の追加は `_CONFIG_MIGRATIONS` に関数を足し `CONFIG_SCHEMA_VERSION` を上げるだけで済む。既存の workspace 名→ID 移行（`_migrate_workspace_keys_to_ids`）とは独立に動く。（追記 2026-07: この一回性の旧移行コードはその後削除された。2026-06 以前の版からの更新手順は README の Upgrade compatibility note を参照。以後の改名・削除系の変換は本 ADR の `_CONFIG_MIGRATIONS` に一元化する — 例: v1→v2 の `radial`→`circle_keypad` 改名）新しい版の config を古いコードで開くと一部設定が解釈できない可能性は残るが、破壊せず警告する方針で被害を最小化する。
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
- **Consequences**: 1 ターミナル = tmux セッション 1 個になり、`tmux ls` の見え方が直感に一致する。接続のたびの grouped session 作成（tmux subprocess）が消えて接続が軽くなり、grouped のリークという失敗モード自体が無くなる。ADR 15 の崩れ対策（クライアントごと独立アタッチ・`window-size latest`・出力非ブロードキャスト・接続時に必ず実サイズを渡す・フロントの二重接続ガード）はすべて維持される。冪等性は引き続き `ClientBridge` 単位で担保（`tests/test_terminal_jobs.py::TestApplyBridgeSize`）。後方互換の掃除コードは将来 grouped session が現実的に絶滅したら削除してよい。（追記 2026-07: `is_grouped_session_name` / `cleanup_orphan_grouped_sessions` と一覧フィルタは削除済み。旧版から更新して grouped session が残っている場合は手動で kill する — README の Upgrade compatibility note 参照）
- **Alternatives considered**: ADR 15 の grouped 方式を維持 — 機能的には等価だが、セッションが増える非直感さとリーク対策の恒常コストが残る。grouped を消すと同時に後方互換の掃除コードも全部消す — 移行直後の tmux サーバに旧 grouped session が残った場合に `tmux ls` やセッション一覧へ漏れるため、一度きりの掃除は残す方が安全。

---

### 17. macOS を launchd で一級ホストとしてサポートする

- **Status**: Accepted
- **Date**: 2026-06
- **Context**: 常駐サービス管理が systemd 専従で、`./any-console` の `start/stop/restart/status/logs/setup` がすべて `systemctl`/`journalctl` 前提だった。ランタイム本体（`python3 -m api.main` + tmux + `pty.fork` + git subprocess）は POSIX 依存で macOS でもそのまま動き、`run`（フォアグラウンド）は既に macOS/WSL 向けに用意されていたが、**自動起動・再起動・ログといった常駐運用の足回りが Linux にしか無かった**。AIコーディングエージェントを自分の箱で走らせスマホから監視する用途では利用者層が Mac 中心で、特に Mac mini / Mac Studio を常時起動サーバにしたいニーズがあった。
- **Decision**: `./any-console` が `uname -s` で OS を判定し、常駐サービスを Linux = systemd / macOS = launchd の二系統で扱う。macOS では **LaunchDaemon**（`/Library/LaunchDaemons/net.highedge.any-console.plist`）として登録する。LaunchAgent ではなく LaunchDaemon を選ぶのは、**GUI ログインセッション無し（ヘッドレス）で起動時から常駐**させるため。`UserName` に実ユーザーを指定して本人の SSH 鍵・git/gh 設定・tmux 環境をそのまま使い、daemon の最小 env を補うため `PATH`（Homebrew の `/opt/homebrew/bin`・`/usr/local/bin` を含む）と `HOME` を plist で明示する。`RunAtLoad` + `KeepAlive` で systemd の `Restart=always` 相当を得る。`journalctl` が無いので stdout/stderr を `logs/any-console.log` に出し、`logs` は `tail -f`。起動/停止/再起動は `launchctl bootstrap/bootout/kickstart`（system ドメイン）で行う。`status` の稼働判定は sudo を避けるため `pgrep -f api.main` を使う。systemd 経路は一切変更しない。
- **Consequences**: Mac mini 等を常時起動サーバとして一級運用できる（ログイン不要・再起動後も自動復帰）。`setup`/`update`/`https-setup` も OS 分岐で一貫して動く。新たに launchd という OS 固有機能を抱える（plist 生成・`launchctl` 操作・ログファイル運用）が、これは systemd の対称物であり「クロスプラットフォーム志向（CLAUDE.md）」の範囲内 — プロダクトの思想（単一プロセス・単一トークン・モバイル一級）は変えていない。MacBook はスリープ・持ち歩きで「外出先から監視」に向かないため、README で Mac mini / Studio 常時起動を推奨と明記。`pgrep` 判定はフォアグラウンド `run` も検出するが、稼働中であることに変わりはなく実害なし。
- **Alternatives considered**: **LaunchAgent**（`~/Library/LaunchAgents`、sudo 不要）— シンプルだが GUI ログインセッションが必要で、ヘッドレス Mac mini では自動ログイン設定が前提になり「ログイン不要で常駐」という要件を満たせない。**Docker for Mac** — 既存方針どおりホストの鍵・shell 環境を引き込めず実運用に不向き（デモ専用）。**macOS は `run` のみで非対応のまま** — 常駐・自動起動が無く、サーバ用途に耐えない。

---

### 18. Raspberry Pi 5 でのスレッドプール枯渇と "connection lost" 誤検知への対応

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: Raspberry Pi 5（4コア）上で any-console を運用中、特定のワークスペース（dotfiles）を開いた直後に「connection lost」が頻発した。調査の結果、複数の問題が重なっていた。
  1. **スレッドプール枯渇**: Python の `ThreadPoolExecutor` デフォルトサイズは `min(32, cpu+4)`。4コア RPi では 8 スレッド。FastAPI の同期 `def` ルートはスレッドプールで実行されるため、`/github/issues`・`/github/pulls`（gh CLI を呼ぶエンドポイント）が旧タイムアウト 30 秒で複数同時起動するとスレッドが埋まり、`/auth/check`（フロントが 3 秒ごとに呼ぶ疎通確認エンドポイント、同期 `def`）がキューで詰まって 2 秒タイムアウトに引っかかった。
  2. **バイナリ diff でサーバがクラッシュ**: dotfiles リポジトリには暗号鍵・証明書・バイナリバックアップが含まれており、`subprocess.run(text=True)` がデフォルト UTF-8 デコードに失敗して `UnicodeDecodeError` を送出し、git diff エンドポイントが 500 を返した（クラッシュではなく都度エラー）。ただしエラーログが大量発生してサーバ負荷が上がった。
  3. **フロントの誤検知閾値が厳しすぎた**: `CONNECTIVITY_PING_TIMEOUT_MS=2000`（タイムアウト 2 秒）かつ `CONNECTIVITY_OFFLINE_THRESHOLD=2`（連続 2 回失敗でオフライン判定）は、RPi の一時的な高負荷で容易に到達できた。
- **Decision**: 以下の 5 点を並行して修正した。
  1. **`/auth/check` を `async def` に変更**（`api/main.py`）: イベントループで直接実行されスレッドプールを消費しなくなる。疎通確認はほぼ即時完了するため async 化に適している。
  2. **gh CLI タイムアウトを 30 秒→8 秒に短縮**（`api/common.py` の `GITHUB_CLI_TIMEOUT_SEC`）: スレッド占有時間の上限を下げてプール枯渇を緩和する。8 秒は遅い回線でも gh が正常応答する十分な時間。
  3. **バイナリ diff を文字化けで通過させる**（`api/git_utils.py` の `run_git_raw`）: `encoding="utf-8", errors="replace"` を指定し、バイナリバイトを `U+FFFD` に置換して続行する。diff 内容として意味はないが 500 エラーは出なくなる。
  4. **WebSocket ping 設定を明示**（`api/main.py`）: `ws_ping_interval=30, ws_ping_timeout=60` を uvicorn.run に追加。デフォルト（interval=20s, timeout=20s）より長くして、短い中断でターミナルセッションが切断されないようにする。
  5. **フロント疎通判定閾値を緩和**（`ui/utils/constants.js`）: `CONNECTIVITY_PING_TIMEOUT_MS: 2000→5000`、`CONNECTIVITY_OFFLINE_THRESHOLD: 2→3`。RPi の一時的な高負荷（2〜3 秒）を「オフライン」と誤判定しなくなる。
- **Consequences**: dotfiles ワークスペースを開いても「connection lost」が発生しなくなった。gh CLI が詰まっても `/auth/check` はスレッドプールを使わないため疎通確認が影響を受けない。バイナリファイルを含む diff は文字化けになるが、UI に表示する差分として許容範囲。ping timeout を長くしたことで、ネットワークが数十秒切断した場合にセッション終了の検知が遅れる可能性はあるが、モバイル運用では誤検知コストの方が大きいと判断した。
- **Alternatives considered**: **スレッドプールを拡張**（`asyncio.get_event_loop().set_default_executor(ThreadPoolExecutor(max_workers=N))`）— 根本対策ではなく、gh CLI タスクが増えると同じ問題が再発する。**gh CLI 呼び出しをキャッシュ**— 有効だが実装コストが高く、今回はタイムアウト短縮と async 化で十分だった。**gh CLI を非同期プロセスに変更**（`asyncio.create_subprocess_exec`）— より根本的だが全呼び出し箇所の改修が必要。現状のタイムアウト短縮で実用上問題ないため先送り。
---

### 19. 接続監視は WebSocket を一次情報源とし、HTTP ヘルスチェックはフォールバックに降格する

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: ADR #18 で **サーバ側**の根本対応（`/auth/check` の async 化・gh タイムアウト短縮・閾値緩和など）を入れた続きとして、**クライアント側**の監視設計そのものを作り直す。#18 時点でもフロントの接続監視は `/auth/check` を3秒間隔でポーリングし、2秒でタイムアウト・2回連続失敗で全画面「Connection lost」を出す設計だった。同期 `def` エンドポイント（git / `gh` の `subprocess`）が共有スレッドプールを占有すると、`/auth/check` がキューで詰まってタイムアウトし、**ネットワークは無事なのにオフライン誤検知**を起こしていた（#18 の通り、スレッドプールは実機 Raspberry Pi 5〈4コア〉では `min(32, cpu+4)`=8 と小さく、gh CLI 数本で容易に枯渇する）。閾値・タイムアウトの緩和（2s→5s、2→3）は誤検知の窓を広げるだけの対症療法で、根本は「監視の一次情報源が、実際に依存している端末 WS ではなく、負荷で詰まる別経路の HTTP ポーリングだったこと」にあった（#18 の `/auth/check` async 化で生存パスはスレッドプール競合から外したが、監視の二重化そのものは残っていた）。
- **Decision**: 生存判定の一次情報源を**端末 WebSocket** に置く。判定ロジックは純粋関数（`ui/utils/connectivity.js`：`isTabWsAlive` / `anyTabWsAlive` / `staleAliveTabs` / `decideOffline`）に切り出してテストする。全画面オフラインは `decideOffline` で決め、**(1) `navigator.onLine=false` は即オフライン、(2) 生きた WS が1本でもあれば決してオフラインにしない、(3) WS が無い時だけ HTTP フォールバックの連続失敗回数で判定** する。生きた WS がある間は HTTP を一切叩かず、常時ポーリング自体を止める。「生きた WS」は *open かつ最近フレーム受信あり* と定義し、サーバの idle keepalive（`WS_PING_INTERVAL_SEC` を 25s→15s に短縮）を約2回分待つ `WS_STALE_THRESHOLD_MS`(35s) を超えて無音なら半開き接続とみなして強制クローズ→backoff 再接続へ回す。加えて `visibilitychange`（PWA 前面復帰）と `online` イベントで即時に確認・再接続する。3状態（真のオフライン＝全画面赤 / サーバ一時無反応＝タブ単位の "reconnecting" で無言自動復帰 / セッション消滅＝タブ単位処理）を分離し、一時無反応を全画面アラートに昇格させない。
- **Consequences**: 端末が実際に流れている間は負荷でオフライン誤検知しない（生きた WS があれば HTTP 判定を短絡）。常時 HTTP ポーリングが消え、通信も減る。半開き接続（サーバハング等で FIN が来ない）は keepalive 無音で検知でき、uvicorn の ping-timeout(60s) を待たずに再接続できる。生存判定の分岐が端末ストア（`openTabs` / `tab._lastWriteAt` / `tab.ws`）に依存するため、監視 composable が terminal store を参照する結合が生まれる。keepalive を 15s に縮めた分だけ idle 時の空フレーム送出が増えるが、ペイロード 0 で無視できる。
- **Alternatives considered**: **閾値・タイムアウトの継続チューニング** — 誤検知の窓を動かすだけで、監視の二重化という根本を残す。**HTTP ポーリングのみを高速化/低速化** — WS の実状態と乖離した別経路である点は変わらず、負荷時の誤検知は消えない。**WS 上に独自の ping/pong 制御メッセージを実装** — 端末ストリームは pty の生バイトを運ぶため制御フレームの多重化が要り侵襲的。既存の idle keepalive（空フレーム）を activity シグナルに流用すれば足りる。**サーバの全 git/gh エンドポイントを専用 executor へ async 移行**（または gh CLI 結果のキャッシュ、#18 の Alternatives 参照）— 生存パスは #18 の `/auth/check` async 化と本項の WS 一次情報源化で既に隔離されており、connection lost 誤検知に対する追加効果は無い。実機のスレッドプールは 8 枠と小さく枯渇し得るが、それは status 等 *他の* 同期エンドポイントの堅牢化であり、worktree 並列運用（エージェント司令塔）regime で `status ポーリングのキャッシュ化` とセットで入れるのが適切。単独では痛みの無い所に広範リファクタを足すことになり、CLAUDE.md の「大規模リファクタ回避」に反するため先送りする。

---

### 20. Tailscale ヘッダ自動認証を opt-in（デフォルト無効）にする

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: `Tailscale-User-Login` ヘッダによる自動認証は、接続元が loopback または Tailscale CGNAT 帯（100.64.0.0/10）であることを条件に無条件で有効だった。しかしこの接続元判定だけでは防げない構成がある。(1) Tailscale 以外のトンネル・リバースプロキシ（`ssh -L`・cloudflared・X-Forwarded-For を付けない nginx 等）を同ホストに立てると、外部からのリクエストが loopback 発として届き、偽装ヘッダだけで認証を素通しできる。(2) tailnet 上の他端末は Tailscale Serve を経由せず直接ヘッダを付けられる（共有 tailnet・node sharing では他人になり得る）。さらに `/auth/check` はヘッダ認証成功時にデバイス cookie を自動発行するため、一度の偽装で永続クレデンシャルが手に入る。本ツールは任意コマンド実行を提供するため、認証バイパスの被害はホスト全体に及ぶ。
- **Decision**: Tailscale ヘッダの信頼を opt-in にする。環境変数 `ANY_CONSOLE_TRUST_TAILSCALE_AUTH=1` または `__global__.trust_tailscale_auth: true` で明示的に有効化した場合のみ、従来どおり接続元判定＋ヘッダで認証する。デフォルトでは Tailscale 経由でも token / デバイス cookie 認証に落ちる（初回に token を1度入力すれば cookie で継続するため UX 低下は最小）。判定結果は認証がリクエストごとに通るためプロセス内にキャッシュし、変更の反映は再起動とする。あわせて (a) 初回起動時のトークン表示を `?token=` 入り URL からトークン単体の表示に変更（UI はクエリの token を消費しておらず、ブラウザ履歴・プロキシログへ漏れるだけだった）、(b) 全レスポンスにセキュリティヘッダ（`X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff` / `Referrer-Policy: no-referrer`）を付与するミドルウェアを追加した（`api/security_headers.py`。プロキシ先アプリを壊さないよう `/preview/` 配下は対象外）。
- **Consequences**: loopback 上の非 Tailscale プロキシや tailnet 他端末からのヘッダ偽装による認証バイパスが、デフォルト構成では成立しなくなる。従来ヘッダ自動認証に依存していた利用者は、フラグを立てるか、各デバイスで token を1度入力する移行が必要（README にリスクと併せて明記）。有効化の変更に再起動が要る非対称性は、認証パスに毎リクエストのファイル I/O を入れないための意図的な代償。
- **Alternatives considered**: **従来どおりデフォルト有効のまま README で警告** — 「よくある構成変更が静かに認証を無効化する」footgun が残り、警告は読まれない前提に立つべき。**`tailscale whois` API で接続元を照合** — 偽装耐性は上がるが tailscaled への依存・レイテンシ・障害モードが増え、個人ツールには過剰。**loopback を信頼ソースから外し CGNAT のみ信頼** — Tailscale Serve は loopback 経由で届くため XFF の解釈に依存することになり、構成による挙動差が読みにくい。opt-in の方が判断が単純で説明可能。

---

### 21. git ステータスは FS 監視 + WebSocket push でリアルタイム配信する

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: dirty 判定や ahead/behind（Push/Pull ボタン）の更新が、クライアントの 5 秒ポーリング（`POLL_INTERVAL_MS`）とサーバの TTL キャッシュ（`GIT_INFO_CACHE_TTL_SEC`=5s）の重なりで最悪 10 秒近く遅れていた。ターミナル内でエージェントがファイルを書き換える・コミットする使い方が主流のため、UI 操作を伴わない変更はポーリング周期まで反映されない。
- **Decision**: `api/git_watch.py` を追加し、watchfiles でワークスペースの作業ツリーと `.git` の要所（`HEAD` / `index` / `refs/` / `FETCH_HEAD` 等）を監視する。変更のあったワークスペースだけ `git_info` を再計算し、前回送信スナップショットと差分があれば WebSocket（`/workspaces/statuses/ws`、認証・keepalive はターミナル WS と同方式）で購読クライアントへ push する。API 経由の git 操作は `invalidate_git_info` からの nudge で FS イベントを待たずに即 push。購読者がいる間は定期 `git fetch`（`GIT_AUTO_FETCH_INTERVAL_SEC`=180s、`GIT_TERMINAL_PROMPT=0`）で behind 判定も自動更新する。監視・自動 fetch は購読者ゼロで全停止する。サーバは接続直後に hello メッセージで FS 監視の有無（watchfiles の有無）を通知し、フロントは**監視が有効なときだけ**既存ポーリングを停止する（切断中・監視無効時はポーリングがフォールバック）。受信ステータスはストアへ即時マージする。linked worktree の git 状態は本体側 `.git/worktrees/` にあるため、worktree ワークスペース（動的検出・登録済みの両方）はベースとの対応を保持し、ベース未登録の場合は共有 `.git` を監視ルートに追加する。
- **Consequences**: ファイル編集・コミット・push/pull がサブ秒〜1 秒程度で UI に反映される（実測: 編集 ~90ms、コミット ~270ms）。watchfiles（Rust 製 notify、wheel 配布あり）への依存が増えるが、未インストールでも起動でき、push が fetch/API 契機のみに劣化してポーリングが下支えする。巨大リポジトリ多数登録時は inotify 上限に達しうるが、その場合も監視エラーをログして再試行し、ポーリングへ劣化するだけで壊れない。linked worktree の git 状態（本体側 `.git/worktrees/`）の変更は、ベースに属する worktree ワークスペースの再計算にも展開する。
- **Alternatives considered**: **ポーリング間隔と TTL の短縮** — 負荷が線形に増える割に「リアルタイム」にはならない対症療法。**サーバ側で全ワークスペースを短周期ポーリング** — git subprocess を常時多数起動することになり、アイドル時のコストがゼロにならない。**pure Python の FS 監視自作**（mtime 走査）— 大きなツリーで走査コストが高く、watchfiles の方が枯れている。**SSE（Server-Sent Events）** — 認証済み WS 基盤（`verify_ws_token`・cookie 認証・keepalive 方式）が既にあり、EventSource はヘッダ認証不可でトークンを URL に晒す必要が出るため WS に揃えた。

---

### 22. watchfiles を必須依存とし、クライアントの git ステータスポーリングを廃止する

- **Status**: Accepted（ADR 21 の「監視無効時・切断中はポーリングがフォールバック」部分を置き換える）
- **Date**: 2026-07
- **Context**: ADR 21 は watchfiles を optional 扱いにしたため、git ステータス配信が「FS 監視 + WS push」「監視無効を hello で通知」「クライアント側の常時ポーリング（5 秒間隔、`statusStreamConnected` でゲート）」の多重系統になっていた。フォールバックの分岐がサーバ（`watch_available` / `_watch_failed` / `stream_watching` / hello 再送）とフロント（hello ハンドリング・`statusStreamConnected`・`POLL_INTERVAL_MS` のポーリングループ）の両側に走り、DRY の観点で保守負担になっていた。watchfiles は Rust 製 notify の wheel 配布があり、実際のインストール障壁は低い。
- **Decision**: watchfiles を必須依存に格上げする（`api/git_watch.py` がモジュールレベルで import し、欠如時は起動に失敗する）。「FS 監視が実効か」をクライアントへ伝える hello メッセージと、フロントの常時ポーリング（`POLL_INTERVAL_MS` / `statusStreamConnected`）を削除する。awatch の一時失敗（inotify 上限等）は従来どおりリトライし、その間は API 操作起点の push と定期 auto-fetch 後の明示 push が下支えする。WS 切断中の取りこぼしは、再接続時の全量同期（`fetchStatuses()`）で埋める（切断中はターミナル自体も使えないため、ステータスの鮮度が落ちても実害はない）。
- **Consequences**: git ステータスの経路が「WS push（+切断時は再接続時同期）」の一本になり、hello プロトコル・監視状態の sticky 管理・ポーリングゲートが消える。watchfiles が入らない環境（極端に古い libc 等）では起動できなくなるが、wheel 配布範囲では現実的に問題にならない。inotify 上限で監視が失敗し続ける環境では更新が API 契機と 180 秒間隔の auto-fetch 契機に劣化する（従来はポーリングが 5 秒で下支えしていた）。
- **Alternatives considered**: **optional のまま維持**（ADR 21）— フォールバック分岐が両側に残り続ける。**ポーリングだけ残して hello を消す** — ポーリングの存在理由が「監視無効環境の救済」なので、必須化とセットでなければ一貫しない。**SSE 等での監視状態通知の維持** — 通知する状態そのものを無くす方が単純。


---

### 23. （撤回）tmux 一時失敗の tri-state 区別と WS close コード分岐

- **Status**: Deprecated（2026-07 に撤回。経緯と教訓は ADR 25）
- **Date**: 2026-07
- 一時期 main に存在した安定化策（`has_tmux_session` の tri-state 化・WS close 1008/1011/4001 の分岐・PTY EOF 時の実在確認）。番号の欠番を避けるため記録のみ残す。コミット履歴で「ADR 23」と参照されているのはこの決定。

---

### 24. （撤回）セッション一覧のサーバ側スナップショット（TTL + last-known-good）

- **Status**: Deprecated（2026-07 に撤回。経緯と教訓は ADR 25）
- **Date**: 2026-07
- 一時期 main に存在した安定化策（一覧読み取りの `session_snapshot.py` への集約・TTL キャッシュ・last-known-good・世代ガード・フロントの毎ポーリング reconcile）。番号の欠番を避けるため記録のみ残す。コミット履歴で「ADR 24」と参照されているのはこの決定。

---

### 25. 2026-07 のタブ安定化の積層を全撤回し、670fa15 時点の挙動へ戻す

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: 「たまにリストア時にワークスペースセッションが素のターミナルとして認識される」というまれな不具合を起点に、7/16〜7/19 の短期間で安定化策が積層した（一覧 API の 500 区別 e22a6b2 → タブクローズの pendingClose 670fa15 → tri-state 化 888306a = 旧 ADR 23 → PTY EOF 実在確認 8e6a9dd → 誤認識修正 6b55c05 → スナップショット化 #103 = 旧 ADR 24 → 競合修正 #104）。全変更がユニット・E2E・CI・機械レビューを通過していたが、実運用では症状が悪化した（terminal 化の頻発・ジョブアイコンの復元失敗）。判断は二転した: 撤回を準備 → 「#104 マージ後の main が安定」と見えて維持を決定しかけた → しかし安定していた稼働ビルドは実は **revert ブランチのチェックアウト**であり、main（#103+#104）へ切り替えると不安定が再現した。最終的に**同一環境での実機 A/B 比較**（revert ビルド = 安定 / main = 不安定）が判断を確定した。
- **Decision**: #104・#103・6b55c05・8e6a9dd・9558393・888306a を revert し、670fa15 時点の挙動へ戻す。pendingClose（670fa15）と一覧 500 区別（e22a6b2）、および期間中の無関係な変更はすべて維持する。不安定の技術的根本原因は未特定のまま撤回する（実運用の安定を原因究明より優先する）。教訓をガードレールとして記録する:
  1. **症状の帰属は「実際に稼働していたビルド」の確定から (MUST)**: リポジトリ（main）の状態と稼働中のビルドは別物。本件では稼働ビルドの取り違えにより誤帰属が二度起きた（欠陥修正前のビルドの症状を修正済み構成に帰属しかけ、次に revert ビルドの安定を main に帰属した）。診断の最初の一歩は「いまこのプロセスはどのコミットから起動されたか」の確認。
  2. **実機 A/B が最も強い判断材料**: テスト・CI・機械レビュー・ローカル E2E をすべて通過した構成が実運用で不安定だった。逆に、同一環境でビルドを切り替えた比較は一度で判断を確定させた。疑わしい変更は「切り替えて試せる」状態を保ち、体感差の報告を一次情報として扱う。
  3. **hot path への大きな変更は避ける (SHOULD NOT)**: 元の不具合はリストア時（まれ）の問題だったが、対策は一覧取得・表示メタ決定を 3 秒ごとのポーリングループへ移した。常時実行経路の欠陥は全クライアントで継続的に顕在化し、局所化・切り分けも難しくなる。直すならまれな経路・作成時の書き込み側に閉じた最小変更を優先する。
  4. **まれな不具合への対策は、不具合より高頻度に誤動作しうる**: まれな障害（tmux 一時失敗）に備えた常設機構は、その機構自身の欠陥率が守る対象の発生率を上回った時点で純損失になる。導入前に「守る対象の実測頻度」を観測ログで掴む。
- **Consequences**: 元の「たまに workspace 誤認識」は残存する（頻度が低く許容）。tmux 一時失敗が「不在」と判定される経路も復活するが、670fa15 時点の実運用で問題になっていなかった。将来この症状が目立つ場合の再着手条件: (a) まず観測ログ（発見時に workspace が None だった事実・tmux コマンド失敗の頻度）だけを入れて事実で原因を特定し、(b) 対処は書き込み側に閉じた最小変更（例: セッション作成時にメタデータを `data/` の JSON へも保存し、リストア時は tmux env より優先して読む）に限定する。ポーリング経路・失敗解釈ロジックの再導入は本 ADR の教訓に照らした正当化を要する。
- **Alternatives considered**: **維持（スナップショット構成が安定と誤認した際に一度決定）** — 稼働ビルドの取り違えに基づく判断で、実機 A/B により覆った。**部分撤回**（例: #103 のみ戻す）— どの層が原因か切り分ける観測がなく、安定が実証された既知の時点へ一括で戻す方が確実。**JSON 永続化を即実装して置き換え** — 原因未計測のまま機構を足すのは同じ過ちの反復（教訓 4）。

---

### 26. dispatch を完全非同期化し、専用 SSE を廃止してステータスストリーム WS へ相乗りする

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: dispatch の承認フローは「同期と非同期の二重構造」だった。`/dispatch` の呼び出し元は `await event.wait()` で承認まで HTTP を張りっぱなしで待つ一方、実行自体は `/dispatch/{id}/decision` が担っていた（サーバ再起動後も承認だけで完結させるため）。この構造のために `_PENDING` は `asyncio.Event`・記録したイベントループ・承認フラグ・実行結果を抱き合わせた 6 フィールド構造になり、別ループから `Event.set()` を叩くための `call_soon_threadsafe` 防御や、承認テストのレース（flaky）も発生していた。さらにキュー同期はプッシュ通知・`GET /dispatch/queue`・専用 SSE（`/dispatch/events`。独自のキュー配列・ping・increment 配信）の 3 チャネルに分かれ、増分配信（pending / decided / result をクライアント側で `handled`・`approvedIds` 集合を使って合成）は「他端末で承認済みの項目が自端末に残る」クラスのバグを生み続けていた。既に認証済み WS 基盤（`/workspaces/statuses/ws`、ADR 21/22）があり、SSE はこれと重複していた。
- **Decision**: (1) `/dispatch`（confirm あり）は承認を待たず、キュー登録して即座に **202 + dispatch_id** を返す。実行は `/dispatch/{id}/decision` だけが担い、承認した端末は decision のレスポンスで起動結果を直接受け取る。`_PENDING` は「id → リクエスト payload」の純データになり、永続化ファイルと同型（`Event`・`loop`・`_wake` は削除）。実行失敗時は項目をキューに残し、値を修正しての再承認・却下をやり直せる。(2) 専用 SSE `/dispatch/events` を廃止し、ステータスストリーム WS に `type="dispatch_queue"` の**全量スナップショット**を相乗りさせる。購読開始時（空でも送る）とキュー変化時に全量を送り、クライアントは一覧を丸ごと置き換える（増分合成をしない）。表示中の承認ダイアログの対象がスナップショットから消えた場合＝他端末で決定済みの場合はダイアログを閉じる。フロントの EventSource・再接続ループ・`handled`/`approvedIds` 集合は削除。
- **Consequences**: 承認待ちを HTTP タイムアウトの世界で無期限に待つ経路が消え、`asyncio.Event` の別ループ問題・flaky テストのクラスごと解消。キュー同期が「WS 全量スナップショット + 再接続時はサーバが購読開始時に送る」の一本になり、端末間で決定済み項目が残る failure mode が構造的に消える。外部呼び出し元は confirm あり dispatch の結果を同期では受け取れなくなる（セッションの出現で確認するか、`confirm:false` の即時実行を使う）。キューは人間の承認規模（数件）なので全量配信のコストは無視できる。
- **Alternatives considered**: **同期待ちを維持し SSE のみ WS へ移行** — `Event`/`loop`/`_wake` の複雑さと flaky の温床が残る。**増分配信（pending/decided/result）を WS で継続** — チャネルは減るが、クライアント側の増分合成と端末間不整合のクラスは残る。全量スナップショットは規模的に十分安い。**decision 承認失敗時に項目を削除（旧挙動）** — 元の呼び出し元が居ない以上、失敗を伝える先はキューしかない。残して再試行可能にする方が一貫する。

- **追記 2026-07**: CI 等の外部連携から `/dispatch` を叩く用途を見据えて 3 点追加した。(1) `confirm: bool = True` を `direct: bool = False` に改名（承認キュー行きが既定という現行仕様はそのまま、フィールド名を「即時実行を明示オプトインする」意味に揃えた。破壊的変更だが呼び出し元はスクリプトのみのため移行期間は設けていない）。(2) `dedup_key`（任意）を指定すると、同じキーの承認待ちが既にあれば新しいリクエストで置き換える。CI の連続失敗など同一要件の dispatch が繰り返し来てもキューが積み上がらないようにするためで、置き換え時は `retry_count` を引き継いで +1 し、push 通知は初回のみ送る。(3) ブランチを切り替える dispatch（`branch != 現在ブランチ`）はワークスペースに未コミット変更（`git status --porcelain` が非空）があると 400 で拒否する。`git checkout` は衝突しない限り黙って変更を持ち越すため、外部起点の承認フローでは意図しない混入を明示的に弾く必要がある。自動 stash は選ばず、Confirm Rules の思想に合わせて止めて見せる（失敗した項目はキューに残り、手元を片付けてからの再承認・却下をやり直せる）。

---

### 27. dispatch 専用のスコープ付き API トークンを導入する

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: GitHub Actions の CI 失敗時に `/dispatch` を自動で叩く連携（dispatch-on-ci-failure.yml）を追加するにあたり、`Authorization` ヘッダに何を渡すかが問題になった。ADR 3（認証は単一 Bearer Token、ユーザー分離なし）の通り、any-console のメイントークンは Web ターミナルを含む全 API を解錠する唯一の鍵であり、GitHub Secrets のようなリポジトリ外部のストアに置くにはスコープが広すぎる。Secrets が漏洩・誤ってログに出力された場合、攻撃者は任意のワークスペースで任意コマンドを実行できてしまう。一方でユーザー・ロール管理を持ち込むのは ADR 3 の「個人ツールとしてシンプルに保つ」方針に反し、過剰設計になる。
- **Decision**: `data/auth.json` にメイントークンとは別のリスト `api_tokens` を追加し、各要素を `{id, name, scope, secret_hash, created_at, last_used}` として保存する。v1 の `scope` は `"dispatch"` の1種類のみとし、汎用的な RBAC は作らない。保存は raw トークンではなく `api/devices.py` の Trusted Device と全く同じ HMAC-SHA256（`data/server_key`）ハッシュのみで、raw トークンは発行時のレスポンスで一度だけ返す。新設の依存関数 `verify_dispatch_token` は `POST /dispatch` にのみ適用し、通常認証（メイントークン / デバイス cookie / Tailscale ヘッダ）に加えて dispatch scope のトークンも受け付ける。dispatch トークンで認証した場合は `direct: true`（即時実行）を 400 で拒否し、承認キューへ積むことしかできないようにする。`/dispatch/{id}/decision`・ステータスストリーム WS・その他全 API は引き続きメイントークンのみで、dispatch トークンでは一切通らない。
- **Consequences**: GitHub Secrets に置く鍵の権限が「dispatch のキュー登録のみ」に絞られ、漏洩時の被害が限定される（承認・実行には依然としてメイントークンが要るため、盗まれたトークンだけで自己承認はできない）。ユーザーは Settings > Auth から用途ごとに複数のトークンを発行・失効できる。反面、認証の分岐が増え（メイントークン / デバイス cookie / Tailscale ヘッダ / dispatch トークン）、`verify_token` と `verify_dispatch_token` のどちらを使うべきかをエンドポイント追加のたびに意識する必要がある。scope が1種類のみのため、将来別用途のトークンが要る場合は再検討が要る。
- **Alternatives considered**: **メイントークンをそのまま GitHub Secrets に使う** — 実装は最小だが ADR 3 の「単一トークンが全 API を解錠する」設計上、外部連携用の鍵が漏れた場合の被害が全API・全ワークスペースに及ぶため却下。**ユーザー/ロール管理を導入し RBAC で絞る** — 個人ツールの規模に対して過剰設計であり ADR 3 の方針と衝突する。**scope を複数種類（例: "read", "dispatch", "admin"）用意する** — v1 では dispatch 連携以外に外部トークンを使う用途が無く、投機的な一般化になるため見送り、必要になった時点で追加する。

---

### 28. 新規デバイス登録をQRコードペアリングで簡略化する（短命・使い切りトークン、単一ユーザー前提は維持）

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: ADR 3 の通り認証は単一 Bearer token + デバイスcookieで、新デバイスは初回のみ32文字のトークンを手入力してcookieを得る。スマホでのトークン手入力はタイプミスしやすくオンボーディング摩擦になっていた。ADR 20 で Tailscale ヘッダの自動信頼を opt-in に後退させた経緯もあり、「利便性より安全性を優先しつつ、単一ユーザー・単一トークン前提のシンプルさは崩さない」という設計哲学のもとで、認証済み端末（PC等）から新デバイス（iPhone等）をQRコードスキャンだけで安全に追加する方法が求められた。
- **Decision**: 認証済みセッションのみが呼べる `POST /auth/pairing/start` で、90秒だけ有効・一度使ったら即失効するペアリングID+トークンを発行する（`api/routers/pairing.py`、状態はプロセス内メモリのみ・ADR 1 の単一プロセス前提に準拠しディスクへは書かない）。QRコードのURLは、Tailscale の MagicDNS 名が引ければ「ホスト名 + このプロセス自身の待受ポート」（`http://<tailscaleホスト名>:<port>/pair/{id}?t=<token>`）で組み立てる — Tailscale Serve の設定有無やproxy先の確認はあえて行わない（Serveが無くてもtailnet経由の直接アクセスで十分到達できるため、複雑にする理由が無い。詳細は下記Alternatives参照）。ただし `__global__.host` がloopback専用（`127.0.0.1`/`::1`）でbindされている場合はMagicDNS名を使っても結局どこからも到達できないため使わない。MagicDNS名が引けない場合はリクエスト自身の scheme/host/port にフォールバックするが、発行元が起動時通知どおり `http://localhost:8888` のようなloopbackアドレスで開いている場合、そのままフォールバックすると「スキャンした端末自身のlocalhost」を指すQRになり絶対に繋がらないため、「LAN/Tailscaleアドレスで開き直してください」という明確なエラーで拒否する（`_is_loopback_host`）。ホスト名解決は新設の `auth._resolve_tailscale_name()`（`tailscale status --json` の `Self.DNSName`）を使う。新デバイスは `GET /auth/pairing/{id}/status`（未認証で呼べる。発行元がQRモーダルのカウントダウン・自動クローズに使う）でポーリングし、`POST /auth/pairing/{id}/claim` でtokenを検証してログインを完了する。claim成功時は**既存の単一トークン認証と同じデバイスcookie発行ロジック**（`devices.register_device` + `routers/devices._set_device_cookies`）をそのまま再利用し、二重実装しない（`find_or_register_device` の同一UA再利用は使わない — 同一UAの2台を続けてペアリングすると後発のために先発のsecretを回転させ、先発デバイスを無言でログアウトさせてしまうため。claimは常に人間の明示操作であり、tailscale自動登録のような再利用の必要が無い）。tokenの検証からデバイス登録・cookie発行・claimedへの更新までを丸ごと`_lock`保持下で行う（`claim_pairing`）。個人ツールの利用規模ではデバイス登録（devices.json書き込み）にかかる時間は無視できるため、途中経過を表す中間状態を別途持つ必要がない — 同じtokenでの同時claimは後発がロック待ちの後「既にclaimed」を見て自然に弾かれ、statusポーリングもclaim完了前後どちらかの一貫した状態しか観測しない。登録が失敗した場合はエントリを一切変更せず、tokenはそのまま残して再試行可能にする。claimed後のエントリはtombstoneとして残し、claim成功時に`expires_at`を観測猶予（`_CLAIMED_OBSERVATION_SEC`=30秒）分だけ先に延長する — 元の90秒期限ぎりぎりでclaimが成立したケースでも、発行元のポーリングが少し遅れただけでclaimedを見損ねてexpired扱いになることを防ぐ（token自体は既に破棄済みなので延命してもリプレイのリスクは無い）。start/status/claimはそれぞれ専用のレートリミッタ（`rate_limiter.py` の `_FixedWindowCounter` を再利用）でIPごとに絞る — アプリ全体にかかるIPベースの制限（`RateLimitMiddleware`）に加えた二次防御であり、id/tokenの高エントロピー（24バイトのランダム値）が主防御。フロント（`PairDeviceConfig.vue`）も、pairingIdの単純比較だけでは「新しいstart()が自身のAPI呼び出しをawait中でpairingId自体がまだ書き換わっていない間隙」をすり抜けてしまうため、start()の冒頭で同期的に進める世代カウンタで古いpollの応答を無効化する。ローカルのカウントダウン表示が0になっても、それだけではpollを止めない（表示上のtickを止めるだけ）— サーバがclaiming中のエントリをexpires_atを過ぎてもpendingのまま保持し続けることがあるため、expired/claimedの最終判定はサーバの応答に委ねる。フロントはQRを軽量ライブラリ `qrcode-generator`（ゼロ依存・MIT）でSVGとして描画し、vue-router非導入の方針を維持するため `/pair/{id}` のルーティングは `ui/utils/pairing.js` の純粋関数でURLをパースするだけの簡易な形にする（サーバ側の `GET /pair/{pairing_id}` はSPAシェル(index.html)をそのまま返すのみ）。既存のトークン手入力フローは変更せず、QRが使えない環境（カメラ無し等）向けのフォールバックとして残す。
- **Consequences**: 新デバイス追加がQRスキャンのみで完結し、トークン手入力の手間・タイプミスが無くなる。QRコード自体は「既に認証済みの端末の画面」にしか表示されないため、Tailscale閉域網の外に漏れても短命(90秒)+使い切りトークンが前提である限り単体では意味を持たない。pairingTokenはURLクエリに乗るためアクセスログ・共有スクショで漏れうるが、claim後即座に破棄（リプレイ不可）することでリスクを許容範囲とする判断を明示的に下した。サービスワーカーは `/pair/` 配下のnavigationをキャッシュ対象から除外する（Cache Storageに使い切りトークンが残留しないように）。QRペアリングは「同じユーザーの別デバイス追加」であり、複数ユーザー分離や新規ユーザー招待の機能ではない（ADR 3 の単一ユーザー前提は変えない）。プロセス内メモリ管理のため、サーバ再起動をまたぐペアリングリクエストは失効する（90秒の寿命なので実運用上問題にならない）。Tailscale Serve経由でも常にアプリ自身の待受ポートを含むURLになる（例: `http://myhost.ts.net:8888/...`）ため、Serve専用のバニティURL（ポート省略）にはならないが、機能上は同様にtailnet越しに到達できる。
- **Alternatives considered**: **WebAuthn / passkey** — ブラウザネイティブで安全だが、単一ユーザー・単一トークン前提のシンプルさ（ADR 3）に対して実装・UI・鍵管理の複雑さが過剰であり、個人ツールの規模に見合わない。**ペアリングトークンをデバイスcookieと同様にハッシュ化してから保存** — devices.jsonのように永続化するなら妥当だが、本機能はプロセス内メモリに90秒しか存在しないため、平文保持でも漏洩経路（ディスク・ログ）が無く、追加の実装コストに見合わない。**claimTokenを長期間（例:5分）有効にする** — QRコードを画面共有・スクリーンショットで渡す猶予は増えるが、漏洩時の悪用可能な時間も伸びるため、実際にスキャンし終える所要時間（数秒〜数十秒）に対して90秒で十分と判断した。**専用SSE/WSでの通知** — 承認フロー(ADR 26)と異なりペアリングは単発の短時間操作であるため、数秒間隔のHTTPポーリングで十分でありWS接続を増やす必要が無い。**Tailscale Serveの実際のproxy先を検出してポート省略のURLを組み立てる** — `tailscale serve status --json` を解析してこのプロセスへの実proxyを確認する実装を一度試みたが、Serveのfrontendポート(443/8443/10000)・backendポート一致・別サービス誤検知など考慮事項が多く、実装・テストの複雑さの割に得られる利益（QRのURLからポート表記を省く見た目上の違いのみ）が小さいと判断し撤回した。**pairing_idごとに個別スコープのレート制限を持つ** — Tailscale Serve経由で全クライアントが同一IPに見える構成での巻き添えブロックを避ける狙いで一度実装したが、存在しないIDの扱い・キーのeviction・並行アクセス時のatomicityなど付随する考慮事項が多く、個人ツールの利用規模に見合わないと判断し撤回した（アプリ全体の`RateLimitMiddleware`とIPごとの二次防御で十分）。**claim中を表す`claiming`フラグを持ち、デバイス登録をロックの外で行う** — 一度実装したが、「登録完了までエントリを消さない」「claiming中は期限切れ扱いにしない」「登録失敗時にclaimingを解除する」など、中間状態を扱うためだけの分岐が積み重なった。個人ツールの利用規模ではdevices.json書き込みにかかる時間は無視できるため、登録処理そのものをロックの中に含めて中間状態を無くす方がシンプルで、同時claimの排他という目的も自然に満たせると判断し撤回した。

---

### 29. バックグラウンド復帰時、非表示タブの古いサイズで PTY/tmux が巻き込まれてリサイズされる不具合を fail-closed な可視性ガードで塞ぐ

- **Status**: Accepted
- **Date**: 2026-07
- **Context**: 「プッシュ通知を受けただけで（タップしなくても）すべてのターミナルがスマホサイズにリサイズされる」という報告から調査した。`ui/composables/useSessionResume.js` の `handleResume()` は `document.hidden` がバックグラウンド→フォアグラウンドに戻ると発火し、**開いている全タブ**（アクティブ/非表示問わず）のWSを一旦close→`_pendingRedraw=true`→再接続する設計になっている（タブ復帰時に確実にWSを張り直すための意図的な仕様）。この一括再接続自体は妥当だが、各タブの `ws.onopen`（`useTerminal.js:85-102`）内で `fitTerminal(tab, {force:true})` と `sendResize(tab)` が両方呼ばれており、**`fitTerminal` にはフレーム可視性ガードがあるのに `sendResize` には無かった**。非表示タブは `frame-${tab.id}` が `display:none` で幅/高さ0になるため `fitTerminal` は正しくスキップされフロントの見た目（xterm.jsのcols/rows）は変わらないが、`sendResize` はガード無しで無条件に `tab.term.cols/rows`（＝バックグラウンド化した瞬間の古い値、スマホなら小さい寸法）をバックエンドへ送っていた。バックエンドは `_apply_bridge_size()` で実際にPTYの winsize を ioctl 変更し、tmuxは `window-size latest`（ADR 未採番、`tmux.py`）設定により直近アクティブなクライアントのPTYサイズにウィンドウ実体を追従させるため、**フロントの見た目が変わらなくても非表示タブのtmuxウィンドウは実際に小さくリサイズされ**、次にそのタブを開いたときに崩れて見える。さらに、既存の可視性チェック（`isFrameVisible` として後で共通化）は「`frame-${tab.id}` 要素がDOMに見つからない場合は可視として扱う」というfail-openな実装だった。スプリット枠に入っていない裏タブは `TerminalPane` 自体が未マウントで `frame` 要素がそもそもDOMに存在しないため、このfail-open実装だとガードを完全にすり抜け、スプリット使用中は「見えているタブだけ」のはずの `fitAllTerminals()` の設計意図に反して裏タブも巻き込まれていた。
- **Decision**: `frame-${tab.id}` の可視性判定（要素の有無＋`getBoundingClientRect()`の幅/高さ）を `isFrameVisible(tab)` として `ui/composables/useTerminalResize.js` に一本化し、`fitTerminal` と `sendResize` の両方で使う。要素が見つからない場合の既定を **fail-open（`true`）から fail-closed（`false`）に反転**する — 「対応する frame がDOMに存在しない＝見えていない」と解釈するのが実態と一致するため（`fitTerminal`/`sendResize` は本来、実際にレンダリングされているタブに対してのみ呼ばれる想定であり、要素が見つからないケースは「今は見えていない」以外に正当な理由がない）。`handleResume()` 側の「全タブを一括再接続する」設計自体は変更しない（WS生存性の確保という目的は可視性と無関係で正しい）。表示中のタブが後でアクティブ化された際は、既存の `term.onResize` フック（xterm.js側でcols/rowsが実際に変化した時だけ発火し `sendInput` 経由でバックエンドへ通知）が自動的にバックエンドと再同期するため、本修正による副作用は無い。
- **Consequences**: バックグラウンド復帰時、画面に見えていないタブ（非スプリット時の非アクティブタブ、スプリット時の枠外タブ）のtmuxウィンドウが古い/縮小されたサイズで巻き込まれてリサイズされる不具合が解消した。既存テスト（`fitTerminal`のcols/rows抑制テスト）がfail-open実装への暗黙依存（frame要素を作らずにfitされることを期待）をしていたため、可視フレームを明示的にモックするよう修正が必要だった。ガード条件を一本化したことで、今後frame要素のDOM構造が変わった場合の修正箇所も1箇所になる。
- **Alternatives considered**: **`handleResume()` を「見えているタブだけ再接続する」ように変更** — WS自体は非表示タブでも生存させておく必要がある（次にタブを開いた時に即座に使える状態を保つため）ため、再接続対象を可視タブに絞るのは目的に反する。問題は再接続そのものではなく、再接続に伴う`resize`送信が可視性を見ていなかった点なので、そちらだけを塞ぐ方が変更範囲が小さく正確。**`isFrameVisible`のfail-open判定は維持しつつ`sendResize`にだけ個別のガードを足す** — その場しのぎにはなるが、`fitTerminal`と可視性判定ロジックが再び分岐し、次に別の呼び出し経路が増えた時に同じ不具合が再発しうる。ガード自体を共通ヘルパーに一本化しfail-closedにする方が、将来の呼び出し元に対しても構造的に安全。**バックグラウンド復帰後、一定時間（例: 500ms）待ってから`sendResize`する** — iOS/Androidの復帰直後にviewportが過渡的な値を返す時間を単純に避ける対症療法であり、待ち時間の妥当性を機種ごとに保証できない。可視性ガードで「そもそも見えていないタブには送らない」方が待ち時間に依存せず確実。

---

### 30. herdr の screen manifest を取り込み、同構成（同梱 + リモート更新 + ローカル override）で既知エージェントの blocked（承認待ち）検知を追加する

- **Status**: Accepted
- **Date**: 2026-08
- **Context**: agent_watch の状態は画面差分による working / idle の 2 値で、「Claude Code が許可を求めて止まっている」ことを検知できず、通知はジョブ定義ごとの notify_phrase 手動設定に頼っていた。承認待ちの検知は確認 UI の文言・レイアウトへの追従が必要で、自前でパターンを保守するのはコストが高い。一方 [ogulcancelik/herdr](https://github.com/ogulcancelik/herdr)（Apache-2.0）はエージェントごとの検知ルールを TOML（screen manifest）として保守・配信しており、データとして流用できる。
- **Decision**: herdr のマニフェスト全 19 エージェント分を `api/agent_manifests/` へベンダリング（ライセンス同梱）し、評価エンジンを `api/screen_manifest.py` に Python で移植する（意味論は herdr の `manifest.rs` に合わせる: 定義順走査・優先度厳密大なり勝ち・`skip_state_update` は状態未確定。エンジンバージョンは herdr と同じ 3）。Rust regex 固有記法（`\x{..}`/`\u{..}`・`\p{Alphabetic}`）はロード時に Python `re` へ変換する。マニフェストの解決は herdr と同じ 3 階層: **ローカル override**（`data/agent-detection/<id>.toml`）> **リモートキャッシュ**（`data/agent-detection/remote/<id>.toml`）> **同梱**。上位が壊れている・id 不一致・同梱よりバージョンが古い場合は下位へフォールバックする。リモート更新（`api/manifest_update.py`）は herdr.dev のカタログ（`index.toml`）を起動 5 分後 + 24 時間ごとに確認し、herdr と同じ検証（version 必須のドット数値・後退拒否・version bump 無しの内容変更拒否・min_engine_version 超過拒否・カタログ path の相対限定）を通ったものだけ保存して `data/agent-detection/status.json` に結果を記録する。`__global__.agent_detection.remote_update: false` で無効化でき、カタログ URL は `ANY_CONSOLE_MANIFEST_CATALOG_URL` で差し替え可能。エージェント特定は tmux `#{pane_current_command}` とマニフェスト id/aliases の照合（ネイティブバイナリ化した claude / codex はプロセス名で判別できる）。agent_watch のポーリングに `list-panes -a` 1 回を追加するだけで、周期・購読者ゼロ停止の構造は変えない。特定できたセッションは manifest 判定（blocked / working / idle）をそのまま状態として採用し、確定しない場合（ルール不一致・unknown・skip_state_update）は従来の画面差分（working / idle）へフォールバックする。これによりスピナーの OSC タイトル（tmux の `#{pane_title}` 経由）で画面静止中の working を、プロンプトボックス検出でステータス行が動き続ける間の idle を正しく判定できる。OSC タイトル系ルールは tmux サーバが UTF-8 ロケールで動いていることが前提（非 UTF-8 だとタイトル中の記号が `_` に置換されスピナー判定だけ効かなくなる。画面ベースのルールには影響しない）。blocked のとき UI はタブ / ピルの琥珀色点滅で表示する。`osc_progress` リージョンは tmux から取得できないため空とし該当ルールは自然に不一致（graceful degradation）。
- **Consequences**: 既知エージェントの承認・入力待ちがタブ一覧から一目で分かり、エージェント UI の文言変更にはリモート更新で追従できる。失敗モードは「blocked を見逃す」側に閉じる（マニフェスト破損は階層単位で捨てて下位へフォールバック。ルール単位のスキップはガードルール欠落で誤検知側に倒れるためしない）。リモート更新は ADR 25 の「常設機構」への警戒と緊張関係にあるが、(a) 24 時間に 1 回の低頻度でホットパスに介在しない、(b) 検証を通らないデータは無視され挙動が悪化しない、(c) config で切れる、の 3 点で許容した。ラッパー経由（node スクリプト等でプロセス名が一致しない）起動は検知対象外。upstream のルール書式変更は `tests/test_screen_manifest.py` のバンドル検証（全ファイルロード・未知リージョン・未知状態の検出）で顕在化する。プッシュ通知への連携（blocked を notify_phrase 同様の猶予付きで通知）は次段階。
- **Alternatives considered**: **notify_phrase の拡充で代用** — ジョブごとの手動設定が前提で、確認 UI の文言変更に個人で追従し続けるのは非現実的。**herdr をプロセスとして併用** — herdr は自前の端末エミュレータを持つ多重化ツールであり、tmux を土台とする本アプリ（ADR 1）と二重構造になる。必要なのは検知ルールのデータだけ。**リモート更新なしのベンダリングのみ（当初案）** — 実装は小さいが、エージェント UI の変更のたびに手動同期が必要で鮮度が落ちる。herdr がカタログ + 版数管理 + 検証規則を既に確立しており、同じ構成に乗る方が保守が軽い。**blocked のみ manifest で判定し working / idle は画面差分のまま（当初案）** — 失敗モードは最小だが、ステータス行が動き続けるエージェントが永遠に working に見える・画面静止中の思考が idle に見える、という精度限界が残る。manifest のルールは herdr で実運用済みであり、誤判定の影響も既知エージェントのセッション表示に閉じるため、確定時のみ採用 + 画面差分フォールバックの形で全状態に広げた。素のシェル・未知ツールの判定は画面差分のままで変わらない。

---

### 31. 前面ジョブ（フォアグラウンドプロセスグループ）の argv を共有レイヤ化し、ラッパー起動のエージェント特定と手打ちコマンドのジョブ自動タグ付けに使う

- **Status**: Accepted
- **Date**: 2026-08
- **Context**: ADR 30 のエージェント特定は tmux `#{pane_current_command}`（プロセス名 1 個）のみで、node スクリプトや `sh -c` 経由の起動（プロセス名が node / sh になる）を検知できなかった。また、素のターミナルで手打ちされたコマンドがジョブ定義と同じでも、ジョブメタデータ（notify_phrase・アイコン等）は効かない。herdr は前面プロセスグループの argv を正規化してエージェントを特定しており（`identify_agent_in_job` / `wrapped_agent_name_from_runtime_argv`）、同じデータはジョブ照合にも流用できる。
- **Decision**: `api/foreground.py` に前面ジョブ取得レイヤを新設する。tmux の `#{pane_pid}`（`list-panes -a` の既存一括取得に列追加）を起点に、Linux は `/proc/<pid>/stat` の tpgid + `children` 走査、macOS は `ps -axo` 一括表（ポーリング周期あたり最大 1 回）で前面グループの argv を取る（`preview.py` の cwd 取得と同じ二系統分岐）。消費者は 2 つ: (1) **エージェント特定のフォールバック** — プロセス名で当たらないときだけ argv を herdr 相当のルール（argv0 正規化・node/python 等のランタイムのスクリプト引数・`sh -c` の先頭トークン・既知拡張子除去）で照合する（`screen_manifest.identify_agent_from_argvs`）。(2) **ジョブ自動タグ付け** — ジョブタグの無いセッションで、前面グループのいずれかの argv がジョブ定義コマンドと一致したら `TMUX_JOB_NAME` 等を刻印する（`api/job_match.py`）。照合はコメント除去 → `&&`/`;`/改行でステップ分割 → 空白正規化 → `[[var]]` ワイルドカード化の上での**完全一致のみ**（前方一致は `npm` 始まりのジョブ同士で衝突するため不採用）。刻印後は notify_phrase・アイコン表示・dispatch 対象判定など既存のジョブ機構がそのまま有効になる。既存タグ（明示起動・過去の自動タグ）は上書きしない。
- **Consequences**: ラッパー経由で起動したエージェントも blocked / working / idle 判定の対象になる。素のターミナルで手打ちした `npm run dev` 等がジョブランチャー起動と同等に扱われる（タグは永続 — ジョブ起動セッションと同じ扱い）。誤タグの実害は「セッションにジョブラベルが付く」に閉じる。短命ジョブ（ポーリング間隔 2 秒の隙間で終わる）とパイプライン内のコマンドは取りこぼす（best-effort）。argv 取得はプロセス名照合が外れたセッション・未タグのセッションに限定され、素のシェル（前面ジョブ無し）は tpgid 比較だけで即座に空を返すため定常コストは小さい。
- **Alternatives considered**: **Enter フックでの入力コマンド照合** — 起動の瞬間を捕まえられるが、履歴呼び出し（↑）・Tab 補完で入力されたコマンドを正しく復元できない。argv 照合は入力経路に依存しない。両者は併用可能で、必要なら後から入力照合を足せる。**画面内容（screen manifest ルール）からのエージェント推定** — ルールは識別用に設計されておらず（codex の `[y/n]` など汎用パターン）、素の bash の `rm -i` プロンプト等に誤爆する。herdr 自身も採っていない。**tpgid のプロセスグループ全走査（/proc 全スキャン）** — セッション数に依らず /proc 全体を舐めるのは高コスト。シェルの子孫走査 + グループリーダー直接読みで十分カバーできる。
