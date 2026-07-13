# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0](https://github.com/kt0319/any-console/compare/v0.6.0...v0.7.0) (2026-07-13)


### Features

* config.jsonのワークスペースパスをチルダ形式で保存するよう変更 ([1736ef8](https://github.com/kt0319/any-console/commit/1736ef8e31bd78b15fc7feaf3b908b867f11bc4c))
* dispatchモーダルにジョブ選択を追加（既存タブでは固定表示） ([d26e0c4](https://github.com/kt0319/any-console/commit/d26e0c491543bb757052121b57ce8e9192f59120))
* dispatchモーダルにブランチ作成切替・既存セッション選択を追加 ([452ad4f](https://github.com/kt0319/any-console/commit/452ad4fa7e85534471f84ee26036ac8ae39689c4))
* dispatchモーダルに既存/新規セッション切替ラジオボタンを追加 ([446b507](https://github.com/kt0319/any-console/commit/446b5079decbd414e25274263ec427acc406a0f1))
* dispatchモーダルのsession選択・branch作成・overrides修正 ([2752c40](https://github.com/kt0319/any-console/commit/2752c4025284b10907f73c4cf239369bfcdda879))
* dispatch承認ダイアログのタイムアウトを30秒から5分に延長 ([ecd97a4](https://github.com/kt0319/any-console/commit/ecd97a4b1fb503cb23fb76fa3265640cc2d52826))
* JobConfig画面をAdvanced折りたたみ・State icons UIを刷新 ([9c645c7](https://github.com/kt0319/any-console/commit/9c645c7697c811819f7b158bec744e5c1fde325d))
* job設定のAdvanced廃止・notify delay固定1分・通知にワークスペース名を追加 ([819fb85](https://github.com/kt0319/any-console/commit/819fb856da44f871456a9f378b8af74eadc6bfcc))
* setupでサービス登録した場合はそのまま起動まで実行する ([2e95f88](https://github.com/kt0319/any-console/commit/2e95f883b1e9ebe19059eb41e57e4b8a8152826e))
* setupの完了時に認証トークンを生成して表示する ([db90825](https://github.com/kt0319/any-console/commit/db908258abfb4e4f076cdbda44d00abd754ff7a5))
* System Infoのプロセス一覧にkillボタンを追加 ([ebe271e](https://github.com/kt0319/any-console/commit/ebe271e530429d2a355d8a60e8ba158b33aab590))
* uninstallコマンドを追加・setupのトークン表示に使い方の説明を追加 ([1edfe36](https://github.com/kt0319/any-console/commit/1edfe361b6eebb8204acb0fed5b4ff9044edb095))
* working状態をタブ・ピルの背景アニメーションで表現しスピナーを廃止 ([65be76e](https://github.com/kt0319/any-console/commit/65be76e1af357162502e5a2da3851be40af8c93d))
* worktree削除の確認ダイアログを削除完了までRemoving表示で維持するよう変更 ([2cd5676](https://github.com/kt0319/any-console/commit/2cd5676e2b533a4bd1f7492671f757c83142eeb3))
* クリップボード画像貼り付けをmacOSでも動作するよう対応 ([c61572c](https://github.com/kt0319/any-console/commit/c61572cad65a5a5adba18f36539f1f3e37df2c8c))
* ジョブのフレーズ検知をbloced/done統合リストに変更しアイコンを語句ごとに設定可能にする ([1001e81](https://github.com/kt0319/any-console/commit/1001e81f4735bf581c064be0b843c34fa8eab216))
* ジョブの検知語句によるエージェント状態バッジを追加 ([de7c8eb](https://github.com/kt0319/any-console/commit/de7c8eb692317afb236f4ea94f7df3bdb55ad5a3))
* ジョブ設定に working_enabled フラグを追加してoutput変化検知を制御可能にする ([e407be3](https://github.com/kt0319/any-console/commit/e407be352aaf07e73679c7b30f8be1f7c447b177))
* バックグラウンド時もphrase検出を継続してpush通知を送れるようにする ([1ebcccc](https://github.com/kt0319/any-console/commit/1ebcccc76a92db5d100beef647f64bb47bae0aa6))
* ポート検出トーストに1件の場合はpreview URLを表示する ([2b02f7c](https://github.com/kt0319/any-console/commit/2b02f7c594c8a204ea086d75b6af15bb50cf91f7))
* レート制限の上限を環境変数ANY_CONSOLE_RATE_LIMITで上書き可能にする ([94cdf23](https://github.com/kt0319/any-console/commit/94cdf231feb849ac06e86033531985dd655b8564))
* 空きペイン画面（Open a tab in this pane）にStop splitボタンを追加 ([f9bbdde](https://github.com/kt0319/any-console/commit/f9bbdde6d0ea5cb735f3878d71272c92ac05c62d))
* 通知クリックでタブ開く・通知タイプ別オン/オフ設定を追加 ([e6c3c86](https://github.com/kt0319/any-console/commit/e6c3c866eb99dca59015a71f7251c989a8d39c6c))


### Bug Fixes

* agent_watch.pyの戻り値型注釈を明示しmypy errorを解消 ([6dd688c](https://github.com/kt0319/any-console/commit/6dd688cde2d7824ef86af6bf91b7f2798bcfaf3e))
* ANY_CONSOLE_RATE_LIMITの0以下の値を拒否して既定値にフォールバックする ([446daaa](https://github.com/kt0319/any-console/commit/446daaab03ace27dfcd48fa79df229bd318b10bc))
* changesパネルが空欄になるケースにエラー・空状態メッセージを追加 ([834dd2a](https://github.com/kt0319/any-console/commit/834dd2a535e3d0dc1883aa0108ec45af01d87f6e))
* collect_agent_states の戻り値変更に合わせてテストを修正 ([49c4b54](https://github.com/kt0319/any-console/commit/49c4b549b60cc85ea6ef3c6ed717787c9f3fbb24))
* DispatchRequestPayloadにexisting_session_idの型定義を追加 ([8d51fce](https://github.com/kt0319/any-console/commit/8d51fce417b3f32e110cecc4078ff3e6f96ad048))
* dispatchモーダルに既存セッションの実際のジョブを表示 ([1241280](https://github.com/kt0319/any-console/commit/124128059c96f29be90062e8bd8f7f10cf13d8dd))
* E2Eテストのログインヘルパーでbodyクリックしてキーボードフォーカスを確保 ([3bcd988](https://github.com/kt0319/any-console/commit/3bcd988b281ad2fb64c216e5551f8921692c2edd))
* E2Eログインヘルパーのbody.clickがモバイル画面中央のボタンを誤タップする不具合を修正 ([e8b4508](https://github.com/kt0319/any-console/commit/e8b4508d22d60f10ce88495f4584ebefd94dceac))
* git_watchのdistディレクトリ監視を除外してビルド時の誤検知を防ぐ ([d378d65](https://github.com/kt0319/any-console/commit/d378d65affb3379944da7924db272c1ac1880888))
* gitバージョン差でorigin/HEADが偽ブランチとして混入する不具合を修正 ([bbfc4a9](https://github.com/kt0319/any-console/commit/bbfc4a98ead259b67eb13170fc2c72465d4d592e))
* https-setupの証明書chownをmacOSでも動くよう修正 ([ebe5479](https://github.com/kt0319/any-console/commit/ebe547975592bf1ea9a3c31682fc478e798a1f66))
* launchd再登録時にdisable状態でbootstrapが失敗する問題を修正 ([24adceb](https://github.com/kt0319/any-console/commit/24adcebc94bdc659a1e917a9f57d264375f4fea6))
* macOS LaunchDaemonをLaunchAgentに変更してhome以下のSSL証明書が読める問題を修正 ([b2e66f1](https://github.com/kt0319/any-console/commit/b2e66f1c3566811a354671e1f10a30b278cd642e))
* main.pyのimport順をruffに合わせる ([e0e90c3](https://github.com/kt0319/any-console/commit/e0e90c32f5edb7f1572e85064930a836d5799956))
* resume・WS再接続中はエージェント状態バッジをクリアしworkingアイコンが出ないようにする ([e018086](https://github.com/kt0319/any-console/commit/e0180860890cf27ca931a33463e813cc7dffd5bf))
* setupのOpen表示をHTTPS優先・単一URLに簡略化 ([a566d70](https://github.com/kt0319/any-console/commit/a566d70dca56d14470361332dea218b75f51a784))
* setupのサービス登録とHTTPSプロンプトのデフォルトをYに変更 ([ca9b031](https://github.com/kt0319/any-console/commit/ca9b031554897b8020402d81e12fa04980928067))
* setupのトークン生成でvenv_pythonの呼び出し方を修正 ([2a4fe76](https://github.com/kt0319/any-console/commit/2a4fe76cb44a9ebe34f53ccba6a1afd2b529b259))
* statusとrunのURLをhttps-setup済みの場合はTailscaleホスト名で表示 ([c870b3f](https://github.com/kt0319/any-console/commit/c870b3ffbd7933306ce234c179faac1a8d59ea48))
* tailscale_hostnameをmacOSの一般的なインストールパスに対応 ([bf1c8c8](https://github.com/kt0319/any-console/commit/bf1c8c830758bcb4d4d98d1d64568a62ef82e72b))
* workingタブのアニメーションを横グラデーションシマーに変更 ([3e4ad8d](https://github.com/kt0319/any-console/commit/3e4ad8d1575e1bccf33eacfe897494e99b5efe07))
* WorkspaceDetail表示中にgit:openFileModalを受け取るとペインが切り替わらない問題を修正 ([0119144](https://github.com/kt0319/any-console/commit/0119144e4ea6987c1d82840e826d52ca545592a3))
* workspaces.pyの行長オーバーをruffに合わせて修正 ([63f85fb](https://github.com/kt0319/any-console/commit/63f85fb98146343673b9ac4369fca81dd0d91509))
* WS reconnect後4秒間はworking状態を抑制しタブ切替による誤検知を防ぐ ([0c2da57](https://github.com/kt0319/any-console/commit/0c2da57d6955c8a21571f17a4c6615f79ccb6c85))
* キーボードバーの色をCSS変数に統一しステータスバーと背景色を合わせる ([210ec05](https://github.com/kt0319/any-console/commit/210ec05f6389edb46a972f026142eafd052418e2))
* ステータスバーのchanged_filesをChangesタブのファイル数と一致させる ([49f1dac](https://github.com/kt0319/any-console/commit/49f1dac9c85904f035e9e8dc2fa539653c8d028f))
* ステータスバーのコミットメッセージがコミット後に即時更新されない問題を修正 ([4291eb9](https://github.com/kt0319/any-console/commit/4291eb9af7188feb7a02f44932902ad31f8db822))
* ステータスバーのブランチ表示を末尾省略に変更しチケット番号が見えるようにする ([3061afb](https://github.com/kt0319/any-console/commit/3061afb6ccd69ba47521c2b6b58de1ac6d65e60c))
* スプリットドロップゾーンの4隅がタブドラッグで反応しない問題を修正 ([b4e55bd](https://github.com/kt0319/any-console/commit/b4e55bdf5d4af5d2bb4cdda57fc90d47d02507aa))
* スプリット済みペインから別軸方向へのピルドロップで遷移できない不具合を修正 ([8474009](https://github.com/kt0319/any-console/commit/8474009b28654966d224ce5ae1c143593c553113))
* ポートプレビューのポート検出をmacOSでも動作するよう修正 ([9d44d55](https://github.com/kt0319/any-console/commit/9d44d552e31197982829155a98462a77c33856e6))
* リサイズ時に _last_capture をクリアして working の誤検知を防ぐ ([a20f537](https://github.com/kt0319/any-console/commit/a20f5377fd14b6ded2382052c68c38e1189fd969))
* リサイズ時に _last_states の stale な working も除去してresume後の誤表示を防ぐ ([256686e](https://github.com/kt0319/any-console/commit/256686efa59e31f5f3c0a1b43f745deb0cafb5a0))
* リモートブランチ一覧取得とfetchでSSH認証環境を渡すよう修正 ([7fe9f2a](https://github.com/kt0319/any-console/commit/7fe9f2a69b6e4bdbaa368e07d932d065bea35052))
* ワークスペース削除中にボタンをDeleting...に変えて二重送信を防止 ([88a2412](https://github.com/kt0319/any-console/commit/88a2412012ddeb5064137efdb4926998dd2e578e))
* ワークスペース削除後にトーストで完了を通知する ([a035bd3](https://github.com/kt0319/any-console/commit/a035bd3235bce88d577eea508e121c90935219a4))
* 分割E2Eテストのピルセレクタを可視要素に限定 ([a211f75](https://github.com/kt0319/any-console/commit/a211f75e99c6fe463c23c4964e626ead053931db))
* 折り返し行URLをisWrappedと行末文字判定の両方で連結する ([170e851](https://github.com/kt0319/any-console/commit/170e85116d3535ad2c6ad9320bd0ab56fe306d42))
* 折り返し行をまたぐURLをisWrappedで正確に検出する ([7b70abd](https://github.com/kt0319/any-console/commit/7b70abd5fe9e8b173e92503746361288b5afeacb))
* 複数ポート同時検出時はまとめてトーストで通知 ([c931d61](https://github.com/kt0319/any-console/commit/c931d610a3953a238b6fb0150fb18c3eba0d124f))


### Performance Improvements

* watchfiles起点のgit情報更新をdiff/status3本に絞って高速化 ([44c0c5e](https://github.com/kt0319/any-console/commit/44c0c5e74a89d0d90716e5b3e1a777101db73f5e))
* バックグラウンド並列度・レート制限・UIポーリング間隔を引き上げ ([cbea42e](https://github.com/kt0319/any-console/commit/cbea42e00f50395f4c59840c3cedd13fcf5fe279))


### Refactor

* dispatch関数の複雑度を下げるためセッション解決処理を関数に切り出す ([b3933c0](https://github.com/kt0319/any-console/commit/b3933c08c10a4770532a058e369260866917597a))
* state icon / watch_phrases を単一の notify_phrase に置き換え ([4a265de](https://github.com/kt0319/any-console/commit/4a265de3276decf0fa8f79d9c13c628c66fc4792))


### Tests

* agent-state.jsのmdi-state・watch_phrases系関数のテストを追加しカバレッジ閾値を回復 ([341bacc](https://github.com/kt0319/any-console/commit/341baccc048ddec2e2fae48fec95780cc24c6c12))
* E2Eスモークを設定モーダル・ターミナル・モバイルに拡充 ([0b830ee](https://github.com/kt0319/any-console/commit/0b830eef3e3d0d42d09180967588065d7a4a9587))
* Port PreviewのE2Eスモークを追加 ([dd7ff7f](https://github.com/kt0319/any-console/commit/dd7ff7f32437fd70a7070325048846b11db4d136))
* ターミナル分割のE2Eスモークを追加 ([5ca27fa](https://github.com/kt0319/any-console/commit/5ca27fa13d5ba88e842ebbf43d6787d663018902))


### CI

* macOSでの非対話setup〜起動疎通確認をCIに追加 ([0c66d29](https://github.com/kt0319/any-console/commit/0c66d2906a607c977cbec57419b8e7d2169334f8))

## [0.6.0](https://github.com/kt0319/any-console/compare/v0.5.0...v0.6.0) (2026-07-06)


### Features

* detachedジョブ起動時にバックグラウンド開始トーストを表示 ([989a95d](https://github.com/kt0319/any-console/commit/989a95dc360369c9338be9ae22382e70ed6ac767))
* dispatch承認/否決時に全クライアントのモーダルを閉じる ([1f8de69](https://github.com/kt0319/any-console/commit/1f8de6932ec1cefe55c479e134349009a2948d2c))
* gitステータスをFS監視とWebSocket pushでリアルタイム更新する ([fe1c243](https://github.com/kt0319/any-console/commit/fe1c24335499ba130a7cfa761192ca1bd9208313))
* hiddenタブをdetachedセッションに統合し、detached_tab設計に移行 ([c5b06bc](https://github.com/kt0319/any-console/commit/c5b06bc6353b1af3e2f16527c5f64511664d1ced))
* Push通知のVAPID subをOriginヘッダーから自動検出して永続化する ([70737e6](https://github.com/kt0319/any-console/commit/70737e673e9c77e66c4d0efb1ed02c0f69c73cf2))
* PWAプッシュ通知機能を追加（dispatch受付時に通知） ([416269b](https://github.com/kt0319/any-console/commit/416269b2339a14c9182b8c0112cd5700721970fb))
* setup で git リポジトリを自動検出し複数選択で一括登録できるようにする ([844f239](https://github.com/kt0319/any-console/commit/844f239c9c374919f9de2ad41e2ec98b132ff080))
* setup を venv 隔離・依存自動インストール提案・ヘルスチェック対応 ([7d225be](https://github.com/kt0319/any-console/commit/7d225be0175a1b94d3a435d934ce4443cfd9deb3))
* System InfoにUpdate確認とany-consoleセクションを統合 ([af4dc46](https://github.com/kt0319/any-console/commit/af4dc4655fc25e27575573b35024a284e4f1fb07))
* tooltipをJS実装に切り替えてモーダル内でも途切れないよう修正 ([c0112a4](https://github.com/kt0319/any-console/commit/c0112a45813fb5ad8995fcf926a0ab56065525ca))
* サークルキーパッドにNext Tab/Prev Tabアクションを追加 ([49d1d19](https://github.com/kt0319/any-console/commit/49d1d1957182125e35e3dc9ae98b7c0ec6e06311))
* ステータスバーにターミナルCWDをワークスペースとして登録するボタンを追加 ([a4245ca](https://github.com/kt0319/any-console/commit/a4245ca3e599e4f51134f634b259648ee72221dc))
* ステータスバーのChangesボタンを常時表示し、モバイルはdirty状態でHistory/Changesを切り替え ([43ea68e](https://github.com/kt0319/any-console/commit/43ea68e0de83f840ba33e5aafefa3506dd4f764b))
* ステータスバーのJobs・Filesボタンをモバイルでもアイコンのみ表示 ([68e6624](https://github.com/kt0319/any-console/commit/68e662403c2da57dbc17833a28b5e746fdc4d3f9))
* ステータスバーのJobs/FilesをHistoryボタン幅で動的に表示/非表示 ([933c90f](https://github.com/kt0319/any-console/commit/933c90f44ea017c8776917c04f950056834cbbef))
* タブ閉じるボタンを×に戻し・分割ピルを−（赤背景）に変更・push-upstream ラベルを「Push & Set Upstream」に修正 ([4bdf0e8](https://github.com/kt0319/any-console/commit/4bdf0e8cfca2b772375c25eb58b2bb91a79faf71))
* タブ閉じ確認ダイアログにDetachボタンを追加 ([aa4d55c](https://github.com/kt0319/any-console/commit/aa4d55c0ecbafdc605f5e55bb7b71288cc7d28d3))
* ピルインフォに×ボタンとツールチップを追加 ([a5f9882](https://github.com/kt0319/any-console/commit/a5f9882483960a7251983497c1d31f20e7479b2c))
* プル/プッシュボタンにツールチップ（data-tooltip）を追加 ([0c295ea](https://github.com/kt0319/any-console/commit/0c295ea688f77cea79284c334805512b565c0391))
* ポートプレビューをHTTPS対応しHTTP以外のポートを一覧から除外 ([e96fc9d](https://github.com/kt0319/any-console/commit/e96fc9d9f1a4fd0e59351a7b877611dbf9138a9b))
* ワークスペース一覧にワークスペース未指定でターミナルを開くボタンを追加 ([e8a585e](https://github.com/kt0319/any-console/commit/e8a585ee88fb8a58a6a46d4e4472bc7efaf12897))
* ワークスペース詳細モーダルのChangesアイコンに変更ありで青色を付与 ([e51c43d](https://github.com/kt0319/any-console/commit/e51c43d04f594fda83d9b42ef7db3d339cf13ab4))
* 入力フォームの履歴上限を20件から100件に変更 ([8233d0f](https://github.com/kt0319/any-console/commit/8233d0f659e79989476c81fd648380f7c8be837f))
* 素のターミナルと非gitワークスペースのUXを改善 ([7825f3a](https://github.com/kt0319/any-console/commit/7825f3a78bda8093ecb18262a101430f9277be20))
* 素のターミナルにワークスペース追加導線を統合 ([1aaaa3e](https://github.com/kt0319/any-console/commit/1aaaa3e0bea2cdc159a1d424fd43f5f85f76ddf1))
* 設定に Check for Update を追加しバージョンを表示する ([9e317d5](https://github.com/kt0319/any-console/commit/9e317d50dd441bc5fd3a8ba85c68d5d270117aac))


### Bug Fixes

* _is_https の mypy no-any-return エラーを解消 ([0d80426](https://github.com/kt0319/any-console/commit/0d804269430144183ea6457af4076c6467ffbc57))
* ⌘⇧T のショートカットを新規ターミナル起動に変更し、スタート画面にヒントを追加 ([cbce8d1](https://github.com/kt0319/any-console/commit/cbce8d1b3456b16a2f21336bb24499d245f4334f))
* Androidエッジスワイプ「戻る」ジェスチャーをキーボードバーのフリック操作中に抑制 ([9cafbfd](https://github.com/kt0319/any-console/commit/9cafbfdf845e860fff9987469e591d3b0a7b726b))
* auth/checkをasync化しスレッドプール競合を解消、WebSocket pingタイムアウトを延長 ([abf2cc8](https://github.com/kt0319/any-console/commit/abf2cc8647c8ee5bdf54d3879844645043ea0fc7))
* cryptography・pywebpushをrequirements.txtに追加 ([a876333](https://github.com/kt0319/any-console/commit/a87633390d3ebfc44a48ae73cc18c4221761a52f))
* DetachedタブをOpenした際にdetachedフラグをfalseに戻しリロード後も正しく復元されるよう修正 ([7131f38](https://github.com/kt0319/any-console/commit/7131f38151810e42a0dac5864ad16b110318b662))
* detachedフラグ設定時にセッション未登録でも tmux env に永続化されない問題を修正 ([a9965b6](https://github.com/kt0319/any-console/commit/a9965b64e445a52a15fa5088be1284e6622ca308))
* detached移行の積み残しを掃除しジョブのdetached起動を修復 ([24d83da](https://github.com/kt0319/any-console/commit/24d83da7fd6ab4901c8648305f95b898a1242025))
* dispatch のブランチ操作で subprocess 例外を捕捉する ([e6abc13](https://github.com/kt0319/any-console/commit/e6abc13e4a272b007d2c904ea4468f5bb35c6b6b))
* dispatch等で開いたタブにアイコンが出ない不具合を修正 ([8fe74fe](https://github.com/kt0319/any-console/commit/8fe74fe7141032916cdb78df5c962c9afcaf573c))
* dispatch通知をconfirm承認待ち前に送るよう変更 ([b369338](https://github.com/kt0319/any-console/commit/b36933844fd636172baf7b3b82e0c3249b5ed778))
* GitHub CLI タイムアウトを30sから8sに短縮しWebSocket切断を抑制 ([beeb45c](https://github.com/kt0319/any-console/commit/beeb45cd50d8600d14a7d7b6e918f74bca73d517))
* Jobs/Filesボタンの表示切替ループを修正（観測対象をnavGroupに変更） ([22d9c7c](https://github.com/kt0319/any-console/commit/22d9c7cda9fe959a32f3f5aa4d04cd6838644039))
* PCでターミナル非フォーカス時の日本語入力とmetaキーショートカットが効かない問題を修正 ([826c69b](https://github.com/kt0319/any-console/commit/826c69b42eecb5c9f5fd7c684ea72db4eba7d355))
* push 依存を任意化し未導入でもアプリが起動するようにする ([4c474de](https://github.com/kt0319/any-console/commit/4c474de2c1bb6996082c1252510eaa4edff8846a))
* QWERTYキーボードのFnビュー改善（Insertキー追加・カメラ移動・Esc配置） ([0a3681e](https://github.com/kt0319/any-console/commit/0a3681ecb550d9ed8c28b38f18d041c1df849168))
* splitピルの閉じるボタンを×からマイナス記号に変更 ([5bb6451](https://github.com/kt0319/any-console/commit/5bb6451950ce138f7fb6211c790fcef5995d5720))
* Tailscaleヘッダ自動認証をopt-in化し認証まわりのセキュリティを強化 ([a42f38a](https://github.com/kt0319/any-console/commit/a42f38a2d3a1c0b131a48f9d9948745c9e9bc36f))
* TMUX_DETACHED を TMUX_META_ENV_NAMES に追加し再起動後も detached 状態を正しく復元 ([e254b45](https://github.com/kt0319/any-console/commit/e254b45a026ff90ce34fdcad891badf3e648be4b))
* tooltip.js のイベントリスナーで EventTarget → HTMLElement に型を絞りCI型エラーを解消 ([64b3b71](https://github.com/kt0319/any-console/commit/64b3b714538f3253449c87921c18da6d397ec420))
* trusted deviceのLast seen表示が常にnowになる二重変換を修正 ([c9e9877](https://github.com/kt0319/any-console/commit/c9e9877ecd1c876f4d5dd1155500b0c24e3f2043))
* uvicorn.runのws_ping引数をアンパックから明示的指定に変更しmypy型エラーを解消 ([ba7fdbd](https://github.com/kt0319/any-console/commit/ba7fdbde95f8c952f36f9bca85a805887b89e6b1))
* VAPID秘密鍵をbase64url形式で保存しpywebpushとの互換性を修正 ([ed2819f](https://github.com/kt0319/any-console/commit/ed2819fcf5373a0657b2e965e20f77e114a67717))
* WS生存判定にreadyState=OPENと送信activityを加味し誤切断・誤検知を解消 ([a8e2c42](https://github.com/kt0319/any-console/commit/a8e2c426661c5addee14b3b7a0362051fcc233db))
* サークルキーパッドが取得失敗でdefaultsにリセットされる不具合を修正 ([ee00a96](https://github.com/kt0319/any-console/commit/ee00a96db74e118a86115425ae9df35301e0fcd3))
* ステータスバーのワークスペース切替ボタンのラベルを「Change」→「Open」に変更 ([aabf108](https://github.com/kt0319/any-console/commit/aabf10834b2fd2d4e99e351cbd891fd48ee87be3))
* ステータスバー未選択時ラベルと動作を修正・APIネットワークエラーの unhandled rejection を解消 ([8ec31ff](https://github.com/kt0319/any-console/commit/8ec31ffc09b7a97802feb6edfdef51d155f600a0))
* ソフトキーボードで特殊キーにCtrl/Shift修飾が乗らない不具合を修正 ([268f7bc](https://github.com/kt0319/any-console/commit/268f7bcfe2dfecaa02ebac3c27c950d6c4e66e46))
* ターミナルのURLリンク化が全角カッコ以降のテキストを飲み込む問題を修正 ([700c2e5](https://github.com/kt0319/any-console/commit/700c2e5bbc1a002ff7f848ac2c2691f5789479f7))
* ツールチップをSVG子要素ホバーでも発動するよう修正・GitActionBtn の title 属性を削除し aria-label/data-tooltip に統一 ([679eee5](https://github.com/kt0319/any-console/commit/679eee5bce846eaeb62fc3ee9c44f5db7d4ad103))
* デタッチセッション一覧で素のターミナルのtmux IDが表示される問題を修正 ([45d9c7d](https://github.com/kt0319/any-console/commit/45d9c7d554d6dececee6e906addeff70f2f1abfd))
* バイナリファイルを含むコミットのdiff取得時のUnicodeDecodeErrorを修正 ([d5f68c3](https://github.com/kt0319/any-console/commit/d5f68c3c82db4020297bd0143ec379ec20d0d266))
* ピルインフォとボタンの透明度を上げ、ボタン枠色を控えめに調整 ([4f3bcc7](https://github.com/kt0319/any-console/commit/4f3bcc7194311f7724db53906d0cd341546e4b13))
* ピルインフォの×ボタンを非スプリット時のみ表示に変更 ([05ed5e3](https://github.com/kt0319/any-console/commit/05ed5e31457e351f5d532d7264e6cb6c201fe40e))
* ピルインフォのボタン色を控えめだが視認可能な透明度に調整 ([65511bf](https://github.com/kt0319/any-console/commit/65511bf3739927ad1c523a95badc678b1086844f))
* ファイル一覧の一時失敗で即Failed to loadになる不具合を修正 ([03c765e](https://github.com/kt0319/any-console/commit/03c765e3980d005c8b45bcc6b711da49afa2a7e8))
* ポートプレビューのOpenボタンをwindow.openに変更し、iOS PWAのdata:ループバグを修正 ([9af6337](https://github.com/kt0319/any-console/commit/9af633701b7bf6836529b8097477b53e82d6c81a))
* リロード時にジョブタブのアイコンがmdi-playに固定される不具合を修正 ([dc4a40b](https://github.com/kt0319/any-console/commit/dc4a40bfdf8cb9e6c57e09be251f4867df58c267))
* リロード時にセッション取得の一時失敗でタブが復元されない不具合を修正 ([8579ce5](https://github.com/kt0319/any-console/commit/8579ce56ffce499424cd8f93d9cd678aac034f6a))
* レビュー指摘対応（登録済みworktreeの監視とFS監視無効時のポーリング継続） ([b06524b](https://github.com/kt0319/any-console/commit/b06524b4fbab52cc3c1554f6338a95a037ad9d5f))
* 不正な設定1件でサークルキーパッド等のグローバル設定全体がリセットされる問題を修正 ([cfeac6d](https://github.com/kt0319/any-console/commit/cfeac6df4c1a519f8bc913b5140efc3933a32662))
* 共有ref変更のworktree展開とWS切断時の購読解除漏れを修正 ([4546037](https://github.com/kt0319/any-console/commit/4546037971ae89151c3d544267fb15065ade7dca))
* 共有ref変更の展開漏れとFS監視失敗時のポーリング再開通知を追加 ([fcd6892](https://github.com/kt0319/any-console/commit/fcd6892b61fff3d843ae45c6b1ff721562a78279))
* 冪等なGET読み込みの一時失敗を自動リトライして空表示を防ぐ ([823650c](https://github.com/kt0319/any-console/commit/823650c54f87d85d227ebd6d5c0152004cff11b2))
* 実装と命名がずれていたユーザー可視の挙動を修正 ([af9d17f](https://github.com/kt0319/any-console/commit/af9d17fb3cb6adaf91d72b743da90efb518eadff))
* 接続監視のタイムアウトと閾値を緩和しconnection lost誤検知を抑制 ([cd1db76](https://github.com/kt0319/any-console/commit/cd1db76aee6e0ec8b1e44f96abfee81f459a6eee))
* 接続監視をWebSocket一次情報源に再設計しconnection lost誤検知を解消 ([7bb9271](https://github.com/kt0319/any-console/commit/7bb92711ca86ef16359f96671e6ad9830743a2da))
* 未コミットのリポジトリでステータスバーがLoadingのまま残る問題を修正 ([3bb5e1f](https://github.com/kt0319/any-console/commit/3bb5e1f01853c1348dfc6413dc82d5b78dab5d32))
* 通知タップ時に iOS Safari の「Open from URL?」確認ダイアログが出る問題を修正 ([6a3fa03](https://github.com/kt0319/any-console/commit/6a3fa0376921d4727aeb90b2afca2ffe70f829c5))


### Refactor

* config のマイグレーションを config_migrations.py に分離する ([a52920a](https://github.com/kt0319/any-console/commit/a52920a6a5118098d8e4f6ce3e01af4cb2cfbb1d))
* EmptyPane を SplitEmptyPane にリネーム ([4611cfe](https://github.com/kt0319/any-console/commit/4611cfe1573690bf326b27e76326bee40dac5652))
* git_info パイプラインを git_info.py に分離する ([ec2f041](https://github.com/kt0319/any-console/commit/ec2f041bba1a7cffde9a5403d30a21d10f6abef4))
* GitHub全部入りビューを削除しタブ別パネルへ一本化 ([0283954](https://github.com/kt0319/any-console/commit/02839545edfb15d301b0585c70529c9db8e04cbc))
* IconPicker のグリッド整形ロジックを純粋関数に抽出する ([220b6e4](https://github.com/kt0319/any-console/commit/220b6e4c1ea364daef08317073eee62fa75e932f))
* JobConfig の extractDomain 重複と URL 直書きを解消する ([0d08320](https://github.com/kt0319/any-console/commit/0d083206615ada5722e55b62ac9723fc8279006a))
* orphan sessionsをDetached sessionsに改名 ([49ce195](https://github.com/kt0319/any-console/commit/49ce19525c152659ec70a6dab2fd18b8546d5f80))
* Radial Key を Circle Key Pad にリネーム ([3519b9c](https://github.com/kt0319/any-console/commit/3519b9c2acda403e4d1981a7147772787d5f7e9e))
* recent jobsをサーバー保存からlocalStorageに移行しAPIエンドポイントを削除 ([c95858b](https://github.com/kt0319/any-console/commit/c95858bdf8320602c02586ec2125abd65ccc934b))
* run_git_raw に型注釈を追加する ([2cd2dbf](https://github.com/kt0319/any-console/commit/2cd2dbfd9bd0f771acd5e300ae05dda2c096fe7d))
* TabConfig の orphan セッション整形を純粋関数に抽出する ([ada86a7](https://github.com/kt0319/any-console/commit/ada86a79f8463289ff64f7d9fd65df7facf5f973))
* Tabs & Sessions画面のUI整理とメニュー配置を変更 ([9ce1adf](https://github.com/kt0319/any-console/commit/9ce1adf9adcea1339e175839c2a4d3080a8a22c9))
* tmux コマンド実行を共通ラッパーに集約する ([639660b](https://github.com/kt0319/any-console/commit/639660b95d0d2d68da6066c617211f5ba9e0b089))
* watchfilesを必須依存にしてステータスポーリングのフォールバックを廃止 ([81534c3](https://github.com/kt0319/any-console/commit/81534c387466677ff63e5f0a003e1388344e7569))
* Workspaceジョブパネルのcommon jobsをモジュール単位でキャッシュ ([ff57ca9](https://github.com/kt0319/any-console/commit/ff57ca972c7aeed75c14014e513a37f13783fc46))
* エディタ設定から{work_dir}テンプレート変数を削除 ([7f18e5f](https://github.com/kt0319/any-console/commit/7f18e5f10e6509d007b18ae70e899b17f2f99d91))
* コマンド変数収集を command-vars.js に抽出する ([4230ea1](https://github.com/kt0319/any-console/commit/4230ea1802e832563648a8e674a2d19f708e04f9))
* ステータスバーの git 表示ロジックを composable に抽出する ([944d71a](https://github.com/kt0319/any-console/commit/944d71ab6e3338dd8cb545c0965d76b797705591))
* ダイアログ共通シェル BaseDialog を導入しフォーカス管理を一元化 ([305f569](https://github.com/kt0319/any-console/commit/305f569705f9c2eb0b0149b79036d4c27b8be29d))
* デモ用Dockerセットアップを削除 ([4ab9beb](https://github.com/kt0319/any-console/commit/4ab9beb06b9e18a475d7ddf25653139fdfa7eba2))
* ブランチ追加ダイアログを composable に抽出する ([2d438d8](https://github.com/kt0319/any-console/commit/2d438d8f3798590d90191d77a4c2a469128fd7e8))
* 円形キーパッドの幾何計算を純粋関数に抽出する ([77acec8](https://github.com/kt0319/any-console/commit/77acec882e9789c85da1e73c092bd87027a11042))
* 命名・docstring を実際の挙動に合わせて整理 ([450415f](https://github.com/kt0319/any-console/commit/450415f72b25adb404a588aa060f9eb2db09aa0f))
* 小規模な重複実装を集約する ([6077dc2](https://github.com/kt0319/any-console/commit/6077dc29ed0914dde86f8c1bb5993c6372986a7b))
* 旧アーキテクチャの後方互換コードを削除 ([5c67563](https://github.com/kt0319/any-console/commit/5c675636bc40186622c8422f4e77720632c155cc))
* 更新をブランチHEADではなくリリースタグ単位に変更する ([25c66a0](https://github.com/kt0319/any-console/commit/25c66a006fcedf6d43fce4726f0bb194b9a0122e))
* 未使用コード・重複実装・到達不能なイベント配線を削除 ([98c7d26](https://github.com/kt0319/any-console/commit/98c7d264854b4177d87ff83af47ed3bfbf6da6ba))


### Documentation

* RPi5スレッドプール枯渇とconnection lost誤検知の調査・対応をDECISIONSに追記 ([420ff0e](https://github.com/kt0319/any-console/commit/420ff0e23bd2df5e1a218ee437990323d362647f))
* SECURITY.md を追加し脅威モデルと運用上の注意を明文化 ([c080ac9](https://github.com/kt0319/any-console/commit/c080ac920484b919d8ec64925fef24c2f131de05))
* セットアップ手順のgit clone先を~/any-consoleに統一 ([a815112](https://github.com/kt0319/any-console/commit/a815112a23382954c11acf8c82fca0f258423b52))
* 認証系環境変数がサービス起動に届かない旨をREADMEに明記 ([16d2065](https://github.com/kt0319/any-console/commit/16d2065ce80f843dd154b5a0b502bb6d2cd37b1a))


### Tests

* push通知のカバレッジテストを追加 ([1fe55c6](https://github.com/kt0319/any-console/commit/1fe55c6c73dc59a159bb5c3d773950b84d7562c2))
* work_dirの削除に合わせてシステム情報テストをinstall_dirに更新 ([ced2fca](https://github.com/kt0319/any-console/commit/ced2fca911d84cf483b8d6eb6544f5205fddf1ae))
* バックエンドカバレッジを 85.9% → 88.8% に引き上げ（git_utils/tmux/git_diff/git_branches/git_file_utils） ([cb3b3f9](https://github.com/kt0319/any-console/commit/cb3b3f99f187566095f05407e10cb15c32c155ea))


### CI

* E2E スモークを CI で毎回実行するようにする ([e01e4ff](https://github.com/kt0319/any-console/commit/e01e4ffe5d508008c1ee27071ff35e256425e24c))

## [0.5.0](https://github.com/kt0319/any-console/compare/v0.4.0...v0.5.0) (2026-06-25)


### Features

* dispatchダイアログ表示時に対象workspaceのタブを即アクティブ化 ([93aac58](https://github.com/kt0319/any-console/commit/93aac58822e7983674bce265a95d0766c7f4b90d))
* dispatchでアクティブ化するタブのhidden条件を撤廃し自動で可視化 ([1ac4700](https://github.com/kt0319/any-console/commit/1ac47004d0bc49b5defb9626185677b6e9e311af))
* dispatch確認モーダルでbranch/base_branch/textを編集可能に ([b42f2d7](https://github.com/kt0319/any-console/commit/b42f2d750f6e5475786de3d9f2dacf6689875b37))
* hiddenタブをdispatchの対象から除外しtmuxセッション環境変数で永続化 ([5b4819d](https://github.com/kt0319/any-console/commit/5b4819ddc3ac3e7362df5e25be19766d162bd4b0))
* macOSをlaunchdで常駐サービスとして一級サポート ([8d2c723](https://github.com/kt0319/any-console/commit/8d2c723977c8d69e29b90dc0d12db2d86ad66047))
* manifest に id フィールドを追加 ([03e3b41](https://github.com/kt0319/any-console/commit/03e3b412caa5d3789688ca7489ff29f85be5f401))
* Port Previewで自分自身のポートを表示しother user所有は除外 ([ce64580](https://github.com/kt0319/any-console/commit/ce64580fe03b789406945f94ab0c04d5c9e1377c))
* Port Previewのrefreshボタン位置調整とno-proxyポートの非表示化 ([de847b0](https://github.com/kt0319/any-console/commit/de847b059245bf2b3d3f6dc4ac935c562ce36595))
* Port Preview画面のUIを改善（ホスト名表示・ボタン高さ統一・pid表示整形） ([4035994](https://github.com/kt0319/any-console/commit/40359942bb76af5a2201b90bbdfcb1966cc4b9ab))
* PWAアイコンをフラットデザインに刷新 ([31579e8](https://github.com/kt0319/any-console/commit/31579e8d002a6aff96284b8bcd932ed42260c01d))
* PWAにmaskableアイコンを追加してAndroidのアイコン表示を改善 ([914f47e](https://github.com/kt0319/any-console/commit/914f47efdc82333950d60f207f9a3b712cab7926))
* radial キーの有効/無効チェックボックスを追加 ([85412e8](https://github.com/kt0319/any-console/commit/85412e82d679c986a85f3163b25bddc26a7f70bf))
* RSS機能を全て削除 ([f6dab55](https://github.com/kt0319/any-console/commit/f6dab5577565bf2e7fa2747904fbbc51a1455d00))
* stickyなShift/Ctrlトグルをフリックキー送信にも自動反映 ([0a0b75c](https://github.com/kt0319/any-console/commit/0a0b75c3785101a842e7af7a1ab82fc1a33d3c81))
* System Infoに認証方式（Tailscale/Token/Disabled）を表示 ([d0c68f7](https://github.com/kt0319/any-console/commit/d0c68f72fedfb9aea2943fd23d3bde45c8763cd4))
* System Infoのセクションヘッダーを強調して区切りを明確化 ([901d372](https://github.com/kt0319/any-console/commit/901d372de9c096b44cd4a1c923803078222d25a6))
* TabConfigにorphan tmuxセッション統合とhidden切替ボタンを追加 ([1ef2ca5](https://github.com/kt0319/any-console/commit/1ef2ca53aba0791851c437f0e42e3ba606244280))
* Tailscale経由のアクセス時にトークン認証を自動スキップ ([5aebe4f](https://github.com/kt0319/any-console/commit/5aebe4f42dada20fbf20986815e7e9f79081c644))
* Trusted Device認証を追加し、認証経路を問わずデバイス登録に一本化 ([7895504](https://github.com/kt0319/any-console/commit/7895504c3a51a3a2ef5f37afd107b4be60b014a7))
* WorkspaceDetail に Select & Copy タブを追加 ([6799ab3](https://github.com/kt0319/any-console/commit/6799ab3a50aea73f8b3b2426f1390a3ce770b743))
* サークルキーの特殊メニュー候補追加とsplitモードでのピルタップpane選択 ([dc7d9d1](https://github.com/kt0319/any-console/commit/dc7d9d1a48837b631616db7baefb9ca9a1f312ab))
* サークルキーパッドの割り当てを設定画面でカスタマイズ可能に ([8126b71](https://github.com/kt0319/any-console/commit/8126b71a4d7481cf87660b10cc1658655b08a0d6))
* サーバ復活検知時にWS再接続を即時トリガーする ([9c99c89](https://github.com/kt0319/any-console/commit/9c99c892df025eed1d556a8ef098f99414b5296e))
* ターミナルスワイプでサークルキーパッドを追加（8方向キー+四隅の特殊メニュー） ([b0003d1](https://github.com/kt0319/any-console/commit/b0003d13685a75f21ce8ba3c5b23b1bbec5f4a63))
* ターミナル選択モーダルにコピーと自動フォーマットを追加 ([f7c2f0a](https://github.com/kt0319/any-console/commit/f7c2f0aebe9a45ddb8f32f830eba644b9b10e9c1))
* ファイル削除トーストに削除したファイル名を表示 ([96f7262](https://github.com/kt0319/any-console/commit/96f72622e77678f8210c452343ad735787182e22))
* ローカルdev serverをユニークポートで露出するPort Preview機能を追加 ([e6fa2fb](https://github.com/kt0319/any-console/commit/e6fa2fbd21846938940d79124e38e086391db9cb))
* ワークスペース詳細とコミット履歴のブランチラベルに即時ツールチップを追加 ([aadbb44](https://github.com/kt0319/any-console/commit/aadbb44611a5d7a7a44d50385cf247144b5be68b))
* 入力モード中にEscキーで入力モードを抜けられるよう対応 ([d7337bf](https://github.com/kt0319/any-console/commit/d7337bf3bbb8fb6fade842b3282c042b2dff4a4f))
* 入力モード中の物理矢印キーを履歴/snippet切替に割り当て ([4682341](https://github.com/kt0319/any-console/commit/4682341bfbf6f5fa4b752f31c6c7b1d7be3bce9c))
* 再接続オーバーレイに何をしているかを括弧で表示する ([d771476](https://github.com/kt0319/any-console/commit/d771476d7e78e753d1295c13b262eea2bed1934f))
* 分割モードのタブピルに×ボタンを追加して分割から外せるようにする ([4789cb7](https://github.com/kt0319/any-console/commit/4789cb750d86278c1abaebdf67de0a7829699383))
* 分割モードの状態をサーバーに保存し再起動後も復元する ([ef59689](https://github.com/kt0319/any-console/commit/ef59689b5e14b606b97498b7b8e151e9d7eed396))
* 動的chunk読込失敗時に自動でリロードしてPWAキャッシュを復帰させる ([34de0da](https://github.com/kt0319/any-console/commit/34de0dac74e9268d72a3d2ec860e31bc14e617e0))
* 外部tmuxセッションをany-console管理化するAdopt機能を追加 ([b182a62](https://github.com/kt0319/any-console/commit/b182a62c56d55260947ef75b9600a79df681a2c4))
* 物理キーボードのキーを通常時はターミナルへ直接送信しShift+Spaceで入力モード切替 ([907c337](https://github.com/kt0319/any-console/commit/907c3376c2a8108b5ef5f58272420c3c7ab1f177))
* 物理キーボード検出後はプレースホルダにShift+Space案内を追加 ([4157ed8](https://github.com/kt0319/any-console/commit/4157ed8d563aff332ea6d1acf1e8c4f2fd5d2a34))


### Bug Fixes

* BUS_EVENTSをソート順に並び替えてfrontend testをpassさせる ([9ce90db](https://github.com/kt0319/any-console/commit/9ce90db44dc76086eec12f052a502e1ffa7eb5ff))
* devices.pyとdevices routerの型チェックエラーを修正 ([1f38efb](https://github.com/kt0319/any-console/commit/1f38efb6617b7dac395493e471d6507ecf704c46))
* edit job画面から戻るとjobsタブに戻るよう修正 ([bb52f3b](https://github.com/kt0319/any-console/commit/bb52f3bae83ebce3bec5d1fda635853f91ed6f19))
* hiddenタブへキー入力が送られる不具合を修正 ([fb8e2fa](https://github.com/kt0319/any-console/commit/fb8e2fa8d9e08680b22b2509a39618c97ec9ad59))
* history/snippet ナビで snippet 境界を越えたら途中入力を復元する ([3460de2](https://github.com/kt0319/any-console/commit/3460de28ec1ad20309803e9a9e63d22ffc422f62))
* iOS Safari/PWAでターミナルが上にずれて下が見えなくなる現象を修正 ([e88ddca](https://github.com/kt0319/any-console/commit/e88ddca4f021f0f3172a432ac5fad0df3b19d992))
* iPhone Mirroring経由でEnterが発火しない問題を回避してsubmit時に必ずEnterを送る ([01423f1](https://github.com/kt0319/any-console/commit/01423f1ed2dc89b577837c6ed7f2af7f935093a8))
* preview _last_accessをNone初期化しidleテストをCIで安定化、dispatchのテスト追加 ([37b82ab](https://github.com/kt0319/any-console/commit/37b82ab67ea5ba4335283934bcaed7a84bcdddcc))
* RSS削除時に残っていたテストファイルを削除 ([c1e0a2a](https://github.com/kt0319/any-console/commit/c1e0a2a5109823cb184819f7008f67491d75513d))
* ruff S104警告をnoqaで抑制（0.0.0.0バインドは意図的） ([e96bd64](https://github.com/kt0319/any-console/commit/e96bd64f72c95be19c1a476f7c38b3824e5b9159))
* submit関数に二重発火ガードを追加してiOS SafariのEnter重複を防止 ([8294b4e](https://github.com/kt0319/any-console/commit/8294b4eab621287b34708baaa78f314d12ba4b8e))
* Trusted Devicesで同一UAのTailscale再認証時にデバイスが重複登録される問題を修正 ([85159c2](https://github.com/kt0319/any-console/commit/85159c251f13860cff826457dc030274f2202c83))
* useDispatchPromptに型注釈を追加してfrontend typecheckを通す ([ef75cfb](https://github.com/kt0319/any-console/commit/ef75cfb0ae8e6c6e45382ac5c11d598fd8371630))
* タブ一覧の目アイコンのhoverをPC限定にしてモバイルの色残りを修正 ([ad3d359](https://github.com/kt0319/any-console/commit/ad3d359d2af56d27f55b81e785759f689ca76429))
* プレビューとアイコン描画の安全性を強化 ([7752193](https://github.com/kt0319/any-console/commit/7752193c80543f1ad44cb90b9263be24f2338c76))
* ポートプレビューのTCPプロキシをTailscale IP経由でもアクセス可能にする ([9bf49fd](https://github.com/kt0319/any-console/commit/9bf49fdeb9c5e0c1f52254391bf456ccd750281b))
* モバイルで分割モードが横並びになるCSSの優先順位問題を修正 ([876cdd2](https://github.com/kt0319/any-console/commit/876cdd2f60552d42ee479658b589c3822b007b52))
* 入力submit時のEnter同時送信を撤回しtext送信のみに戻す ([aabdda2](https://github.com/kt0319/any-console/commit/aabdda2724bcd4f5a709c8ed3fbe2dd5b4169a96))
* 分割モード復元でPUT保存失敗・非アクティブペインが真っ黒になる不具合を修正 ([0b63e81](https://github.com/kt0319/any-console/commit/0b63e81025d18b383c147e803dfeb95416558cc7))
* 物理Enterキー時のみsubmit末尾にEnterを付与しiPhoneミラーリングでも確実化 ([659761e](https://github.com/kt0319/any-console/commit/659761ed08bb98300ee336a77b8545464771e191))


### Performance Improvements

* アセットを長期キャッシュ化しMDIフォントをwoff2のみに絞って初回・再訪を高速化 ([f1d3759](https://github.com/kt0319/any-console/commit/f1d3759d16b8466f0b5c001d7b941b1d9ce88dbc))


### Refactor

* blur抑制とflick処理とWS送信を共通composable/utilsへ分離 ([fe77f44](https://github.com/kt0319/any-console/commit/fe77f441aea2c66d2c7c11ca4611c366e9a66f92))
* git remote アクションの並行マップを1つに統合 ([48732c8](https://github.com/kt0319/any-console/commit/48732c8a69441fe330ceb53e16a52ecfb0f6bc41))
* iPhoneミラーリング対応を削除しテキスト送信時にEnterを付けないよう統一 ([2d26194](https://github.com/kt0319/any-console/commit/2d26194b82793972c18743700df059fe4c3d88b7))
* Select & Copy を WorkspaceDetail タブに統合し旧モーダルを削除 ([d677568](https://github.com/kt0319/any-console/commit/d677568738aa4464334ab05032071876af978b65))
* System Infoのtmuxセクションを削除（Tabs画面に統合済みのため） ([0e2355a](https://github.com/kt0319/any-console/commit/0e2355ae3ca5e903473a133ab3f6a7b5933fb2e5))
* System Infoのtmuxセッション表示からattachedタグを削除 ([4a9470d](https://github.com/kt0319/any-console/commit/4a9470de4a68744ca434f7892cb78485cdbfa7e8))
* WorkspaceDetail のバッジ件数管理を composable に切り出す ([8fd95f7](https://github.com/kt0319/any-console/commit/8fd95f7df38776023a8139be8facdefa19dae024))
* ターミナル本体のタップ・スワイプ操作を無効化し長押しのみ残す ([34b7439](https://github.com/kt0319/any-console/commit/34b7439d8c716b55d98603142ce6ea18dc8a36a3))
* モーダルの保留Promise管理を共通ヘルパーに統合 ([63330d5](https://github.com/kt0319/any-console/commit/63330d5cc83ac764fd314212a2db347436b223f4))
* 冗長な三項演算子と広すぎる例外捕捉を整理 ([0ba0353](https://github.com/kt0319/any-console/commit/0ba03531ab240ca1aac771261a721028dc89924b))
* 物理キーボード処理をcomposableに分離しIME/編集要素判定を共通化 ([e4c9ce0](https://github.com/kt0319/any-console/commit/e4c9ce06227895003b26a11f7fe3837e7c70f324))
* 矢印フリック処理の重複を共通化してテストを追加 ([12c27d9](https://github.com/kt0319/any-console/commit/12c27d952c0bc5ff7d59df0a206a9ddd9f63e5e2))
* 過剰な認証フォールバックとpreview二重プロキシを整理する ([4ebeeb8](https://github.com/kt0319/any-console/commit/4ebeeb84d1c9d52acf18d9636bc136115e441484))


### Documentation

* ADR [#10](https://github.com/kt0319/any-console/issues/10) を allowlist 方式と precache 自動生成に合わせて更新 ([0624bc7](https://github.com/kt0319/any-console/commit/0624bc7b91f0893baade923049849094a5dc94ec))
* BUS_EVENTSのソート順維持ルールをCLAUDE.mdに追加 ([672fcb8](https://github.com/kt0319/any-console/commit/672fcb8051be721c7915d37869815401728f6dfb))
* DECISIONS.mdのADR日付を実際の実装月に訂正 ([e20c9d3](https://github.com/kt0319/any-console/commit/e20c9d3d718fed4d31f8bb60c8eb5a341474bd7b))
* 新機能追加時にテスト・型・lintを必ず通すルールをCLAUDE.mdに追加 ([3b561ab](https://github.com/kt0319/any-console/commit/3b561abbdff4c80b0c72f4e27291c0b5dacc3c6b))


### Tests

* key-ansiとradial-key-presetsのユニットテストを追加しカバレッジ閾値を回復 ([f51520d](https://github.com/kt0319/any-console/commit/f51520d26ea15bd660d7d18d7ff64e76736a8071))
* Port Preview proxyの実データ透過テスト追加でカバレッジ余裕を確保 ([eaca3e2](https://github.com/kt0319/any-console/commit/eaca3e27794b83ee245988f5f53806661fab1181))
* Port Preview用テスト追加でカバレッジ85%を維持 ([e2dd69c](https://github.com/kt0319/any-console/commit/e2dd69c907359826b3e359e06629a8fc8aabf24d))
* settings APIのテストを追加してカバレッジ85%を回復 ([586f163](https://github.com/kt0319/any-console/commit/586f163980f1f88067c69db9aa16e0841bd5da40))
* ターミナルタブのactive再選出テストを追加 ([7fe20a1](https://github.com/kt0319/any-console/commit/7fe20a18cab0042e32538f35d47d0b90f84e0a7e))


### Build

* package-lock.jsonにplaywright依存を反映 ([bbe7eb6](https://github.com/kt0319/any-console/commit/bbe7eb678ae2877f6bd67362afc36a4cdee1fd5f))
* Playwrightスモーク E2E を手動実行用に追加（CI対象外） ([69677fc](https://github.com/kt0319/any-console/commit/69677fc71e40176ae196171174f385a2db34346a))
* SW の precache 一覧をビルド時に dist から自動生成する ([9084618](https://github.com/kt0319/any-console/commit/90846181ff67165a10e7856e24efcc884f28287f))

## [0.4.0](https://github.com/kt0319/any-console/compare/v0.3.0...v0.4.0) (2026-06-14)


### Features

* dispatch/ディープリンクをworktreeに対応し、dispatchに確認スキップオプション追加 ([320f9d0](https://github.com/kt0319/any-console/commit/320f9d04918f434cb23b0c1562e3da769558556d))
* dispatchのreuse判定をworkspace一致のみに緩和（matchパラメータで切替可能） ([211b94e](https://github.com/kt0319/any-console/commit/211b94e0111113e49c0e146d455749bc040ace3c))
* dispatch実行前にUI側で確認ダイアログを表示するSSEフローを追加 ([536f8c6](https://github.com/kt0319/any-console/commit/536f8c669ba44ff3666924f4024122ac7f7fa1e7))
* dispatch承認後にそのタブへ自動フォーカスする ([a09a289](https://github.com/kt0319/any-console/commit/a09a289b9806fee38a94deafa42115c53429e6b7))
* dispatch確認ダイアログにブランチ状態を表示し、テスト追加でカバレッジ修正 ([16ca57d](https://github.com/kt0319/any-console/commit/16ca57d1688f2b04428862837b20c780f11f56cd))
* Select & Copyでターミナルの全スクロールバックを開けるよう改善 ([1fcbbde](https://github.com/kt0319/any-console/commit/1fcbbde55ce1ba996a654964750ed012c50da791))
* System InfoのClientセクションに現在URLを表示 ([67e1c12](https://github.com/kt0319/any-console/commit/67e1c126a3d603e3dcc5a341d656da2caa95e33e))
* URLディープリンクで確認モーダルとbase_branch指定に対応 ([ca9dc55](https://github.com/kt0319/any-console/commit/ca9dc556fcee17f7d14c1be5583a83b759943e14))
* URLディープリンクにbranchパラメータを追加 ([44c9799](https://github.com/kt0319/any-console/commit/44c979963e2e4e5530f522082e6d0d023dfe6787))
* カスタムキーボードのEnterキーでShift+Enterを送信できるよう対応 ([555a05e](https://github.com/kt0319/any-console/commit/555a05e1e3ce17b37e41c19f3176180ac02b18de))
* ディープリンクでのブランチ新規作成時に名前を編集可能に ([688fcd5](https://github.com/kt0319/any-console/commit/688fcd56873cf7eb391e14fd5dd4d5c474859f11))
* ディープリンクのworkspace別名対応・既存タブのアクティブ化・作成元ブランチ表示 ([52ff6eb](https://github.com/kt0319/any-console/commit/52ff6ebbfec21e2f2482ef0bfd2a2cf9407dbbc8))
* ディープリンクのブランチ指定で切替確認と未作成ブランチの作成に対応 ([68b6e00](https://github.com/kt0319/any-console/commit/68b6e006ceb35900188dd6a33369e8db04931b11))
* トーストのスワイプ閉じはactionを発火しないよう変更 ([15961eb](https://github.com/kt0319/any-console/commit/15961eb903389c53250d2b502f077ac0c667335e))
* トーストをフリックして閉じられるようにする ([16ca5d5](https://github.com/kt0319/any-console/commit/16ca5d53a22f5bb0457a2bc1a7ccec014a1b22d6))
* 外部APIから新規セッション起動とプロンプト送信を行うdispatchエンドポイントを追加 ([f7b52f3](https://github.com/kt0319/any-console/commit/f7b52f3c131992e91e728f917f82506792276f9d))


### Bug Fixes

* actionSummaryのbranchNote型注釈をnull/undefined許容に修正 ([9506126](https://github.com/kt0319/any-console/commit/950612656cb845378796c7c4115db2efaa4abdac))
* browserタイプのjob実行時にダイアログを閉じないよう修正 ([a75cc11](https://github.com/kt0319/any-console/commit/a75cc1178e98898562b1827e05347a1f01bd191c))
* buildDeepLinkMessageの引数型にworktreeを追加 ([c52e2e4](https://github.com/kt0319/any-console/commit/c52e2e495d289d254c88311b5718a295fc6caa5b))
* dispatch routerのlint指摘を修正（行長・複雑度） ([06c3ecb](https://github.com/kt0319/any-console/commit/06c3ecb11f70c3f581b6973a2e9693f12948bf1a))
* grouped tmux sessionを別プレフィックスにしてタブ一覧から除外する ([a2b5573](https://github.com/kt0319/any-console/commit/a2b5573ea6cb9b067ff40e0382330043bab052eb))
* RSSフィードとグループのダイアログにアクセシブルネームを付与 ([aa1ca37](https://github.com/kt0319/any-console/commit/aa1ca37a66a4dde76edbd96b5095c25ca846889c))
* ターミナルのリサイズを ioctl に一本化して表示崩れを防ぐ ([41209a5](https://github.com/kt0319/any-console/commit/41209a575c274892534a66309423ee7ce14d79bd))
* ターミナルのリサイズをサイズ変化時のみ適用して崩れと未リサイズを解消 ([c65f3f7](https://github.com/kt0319/any-console/commit/c65f3f7acd5f21e3e7f0a300ab1f4798c192313e))
* ターミナルをWSクライアントごとにgrouped tmux sessionで独立アタッチする ([dcb613a](https://github.com/kt0319/any-console/commit/dcb613a16bfe75a2c123e83ed2f38f3c3a085ce3))
* タブclose後にnextTickを挟んでからterm.dispose()を実行しタイムラグを解消 ([911795f](https://github.com/kt0319/any-console/commit/911795ffd8e0dc908be625a98bcde3f0e73cca1c))
* トーストのスワイプcloseをマウスでもできるようPointer Events化 ([ccfd630](https://github.com/kt0319/any-console/commit/ccfd630455494e8eefdb108fb32c355651f1c846))
* ドラッグ並び替えとファイルアイコンとセッション整列のnull安全性を修正 ([8c62406](https://github.com/kt0319/any-console/commit/8c62406107981e050d64d8682a065d2e62614047))
* ホイールスクロールを常にxtermスクロールバックに統一 ([d21ccf2](https://github.com/kt0319/any-console/commit/d21ccf2bdaa94be6d1f5f1d4cb19c30df06cc471))
* モバイルでのターミナル表示崩れの残存要因を修正 ([49f816c](https://github.com/kt0319/any-console/commit/49f816c6e83cb894edb424dc04262e5e1b4992fb))
* モバイルでのターミナル表示崩れの残存要因を修正 ([f6d9d14](https://github.com/kt0319/any-console/commit/f6d9d14a3bc3386c57ac0b5faecc36d76d4c5265))
* 再起動後に非アクティブターミナルが最小サイズで表示される問題を修正 ([6dbb75a](https://github.com/kt0319/any-console/commit/6dbb75ad61e0271a6d27178f2b033aab4bfe1bed))
* 分割で生成した composable の型エラーを解消 ([919e66c](https://github.com/kt0319/any-console/commit/919e66cbdd13a20b453f724a244e78dc65bc4837))
* 残存grouped tmux sessionを起動時に掃除しセッション上限の枯渇を防ぐ ([d84fca6](https://github.com/kt0319/any-console/commit/d84fca6acdca9dbfc94d4277e011ed9dd473c832))
* 非アクティブ復元タブ切り替え時にWSが二重接続されて表示が崩れる問題を修正 ([f19700d](https://github.com/kt0319/any-console/commit/f19700d72f3f83a8eff3279728fdb2fdd4defde9))


### Refactor

* App.vue のグローバルCSSを ui/styles/base.css に抽出 ([03c3fe1](https://github.com/kt0319/any-console/commit/03c3fe1d48836d183da0f57db6c3ac51b10d1b4a))
* App.vue の認証ゲート・接続監視・タイトル同期を composable に分離 ([76da098](https://github.com/kt0319/any-console/commit/76da09880351a38efc677f336d590881a23f4866))
* branchNote補助関数をbuildActionSummaryにインライン化 ([e310371](https://github.com/kt0319/any-console/commit/e31037148109c76e08a59862b14480e079975cd4))
* dispatch/deep-linkの確認メッセージ組み立てを共通化 ([419b5bb](https://github.com/kt0319/any-console/commit/419b5bb62a7d753ea42554f12c0d0ede275cceed))
* dispatchのreuseパラメータを削除（常に既存セッションを再利用） ([8cf10ae](https://github.com/kt0319/any-console/commit/8cf10ae8604415df1dfb2113fbebd13258fb3752))
* FileBrowser のメニュー操作とパンくず処理を composable に分離 ([a84166b](https://github.com/kt0319/any-console/commit/a84166b95009b5ee208dca6198fb26570168c669))
* GitChangeBranch のブランチ取得とGit操作を composable に分離 ([12a19f0](https://github.com/kt0319/any-console/commit/12a19f0f4d4376d0bbf6dbbbc6b24d64a5af16bb))
* GitHistory のコミット操作とファイル操作を composable に分離 ([7bedb2d](https://github.com/kt0319/any-console/commit/7bedb2d1f2a5843acc77d6fdcc8ae28685afdd0b))
* KeyboardBar の状態管理とグローバルCSSを分離 ([cf3ea31](https://github.com/kt0319/any-console/commit/cf3ea31b23806a7e78c7e073fa5f0bdd2d43c76d))
* KeyboardQwertyKey のキー処理を composable と utils に分離 ([e29b654](https://github.com/kt0319/any-console/commit/e29b654189ad3bf0dc86301e3994a37b0a13b2fa))
* RSSルーターのエラーをHTTPException(detail形式)に統一し例外捕捉を具体化 ([7321cf4](https://github.com/kt0319/any-console/commit/7321cf4f47599bae90c1b68dc65b4569aaaabffc))
* strictNullChecksを有効化し型注釈で全エラーを解消する ([46b7bc7](https://github.com/kt0319/any-console/commit/46b7bc798506ddded1d833608bc287290688bdab))
* TerminalBase の分割ペイン管理とドロップゾーンを分離 ([a65ac68](https://github.com/kt0319/any-console/commit/a65ac68fba5edfa6ee458dd961f37552b7823e93))
* WorkspaceDetail の RSS タブ管理を composable に分離 ([78f8481](https://github.com/kt0319/any-console/commit/78f848142aa7b51ed2d05459368fae70d4102b96))
* WorkspaceOpen のドラッグ並べ替えとグループダイアログを分離 ([829726f](https://github.com/kt0319/any-console/commit/829726fe74b08082c4432ab58cdf6e2de109efc4))
* worktreeの作成先をリポジトリ内の.worktrees/配下に変更 ([f4f9443](https://github.com/kt0319/any-console/commit/f4f9443dbf2382fd74e1380256c1e5f8dc93a494))
* ターミナルをベースセッションへ直接アタッチして grouped session を廃止 ([1a05e98](https://github.com/kt0319/any-console/commit/1a05e983044fa52a0d34ccdfd50c0c62da815cb9))


### Documentation

* ターミナルのリサイズを ioctl 一本化した設計判断を DECISIONS に記録 ([5be0af0](https://github.com/kt0319/any-console/commit/5be0af00f66daaf66dc54dcd15a623c890831b41))


### Tests

* actionSummary用のテスト追加でフロントエンドbranch coverage修復 ([1c1e300](https://github.com/kt0319/any-console/commit/1c1e3003f66e1552077a1d6004f874c4a0331dae))
* AppToastのクリックテストをPointer Eventsベースに更新 ([806cf62](https://github.com/kt0319/any-console/commit/806cf622ac1902ec66085f1104778b7e775759bc))
* test_api.py をドメイン別の5ファイルに分割 ([d9e83d9](https://github.com/kt0319/any-console/commit/d9e83d9ffb94913b7c712e3ee3f504c8cb9ccc2b))
* test_api.py をドメイン別の5ファイルに分割 ([bb43233](https://github.com/kt0319/any-console/commit/bb432332dbbb50248fb139be38da3dfbbeb75b10))

## [0.3.0](https://github.com/kt0319/any-console/compare/v0.2.0...v0.3.0) (2026-06-03)


### Features

* AIエージェントをtmuxセッションにサーバ側起動するジョブを追加 ([0aa0f69](https://github.com/kt0319/any-console/commit/0aa0f691a7c44ec2a69e40bb9d5bb89d3f38bf15))
* AIエージェント起動をワークスペースジョブ一覧から実行できるUIを追加 ([e6735c4](https://github.com/kt0319/any-console/commit/e6735c44c6218972ccd8e121bc7c6935b87b2da9))
* Branchesタブの+WTボタンを削除しworktree作成はヘッダーに集約する ([479587d](https://github.com/kt0319/any-console/commit/479587d1e12ded9bafd484af3ef89cfb49478459))
* Branchesタブのツールバーとブランチ追加モーダルを刷新する ([3a39c87](https://github.com/kt0319/any-console/commit/3a39c87529307c0358b3d5a33f47a259c43ce7dd))
* Branchesタブのリモートブランチ一覧をワークスペースごとにキャッシュする ([2f802ce](https://github.com/kt0319/any-console/commit/2f802ce7a799e7fe1a490c85654d90a9e97f6f5e))
* config スキーマのバージョニングと自動マイグレーションを追加 ([57c13b8](https://github.com/kt0319/any-console/commit/57c13b8964ba433a9f0c4f812a7a31fbf619bbc4))
* git worktree サポートを追加する ([8b937c0](https://github.com/kt0319/any-console/commit/8b937c0e51c23e0ceb5b842981b853c5aaabeac8))
* git worktree の作成・切り替え機能を追加 ([491644a](https://github.com/kt0319/any-console/commit/491644ae7d41a442d214ae519c24890bd57c4d1b))
* URLクエリパラメータでワークスペースとペインに直リンクできるようにする ([5e35d5c](https://github.com/kt0319/any-console/commit/5e35d5c9699cf69922740549a671e4757f3b6bef))
* worktree を実行時検出して入れ子表示し一覧から削除できるようにする ([63123fb](https://github.com/kt0319/any-console/commit/63123fb74a1cbbf052a8fed450758e2ed23c829c))
* worktreeのワークスペースはベースのワークスペースとジョブを共有する ([0501990](https://github.com/kt0319/any-console/commit/050199027b8505ddb52f511ac4b58ec930c84a16))
* worktree作成時にブランチ一覧を更新しOpenボタンを削除する ([e2e4ea2](https://github.com/kt0319/any-console/commit/e2e4ea2e19c497b0cfcf204a36123dca7e98dbb2))
* worktree子行クリックで詳細モーダルを開き削除ボタンを赤くする ([e5c5821](https://github.com/kt0319/any-console/commit/e5c5821e60ed3e8ad1db14400a87f4a939cef502))
* アプリ全体のエラー境界を追加し致命的エラー時にフォールバックUIを表示 ([1590c99](https://github.com/kt0319/any-console/commit/1590c9931f50ba5f4df48f3a3c85a873aabec7ba))
* ターミナル・Git操作・ジョブ実行の操作ログ記録機能を追加 ([cdbf834](https://github.com/kt0319/any-console/commit/cdbf834c37d6589c0b276786bf137c614fdbe597))
* ターミナルジョブのコマンドに{{name}}プレースホルダーを追加し起動時に入力できるようにする ([9e5cc39](https://github.com/kt0319/any-console/commit/9e5cc39609251f1bbdd44c7ef34380f0ae041416))
* ターミナルジョブのコマンドをサーバ側send-keysで実行し未接続でも走るようにする ([aa8fda9](https://github.com/kt0319/any-console/commit/aa8fda9f3403dfa919b0afa7de8887f74cef39db))
* ターミナル機能改善（プレースホルダー・コメント行・クリップボード同期） ([#41](https://github.com/kt0319/any-console/issues/41)) ([3cfb3dd](https://github.com/kt0319/any-console/commit/3cfb3dd29212746c517c6a3f43e5ae77fba2e1b5))
* ブランチ一覧にpullボタンを追加（非カレントは非活性でブランチ切り替えを促す） ([4097c9e](https://github.com/kt0319/any-console/commit/4097c9e55513a7fc3cc0c3591bef9bc5814929a5))
* ブランチ切り替え中にリストとツールバーを無効化する ([bdf3c5e](https://github.com/kt0319/any-console/commit/bdf3c5e96b06c447427bc08cd1aca284a7dc5b20))
* ブランチ削除後にfetchを自動実行しREMOTE fetch中の操作を無効化する ([02c0d1a](https://github.com/kt0319/any-console/commit/02c0d1a625c8caf2dcf1d4c4633eae4723fdf086))
* ワークスペースグループのドラッグ並び替えを追加 ([a088307](https://github.com/kt0319/any-console/commit/a0883074ebed57982d52465df44ca180597a42c1))
* ワークスペースのグループ機能追加（フォルダ→グループ名称変更・ドラッグ並び替え） ([d189b26](https://github.com/kt0319/any-console/commit/d189b26807ea9292a8fe5df74ada67dd58fffadf))
* ワークスペースをドラッグでグループなしエリアに移動できるよう対応 ([b04b768](https://github.com/kt0319/any-console/commit/b04b768dde1a66c6ae7b3227e0c2531fd0152913))
* ワークスペース一覧で worktree をベースの下に入れ子表示し名前を [] 表記にする ([86aaa9c](https://github.com/kt0319/any-console/commit/86aaa9cf0d2dd3c53fb701019b8d99914b87d2e9))
* ワークスペース一覧のタップで詳細モーダルを開き一覧ではjobsを取得しない ([48d0a0c](https://github.com/kt0319/any-console/commit/48d0a0ce42739397066e669dce709549f8cde4f7))
* ワークスペース一覧のドラッグ並び替えとchangesタブ直接遷移を追加 ([9e1a788](https://github.com/kt0319/any-console/commit/9e1a788ce80397be25eba75ca1d239b792abbbde))
* ワークスペース一覧の行をホバー時にハイライトする（PCのみ） ([ecd5ea6](https://github.com/kt0319/any-console/commit/ecd5ea61b84c980e9a12cc3ba9022220dd343eaa))
* ワークツリーをconfigに登録せず動的検出に統一する ([f8b71bd](https://github.com/kt0319/any-console/commit/f8b71bd997ea1affd7cb1b9d0321f0fb84c2d165))


### Bug Fixes

* ×ボタン押下時にミニモードからフルキーボードが開いてしまう問題を修正 ([8075fce](https://github.com/kt0319/any-console/commit/8075fceebf945c396cf22f4fc0523c636573ee62))
* api/main.py の import ソートを修正（ruff I001） ([a4e4894](https://github.com/kt0319/any-console/commit/a4e48946ba0a7fb90e9d8bfa4fee50752c354ae5))
* git-log無限スクロールの暴走ループを修正しtoo many requestsを防ぐ ([4795fff](https://github.com/kt0319/any-console/commit/4795fffdc7bd2243639ff863d17aa63250ca3248))
* git-refバッジが長いブランチ名で省略されない問題を修正する ([0b1847f](https://github.com/kt0319/any-console/commit/0b1847fbb109a5fb4a58bb27de26d78e23516a9e))
* jobs_common.py の未使用importを削除する ([baed65f](https://github.com/kt0319/any-console/commit/baed65f6e71b4436c20d399f28be8623ad9a8916))
* pullボタンを黄色に統一しBranchesタブのpullにローディングスピナーを追加 ([ce6acd0](https://github.com/kt0319/any-console/commit/ce6acd0b1c735af33aa2a5f7676082b460196e7d))
* RSSフィード追加ボタンの角丸を円形から通常の角丸に修正する ([7d16882](https://github.com/kt0319/any-console/commit/7d16882b785e8ee432c49b39d69996646cce8aec))
* ruff lint エラーを修正する（import順の整理・関数複雑度の低減） ([bcad88a](https://github.com/kt0319/any-console/commit/bcad88a093321836d436f002156fefd71b5e5556))
* worktree のモーダルタイトルを「ベース名 [ブランチ]」表記にする ([64ccfe4](https://github.com/kt0319/any-console/commit/64ccfe4fff99623ad0a9a5834a67d2dd11e9dfc8))
* アクセシビリティ自動検査の対象を拡張し検出した違反を修正 ([f284209](https://github.com/kt0319/any-console/commit/f28420947cbf575039369adb9d3856dc027f483b))
* スニペット一覧のスタイルを他のリストページと統一（区切り線スタイルに変更） ([9a5f1de](https://github.com/kt0319/any-console/commit/9a5f1de05c4506360c1b7212cb228f84e583a15e))
* ターミナルフォントを Hack Nerd Font + monospace に変更 ([3e05648](https://github.com/kt0319/any-console/commit/3e056482147a028a55f669daf2ecdc23d66f6d36))
* タブのワークツリーアイコンをワークスペースアイコンの右・jobアイコンの左に移動する ([485c159](https://github.com/kt0319/any-console/commit/485c159b8426cc785d3be0ba49e25a168cba96c7))
* ベースが未登録の孤立worktreeはworktree扱いせず誤アイコンを防ぐ ([e9411fb](https://github.com/kt0319/any-console/commit/e9411fba04f32617b3bf264dbe97dd5b26484718))
* モバイルでブランチ名を最大50%幅・中央省略で表示 ([401e85b](https://github.com/kt0319/any-console/commit/401e85b66236247878fa69c5211d0a431fda78cc))
* リモートブランチキャッシュをモジュールスコープに移動し再マウント後も保持する ([f696b8c](https://github.com/kt0319/any-console/commit/f696b8c69d81e76727296485f8a8cfae2f2dcfeb))
* ワークスペースグループ展開時の縦線とインデントを除去 ([0fb81e1](https://github.com/kt0319/any-console/commit/0fb81e19a5989e179029ea81ac71443ad79b0390))
* ワークスペースピッカーを開いた時に一覧を再取得しworktreeを表示する ([a1856ef](https://github.com/kt0319/any-console/commit/a1856ef4b730827dc3a8416cb15346c49de974b7))
* 一覧ジョブAPIでworktreeにベースのジョブを表示し作成時の自動ターミナルを止める ([05b8e73](https://github.com/kt0319/any-console/commit/05b8e73e5b85835c0a0c009a7f92595a0b8ff6a1))


### Performance Improvements

* 詳細モーダルのHistory/Filesを遅延ロードしgit-logの無駄な取得を減らす ([f280535](https://github.com/kt0319/any-console/commit/f28053509cc26f93748b1d7d17ce1f040ac32bc5))


### Refactor

* Service Worker のキャッシュ判定を静的アセットの allowlist 方式に変更 ([93dd3e4](https://github.com/kt0319/any-console/commit/93dd3e496a0650cc33bff3f8dddd462790165486))
* worktree 管理を Branches タブに統合し可視性を追加 ([65c6ad8](https://github.com/kt0319/any-console/commit/65c6ad8158507888ffbad6f8da71ccb84d91dc36))
* worktree周りのパス解決と表示名生成を共通ヘルパーに集約する ([dae0d9b](https://github.com/kt0319/any-console/commit/dae0d9b74f6360bf4313dcea0c5c1d9e679676ee))
* イベントバスのイベント名をカタログ化し未登録名を検知する ([6955055](https://github.com/kt0319/any-console/commit/695505589d7e21afeeb577e91f70d21a980b8c61))
* カテゴリヘッダーのデザインをグループヘッダー基準に統一（uppercase廃止・スタイル共通化） ([2967609](https://github.com/kt0319/any-console/commit/2967609c8d43aeb1389bf8ea9440171e2a48f15a))
* グループ関連ロジックをworkspace-groups.jsに切り出し ([1237b3c](https://github.com/kt0319/any-console/commit/1237b3c48f88475fbba2dfa586f92dc0ff5ecb1a))
* ドラッグ並び替えをuseListDragSortに統一しハンドルCSSを共通化 ([2876858](https://github.com/kt0319/any-console/commit/287685806493610bdd5f0da6a8a0f5e672b0cfa8))
* ワークスペースのフォルダ機能をグループに名称変更 ([fc277c5](https://github.com/kt0319/any-console/commit/fc277c518b138ed5b6d4ba714bfb70ef05b0d106))
* ワークスペース一覧の旧ジョブ展開UIの未使用CSSを削除 ([e87c95e](https://github.com/kt0319/any-console/commit/e87c95ebfa7cea30281376105fa6f1e74bb1a15c))


### Documentation

* ADR [#11](https://github.com/kt0319/any-console/issues/11) を動的検出方式の現行実装に合わせて更新 ([a86fc59](https://github.com/kt0319/any-console/commit/a86fc596a0be9906b10d3e51c099d2805c57c062))
* useListDragSort と drag-utils.css の共通ドラッグ処理を ARCHITECTURE.md に記載 ([c91e380](https://github.com/kt0319/any-console/commit/c91e3801bdc6d9daa15ee02586157817ea5cc73c))
* ジョブ設定のコマンド欄に{{name}}プレースホルダーのヒントを追加 ([528762d](https://github.com/kt0319/any-console/commit/528762da8120cee8f2e851843b32275a1cf29466))
* 設定例とProject Stanceから個人環境前提を薄める ([5bc4784](https://github.com/kt0319/any-console/commit/5bc47842e325bd3498c0d4ed4ca860134193b696))


### Tests

* axe-coreでアクセシビリティを自動検査しCIで担保する ([0076dff](https://github.com/kt0319/any-console/commit/0076dff4dbe1df3d31a3011277cc280e462ba5e1))
* グループ CRUD エンドポイントのテストを追加（カバレッジ改善） ([42d0a23](https://github.com/kt0319/any-console/commit/42d0a2305858d48fbd64478b6198c13363acd8ec))
* コンポーネントテストとグループロジックのユニットテストを追加 ([5716290](https://github.com/kt0319/any-console/commit/57162906e0b63ffc246fbba075760ced344d11da))

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
