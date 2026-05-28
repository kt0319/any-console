# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/kt0319/any-console/compare/v0.1.0...v0.2.0) (2026-05-28)


### Features

* ./any-console run コマンドを追加し systemd 不要のフォアグラウンド起動を可能にする ([e8d9283](https://github.com/kt0319/any-console/commit/e8d9283876f38ede83c0aea4eeca360155410cfb))
* any-console setup の手順を親切化し Tailscale HTTPS 設定を組み込む ([d6d88f9](https://github.com/kt0319/any-console/commit/d6d88f91dda70305ca80241b920a20bff7c33459))
* Hack Nerd Font Mono を同梱しターミナル初期化前にロードを保証 ([9175609](https://github.com/kt0319/any-console/commit/9175609b29fca54596c34c23b64a8543f6b8c6f3))
* push/pull成功トーストをクリックするとHistoryに遷移する ([d2df382](https://github.com/kt0319/any-console/commit/d2df382de232c0cbe5c4de21af5d61f947216be0))
* RSS/Atom フィードをワークスペースタブで表示する機能を追加 ([dc6b4eb](https://github.com/kt0319/any-console/commit/dc6b4ebc5410c10f3538e012dd3aacf66568cdae))
* RSSアイテムにサマリーを2行目に1行表示する ([ebfd17e](https://github.com/kt0319/any-console/commit/ebfd17eab2a9b7a4aeb0d5e29aaab7e5f8876ea8))
* RSSタブに今日のアイテム数をバックグラウンド集計して表示する ([b9c8c71](https://github.com/kt0319/any-console/commit/b9c8c71986b11b57d6a344bc52ccd292a8f51b0f))
* RSSフィードのBasic認証をサポート（user:pass@host形式） ([0fd6fdc](https://github.com/kt0319/any-console/commit/0fd6fdcf881125549e7603cf334be8f1cfbcd6a1))
* RSSフィードの追加・編集モーダルを統一し、URL・タイトルを編集可能にする ([a430f68](https://github.com/kt0319/any-console/commit/a430f68a2446f1d10b4bfc3fc9517cf2636ca8d3))
* RSSフィード削除時に確認ダイアログを表示する ([5335bca](https://github.com/kt0319/any-console/commit/5335bca7069e8e6d376b49fdac10cd98748a3fef))
* RSSペインにリロードボタンとエラー表示を追加 ([6319151](https://github.com/kt0319/any-console/commit/63191518731b036f3010b3bbe8b4b47656857ef9))
* インプットが空の時のEnterキーをターミナルに直接送信する ([2282744](https://github.com/kt0319/any-console/commit/2282744db294b76fbe5c9e794c82ae3beb546bd0))
* ジョブパネルの Terminal を Common セクション内に固定配置し、セクション見出しの体裁を整える ([84d33b6](https://github.com/kt0319/any-console/commit/84d33b63e9fffbe6b11d8336d5015df21363cc59))
* ターミナル・RSS共通のURLアクションモーダルを追加 ([21e79f0](https://github.com/kt0319/any-console/commit/21e79f0363468237ec9f9f2a95fffbaf6329b20e))
* ターミナルに WebGL レンダラーを導入してサブピクセル誤差による文字位置ずれを解消 ([c953ce8](https://github.com/kt0319/any-console/commit/c953ce8e4968052d85dc6ee02eddae61a8747722))
* ターミナルのスクロールバック上限を引き上げ、UI で編集可能にする ([45836ba](https://github.com/kt0319/any-console/commit/45836ba9d4d4419a4cc6a946c10fd1dd2de1d7fb))
* ターミナル選択中の Ctrl/Cmd+C をグローバルでコピーに割り当てる ([93ff58a](https://github.com/kt0319/any-console/commit/93ff58a937f75e5a3c726e7b5dc49ce040275460))
* ターミナル選択中の Ctrl/Cmd+C をコピーに割り当てる ([5cb3b5c](https://github.com/kt0319/any-console/commit/5cb3b5ce49b25bdfe73925de7a009f3762e5ef73))
* ブランチパネルにブランチ作成・Fetch ボタンを追加し、REMOTE の折り畳みを廃止 ([5d95e77](https://github.com/kt0319/any-console/commit/5d95e77a40e9bb9bfe01cc423f67a2aed6413da4))
* 不可視タブしかない場合に empty screen を表示し、復帰時に terminal を再 fit する ([20b8d2d](https://github.com/kt0319/any-console/commit/20b8d2d95dab84316b78e926b30080df62467dd9))
* 入力フォーカス中の左右フリックでスニペットをループするようにする ([b8d1dcc](https://github.com/kt0319/any-console/commit/b8d1dcc80b14b5f60447a66a52be7ff094c3699e))
* 設定モーダルの Auth 項目にトークン未設定の警告バッジを表示 ([a3275c5](https://github.com/kt0319/any-console/commit/a3275c5806d052fce25abdf546d4432c8c0d9956))


### Bug Fixes

* empty screen で不可視タブを選択してもターミナルに遷移できない問題を修正 ([22dc47d](https://github.com/kt0319/any-console/commit/22dc47d555fe4d429cfddf940baf35229459aa85))
* empty screen 時のタイトルとステータスバーをリセットする ([ed5c2ba](https://github.com/kt0319/any-console/commit/ed5c2baa87404a4367c55b98e0f27f736916141a))
* history 取得時に cols/rows を渡して tmux pane を先にリサイズしてから capture する ([6b7b392](https://github.com/kt0319/any-console/commit/6b7b3923701d97c6a87b41198793ce1edeec0e11))
* iOSキーボードのEnterをkeyup/form submitでも捕捉してターミナルへ送信 ([0d4b67b](https://github.com/kt0319/any-console/commit/0d4b67bb6235ecd3ea7f96d0308d30ea4c041c51))
* KeyboardBarのEnterボタンもdraft空の時にターミナルへ送信できるよう修正 ([f2c1db2](https://github.com/kt0319/any-console/commit/f2c1db2e0d5f34f407dd18d44fde3faf5b2ce18a))
* makeFlickResolverで左フリックのclearアクションが正しくパススルーされるよう修正 ([69e7305](https://github.com/kt0319/any-console/commit/69e73054f1ac1716ffb45e298bc7c34da2ecc5ec))
* mypyエラー修正 - parsed.hostnameのNone型を考慮した文字列結合 ([8f278dd](https://github.com/kt0319/any-console/commit/8f278dd5b1621cfe1d439b7fe8c9cf7426468f25))
* OSキーボードのEnterキーをdraft空の時にターミナルへ送信する ([65a7b33](https://github.com/kt0319/any-console/commit/65a7b331de8ac10042985d8403357746bd070571))
* paste 時に bracketed paste 制御文字が leak する問題を回避 ([3803e02](https://github.com/kt0319/any-console/commit/3803e0209e1461d2e713302b259e07de3795b479))
* push/pullトーストタップ時に正しいワークスペースのHistoryへ遷移する ([0696eb1](https://github.com/kt0319/any-console/commit/0696eb1d444050b625b608961d332738c3bfbd7f))
* RSSの空アイテムをスキップし当日アイテムに時刻を表示する ([35f242a](https://github.com/kt0319/any-console/commit/35f242a3bf75a32b3966a56c3eba86848c37d633))
* RSS日付表示で0d agoになるケースを1d agoに修正 ([2271f75](https://github.com/kt0319/any-console/commit/2271f754f4c039208776ab0cf215c638a9fe88a9))
* RSS日付表示の「今日」判定をカレンダー日付ベースに修正 ([2992fb2](https://github.com/kt0319/any-console/commit/2992fb2dbe519fa650bd42e94abcdf89478ea03f))
* scheduleActiveFitのforce:trueを削除して崩れを抑制する ([233c5b9](https://github.com/kt0319/any-console/commit/233c5b9fa78f2060b2f23813ccefed6c2e5458a6))
* tab-close-confirm の JSDoc 戻り値型を confirm のシグネチャに合わせる ([315d121](https://github.com/kt0319/any-console/commit/315d1217fdc9133a15f64c81c351c47fec212ec0))
* TypeScriptエラー修正 - Date同士の減算に.getTime()を使用 ([a3f04fb](https://github.com/kt0319/any-console/commit/a3f04fb742453a196dff0f39ebf826068565e90a))
* Unicode11Addon を導入して CJK 文字の2列幅を正しく処理する ([569d392](https://github.com/kt0319/any-console/commit/569d39232d539cd7f399c8c57b6ec822aebf2e5b))
* インプット空の時にEnterフリックもターミナルへ送信できるようにする ([478e768](https://github.com/kt0319/any-console/commit/478e768cff7c42f63c1d4cae996ea57960e60993))
* キーボードバーの可視切替を v-if から v-show にして画面回転後の操作不能を解消 ([87dece2](https://github.com/kt0319/any-console/commit/87dece29469491c8237e091c2b7a586f2432aa26))
* キーボード表示・非表示時にターミナルをリフィットして最下行にスクロールする ([ed1d557](https://github.com/kt0319/any-console/commit/ed1d5579d607c5d0c9adc5abf9102a36d91bac5d))
* ターミナル再接続時に history 書き込み前へ fit を移動して画面崩れを防ぐ ([f9224cf](https://github.com/kt0319/any-console/commit/f9224cfcb75366266fde130987fd63c84b711ac4))
* ダイアログのフォーカス処理を整え、画像アップロードのサイズ上限ガードを補強 ([a0ca6a1](https://github.com/kt0319/any-console/commit/a0ca6a197ef1b2fd30d2023756d4e5972df41482))
* タブ切り替え時にターミナルの表示が崩れる問題を修正 ([6e7ef81](https://github.com/kt0319/any-console/commit/6e7ef8142df5eca3d231fdfbdb2bf32dfd429e95))
* ブート中にセッション復帰タブが存在してもステータスバーを非表示にする ([267c3a1](https://github.com/kt0319/any-console/commit/267c3a1570cff6c2ec2d9b378e26dcded9f1d4bb))
* フォームsubmitイベントでもEnterをターミナルへ送信する ([90a3f75](https://github.com/kt0319/any-console/commit/90a3f75e597bb1bbd6c61dbb1294eafd69865f71))
* ブランチパネルの Fetch 完了トーストをリスト更新後に表示するよう順序を修正 ([02ce63d](https://github.com/kt0319/any-console/commit/02ce63dec2d1ba715b234d2731f9a6f91569b7f9))
* ブランチパネルの REMOTE Fetch を同期的にロックして連打を防止 ([0ad8fdd](https://github.com/kt0319/any-console/commit/0ad8fddaee508a7b51d10bb92150f6404a6500dd))
* ミニモードの矢印キーでQWERTYキーボードが開かない問題を修正 ([69c1d13](https://github.com/kt0319/any-console/commit/69c1d13192582f8ec7db552f4b348806061cae84))
* リロード時に空画面でステータスバーの内容が残る問題を修正 ([c47e4a4](https://github.com/kt0319/any-console/commit/c47e4a44bc8939e898bb57b567891d96cbd58e70))
* 入力フォームの IME 変換中に Enter で誤送信される問題を修正 ([81cbc1d](https://github.com/kt0319/any-console/commit/81cbc1d229ce4939aff63be10be9040850ec7d8e))
* 入力モード切替時に layout:fitAll を即発火してターミナル表示崩れを軽減 ([0a6c116](https://github.com/kt0319/any-console/commit/0a6c11643690f07dd15838ccded934ec6c162a41))
* 日本語IME composing中でもdraft空の時はEnterをターミナルへ送信する ([cf2ee6d](https://github.com/kt0319/any-console/commit/cf2ee6db691d329439b181ef74c87c555816a4ad))
* 矢印キー連打時にCJK文字が二重表示される問題を修正 ([aebfb6e](https://github.com/kt0319/any-console/commit/aebfb6e3cc854d7f4b8730a1f01adb38162e853b))
* 重い出力中に定期的に term.refresh() を呼びキャンバス崩れを自動回復する ([a17fec7](https://github.com/kt0319/any-console/commit/a17fec7764cfadd82ee10553e04d1f3a5d2fc590))


### Refactor

* Changes パネルのファイルリストから外枠を撤去して Files タブと体裁を揃える ([5da1e26](https://github.com/kt0319/any-console/commit/5da1e26b1c586714254009a4a1fc359dd1638fca))
* EnterキーのロジックをuseEnterAction.jsに集約する ([45b3989](https://github.com/kt0319/any-console/commit/45b3989d92a29902d94a1795c0a90d26483cfdcb))
* GitHub パネルのアイテム高さをジョブ・ブランチに揃える ([bbd4c83](https://github.com/kt0319/any-console/commit/bbd4c8313437d93080e3226b62eef80efa78e984))
* RSSコードの不備修正とシンプル化 ([1d70c67](https://github.com/kt0319/any-console/commit/1d70c67d2b86a389db8b52ea42aefcdd2d08615d))
* ジョブパネルのセクション見出しを "Common jobs" / "Workspace jobs" に変更 ([b603b9a](https://github.com/kt0319/any-console/commit/b603b9aa99ac36a446f3d441706da0280a8a9e0f))
* タブ閉じ確認ダイアログのオプションを util に共通化 ([00b6394](https://github.com/kt0319/any-console/commit/00b6394e1f26604ca6fc59bc1b605265b2fa83f9))
* トースト発火を useToast composable に統一（part 1） ([722c6bc](https://github.com/kt0319/any-console/commit/722c6bc029e6d3c98eeaf98d80370a7419315ac9))
* トースト発火を useToast composable に統一（part 2） ([f4e68be](https://github.com/kt0319/any-console/commit/f4e68be938534d4591bd88dcecd9780c9e35a697))
* 不可逆操作の確認ダイアログを confirm-irreversible に共通化 ([852c649](https://github.com/kt0319/any-console/commit/852c64966150dadb9e8f7d7db90a7c76bb8f7a5d))


### Documentation

* CLAUDE.md にコミットメッセージは日本語の Conventional Commits とする規約を追加 ([1b3444f](https://github.com/kt0319/any-console/commit/1b3444f58a5b273b15c1d504510728503727ed19))
* Docker セットアップは demo/sandbox 用途であることを明記 ([7f0995a](https://github.com/kt0319/any-console/commit/7f0995a7f3bd5039e1e1535d81655e910f0d9532))
* HTTPS / Tailscale Serve のセットアップ手順をREADMEに追加 ([280f7b5](https://github.com/kt0319/any-console/commit/280f7b50d2ce5d4d0dbb5b88452983d203f74767))
* Project Stance のトーンを柔らかくして招き入れる調子に整える ([8b0bf7f](https://github.com/kt0319/any-console/commit/8b0bf7ff0f66e5c5f76883c033b6c7497c247c7a))
* README に Release / Last commit バッジを追加 ([de4c5b2](https://github.com/kt0319/any-console/commit/de4c5b2644f37c8213987b417b46952bd9c887c9))
* README にプロジェクトサイトのリンクを追加 ([425c4a7](https://github.com/kt0319/any-console/commit/425c4a7cc9547b6e7c1956c0428ea286ed66f600))
* README の Setup セクション冒頭に systemd と Docker の使い分けガイドを追加 ([3e31138](https://github.com/kt0319/any-console/commit/3e31138d5adf6ab72e270c868961800d18b4e772))
* README 冒頭にヒーロー画像を追加 ([24896e5](https://github.com/kt0319/any-console/commit/24896e5b4e012690bad74946ca7a6b8b2909f833))
* ホストは Linux 限定、クライアントは任意 OS の前提を Platform support に明示 ([debd8b0](https://github.com/kt0319/any-console/commit/debd8b02ec7730594cc7e8e42c8502c5724e2d9f))


### Tests

* formatRelativeTime の境界値テストの競合を修正 ([bb48ea8](https://github.com/kt0319/any-console/commit/bb48ea8fb141d1d34607f5dd6d4f6453c831bd14))
* RSSルーターのテストを追加してカバレッジを回復 ([f0af4cf](https://github.com/kt0319/any-console/commit/f0af4cf6817548e405f491ef4fe02f7d73ece081))


### CI

* release-please で release / CHANGELOG を自動化 ([f05ef03](https://github.com/kt0319/any-console/commit/f05ef0314be9d42ba590018ef2919c37fc7ea1f6))

## [Unreleased]

## [0.1.0] — 2026-05-25

Initial public release.

### Highlights

- **Seamless across devices.** Persistent tmux sessions reachable from any browser; switch between phone, tablet, and PC without losing context.
- **Mobile-first input.** Custom on-screen keyboard with flick / swipe gestures, snippet chips, and an enter / send mode that adapts to context. Practical enough to commit, push, and run scripts from a phone.
- **Jobs, Git, and terminal in one place.** Run shell jobs, drive git (branches, commits, push / pull, diff, history, stash, merge / rebase), and use a full web terminal without tab-switching.
- **Self-hosted, single-user.** Designed to live behind Tailscale on a homelab box; assumes you trust the device on the other side of the wire.

### Added

#### Web terminal

- xterm.js-based multi-tab terminal with split-pane (horizontal / vertical / grid).
- Tmux-backed persistent sessions; closing the browser does not end the session.
- WebSocket reconnection with backoff; resume after sleep / lid close.
- URL detection in terminal buffer; tap a URL to open externally.
- Image paste / drag-and-drop upload into the active terminal.

#### Mobile keyboard bar

- Minimum / full QWERTY toggle pinned to the bottom of the screen.
- Flick input for symbols, function keys, and arrows.
- Shift / Ctrl / Symbol / Fn modes with mutual-exclusion rules tuned for one-thumb use.
- Snippet chips for one-tap insertion of frequently used commands.
- Long-press repeat and accelerated repeat for arrows and backspace.
- Camera key to upload an image straight from the device camera.

#### Git UI

- Branch list, switch, create, delete.
- Commit history with graph and per-commit file diff.
- Working-tree changes view (numstat + per-file diff).
- Push / pull / fetch with upstream awareness; one-tap set-upstream.
- Stash list and apply / drop.
- Merge / rebase entry points.
- File browser with rename, delete, upload, download.
- GitHub pane: issues, pull requests, actions (requires `gh`).

#### Jobs / scripts

- One-tap shell script execution from a dedicated Jobs pane.
- Job definitions editable from the UI; per-job environment and cwd.
- Output streamed to a dedicated tab.

#### Workspace management

- Multiple workspaces (directories) with quick switching.
- Per-workspace status bar: branch, dirty indicator, ahead / behind, last commit message.
- Workspace open / close from the modal selector.

#### Layout and PWA

- Panel-bottom layout for narrow displays (mobile and narrow PC windows), with title bar and status bar adapted to the available width.
- PWA install support; service worker bypass list for development.
- Split-mode UI with drag-and-drop pane swap.

#### Operations

- `./any-console` CLI on Linux + systemd for setup / start / stop / update / logs.
- Docker Compose recipe for Linux / macOS / Windows.
- `./any-console update` for in-place upgrade on systemd hosts.

### Notes

- Single-user by design. Run behind Tailscale or another trusted network boundary; there is no multi-tenant auth model.
- Tested primarily on Raspberry Pi (Linux + systemd + tmux). macOS / Windows are supported via Docker.

[Unreleased]: https://github.com/kt0319/any-console/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kt0319/any-console/releases/tag/v0.1.0
