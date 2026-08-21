# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0](https://github.com/kt0319/any-console/compare/v0.14.0...v0.15.0) (2026-08-21)


### Features

* branchピルはPush/Pull件数がある時だけBranch一覧を展開して開く ([7aa1232](https://github.com/kt0319/any-console/commit/7aa1232f0625dce3fb2b675b2ebfc818c1af0766))
* dispatchの受付時刻・決定時刻を記録しDispatch Queue一覧に表示する ([e179462](https://github.com/kt0319/any-console/commit/e17946271a86dc7af0e0410bce4c159237227518))
* エージェント状態の判定元（hook/manifest/screen）をタブのツールチップにデバッグ表示する ([639099b](https://github.com/kt0319/any-console/commit/639099b30a511d64f38ac28adec175f9ecd61850))
* ベアターミナルのタブ名をカレントディレクトリ名に追従させる ([63f41a3](https://github.com/kt0319/any-console/commit/63f41a32c77806b15f6543ab8ab9903b9b802dde))


### Bug Fixes

* any-consoleの未知のコマンドをexit 1にしhelpエイリアスを追加 ([41dacf1](https://github.com/kt0319/any-console/commit/41dacf1055a827cbefad93f8005d30f94e5ef8c3))
* Create branchからChange branchへ戻した際に新規ブランチ名の残留値をクリアする ([08d13e6](https://github.com/kt0319/any-console/commit/08d13e64215900888e08944471eed2bbdc396440))
* Dispatch Rerunでmatch判定をexisting_session_idではなく元のmatch値で行う ([e1e8ceb](https://github.com/kt0319/any-console/commit/e1e8cebc13cdc1beac5a5edaf51dfc40a978f9d7))
* dispatchのCreate branchで入力した新規ブランチ名がChange branchへの切替後も消えないようにする ([36befdd](https://github.com/kt0319/any-console/commit/36befdd657c9418f698ecbd79fe9cdb680470f85))
* GitHub連携一覧のタップでGitHubアプリとブラウザが同時に開く不具合を修正 ([1e29a07](https://github.com/kt0319/any-console/commit/1e29a0783ddcfe71182ba93b72606ad8862d1175))
* historyピル廃止に伴いinfo_pillsのフィールド数を9から8へ修正 ([6b0a134](https://github.com/kt0319/any-console/commit/6b0a134a767e76deb83258308e7a678e7047833d))
* hooks登録のスクリプトパスを空白等を含む場合に引用符で括る ([59126f0](https://github.com/kt0319/any-console/commit/59126f0b8df95f533fa4814088d49f9f12bfe02f))
* hooks登録時に旧版の引用なしコマンドを引用済みコマンドへ置き換える ([47496ec](https://github.com/kt0319/any-console/commit/47496ec01f9894f5275a1d707e6c966974184add))
* pendingワークスペースのDispatch実行後にWorkspaceDetailモーダルが閉じない不具合を修正 ([5df50c6](https://github.com/kt0319/any-console/commit/5df50c65f03f3e2955e8bf5702cdf294a358caf0))
* setup完了時の案内URLが接続できないhttps URLになる問題を修正 ([de343db](https://github.com/kt0319/any-console/commit/de343db7f3c0770d1cc943c9f12dfcc031110d4d))
* workspaces discoverテストがHOME未隔離のため実ホームディレクトリを走査してハングする問題を修正 ([f3d61e9](https://github.com/kt0319/any-console/commit/f3d61e9004e818d72e8ded3e6b55b1ab9c4bcf76))
* アクティブなタブで通知が届いた場合も操作時にベルバッジを解除する ([8a7bef6](https://github.com/kt0319/any-console/commit/8a7bef69362203b100b568f4ce2aea0d22b6fa80))
* キーボードバー経由の操作でもベル通知バッジを解除する ([79383f6](https://github.com/kt0319/any-console/commit/79383f6cb023136a103aeb9ef9746a3b76f5c04c))
* サイドバーのpendingワークスペース一覧で罫線が二重に見える不具合を修正 ([6488a5d](https://github.com/kt0319/any-console/commit/6488a5d8465594ba0eed172875b81dda2b49e44e))
* 同一ブランチに複数workflowのrunがある場合、実行中/失敗のrunを優先してActionsピルに反映する ([8fe9b56](https://github.com/kt0319/any-console/commit/8fe9b56706ecdda5ec682973dfd49e6da7a083d3))
* 手動でのワークスペース紐付けが他クライアントへリアルタイム同期されない不具合を修正 ([459247f](https://github.com/kt0319/any-console/commit/459247f0552916f81176f275014581527cc9fcbb))


### Refactor

* historyピルをbranchピルへ統合し、Historyタブのアイコンをbranchピルと同色に揃える ([c959cb2](https://github.com/kt0319/any-console/commit/c959cb251df26e328eb26cf63446d6d7fcfeb7a6))


### Documentation

* CLAUDE.mdのフロントエンドビルド成果物パスをui/distからdist/へ修正 ([9bf7995](https://github.com/kt0319/any-console/commit/9bf7995b3bc7599955ac31b57d25daf047921998))
* CLAUDE.mdを最新のリポジトリ状態に合わせて更新 ([186e73c](https://github.com/kt0319/any-console/commit/186e73c29bd7aa4715065f17e53d46d447f0d46c))
* macOSのシステムスリープ無効化（pmset）の推奨ブロックを削除 ([468a4e8](https://github.com/kt0319/any-console/commit/468a4e8dd11b816c38ed9f1da26f7b9625319bc8))
* スリープ中のMacにTailscale経由で到達できないという誤った記述を削除 ([206ab0b](https://github.com/kt0319/any-console/commit/206ab0b48ac57c17ba68f04c1cee6ac8871b2e73))
* スリープ復帰直後のタイムアウトでセッションが不安定になるという記述を削除 ([6eccbe1](https://github.com/kt0319/any-console/commit/6eccbe153e6215dcce47811947d29cdf048f3e84))
* 実装とずれたドキュメント記述を修正し重複説明を整理 ([57ed13d](https://github.com/kt0319/any-console/commit/57ed13de7984abca1965bcee5520ee4323b03402))
* 平文HTTP待受・0.0.0.0既定バインドの注意とdispatch decision統合のADR追記を反映 ([64aab6f](https://github.com/kt0319/any-console/commit/64aab6febae02cf85ab26a7661e9f7341c9a832c))


### Tests

* config.json.exampleのスキーマ乖離とリリースtarballの同梱漏れを検知するガードを追加 ([3237bc8](https://github.com/kt0319/any-console/commit/3237bc84de498c46aef6598aa8c0a0214215f205))
* release hookのクオート処理・scripts同梱を実スクリプト実行で回帰検知する統合テストを追加 ([4af7e7b](https://github.com/kt0319/any-console/commit/4af7e7b844d601d24d06a3b46f50fa15b82daa21))


### Build

* Cargo.lockのバージョンをリリースバージョンに追従 ([b8bd4c4](https://github.com/kt0319/any-console/commit/b8bd4c4f0d90e4266130c55ec051acd3b47b2789))
* リリースtarballにscripts/を同梱しhooks-setupをバイナリ配布でも動くようにする ([2de264b](https://github.com/kt0319/any-console/commit/2de264b25a940522c056486acb985102af716cf3))


### CI

* release-pleaseのPR作成にPATを使い後続ワークフローを自動発火させる ([badf0ad](https://github.com/kt0319/any-console/commit/badf0ad406dccb3618e738fac21946c1c69ab28d))
* 各jobにtimeout-minutesを設定してハング時の早期打ち切りを可能にする ([8e185d4](https://github.com/kt0319/any-console/commit/8e185d4efd93131ba9648543a8674f81e67ca618))

## [0.14.0](https://github.com/kt0319/any-console/compare/v0.13.0...v0.14.0) (2026-08-18)


### Features

* Circle Keypadにスクロール操作を追加 ([ed157b1](https://github.com/kt0319/any-console/commit/ed157b1b9fa9805ed92722612e01b6e982638df1))
* gh CLIのログイン状態をSetupチェックリストとSystem Infoに表示 ([ceb0fb9](https://github.com/kt0319/any-console/commit/ceb0fb95c90498b696507dda45e4066535cd6cea))
* Recent Jobsのピン留め時にピン留めグループの先頭へ配置する ([d280ba1](https://github.com/kt0319/any-console/commit/d280ba1074e29c87027abc986a647726dc3e2a50))
* Server ProcessesでジョブのpidをOSプロセスと突き合わせて表示する ([2f12821](https://github.com/kt0319/any-console/commit/2f1282132adae4cb4ce6ac182822a34f8f078e26))
* Setup項目に未対応があればカテゴリ見出しに警告アイコンを表示 ([96a58ef](https://github.com/kt0319/any-console/commit/96a58efaa3dd7b4f1f7102047d3a644cf52e833b))
* System Infoの一番下にCopyボタンを追加する ([1579b66](https://github.com/kt0319/any-console/commit/1579b6668c2991c98eb86f13ee21170dc75aa6f4))
* コミット詳細ヘッダーにCopy hash追加とフルメッセージ展開機能を追加 ([4942eb4](https://github.com/kt0319/any-console/commit/4942eb41768bdb8962cfe269c18446b9693cfdae))


### Bug Fixes

* dispatchの即時実行を廃止する ([ec85335](https://github.com/kt0319/any-console/commit/ec8533573312819982d5779f9e05c14286d253fa))
* git status取得失敗時にChangesピルが古いdirty表示のまま残る不具合を修正 ([5b5ac6f](https://github.com/kt0319/any-console/commit/5b5ac6f9ed7b1ed78a1913d94b761192bf53ac7f))
* hook URLのスキームを実際のTLS listen状態に合わせて決定する ([2147581](https://github.com/kt0319/any-console/commit/214758158b437dbf55bbed6af09ae3f33713d0f7))
* hookスクリプトがhttps環境で毎回無駄な初回curlを撃つのを解消 ([0a55322](https://github.com/kt0319/any-console/commit/0a55322eaf560e673127f973ce8a06389a9ab0b9))
* macOSのサービス稼働判定をlaunchctlベースに変更する ([fe414e7](https://github.com/kt0319/any-console/commit/fe414e7a871ab97ade265feef56590d646503749))
* revoke済みデバイスのWebSocket接続をping時に切断する ([e2dfceb](https://github.com/kt0319/any-console/commit/e2dfceb11d03b72c0bf8f940c77ee9f1bc8ec6c9))
* Setupチェックリストの展開・警告アイコンが起動直後にちらつく問題を修正 ([f39b094](https://github.com/kt0319/any-console/commit/f39b094bbd05178f31f5d6fb228d6bfa3cd6ed9d))
* Tailscaleヘッダ自動認証の信頼範囲をloopback発のみに限定する ([e2b29c3](https://github.com/kt0319/any-console/commit/e2b29c328232058fa054cc0db477f16374a72b2a))
* TLS bindでホスト名指定時に起動できない非対称を解消する ([e27a764](https://github.com/kt0319/any-console/commit/e27a76456d22cb955e6fded9f1f10c2030745ff7))
* エラートーストを省略せず折り返し表示し、dispatch破棄時にトーストを出す ([7f3250f](https://github.com/kt0319/any-console/commit/7f3250f29f198fb00e004ad8ce18ce00cdd550c2))
* サイドバーのピル行にカーソルをpointerで表示する ([893f4f7](https://github.com/kt0319/any-console/commit/893f4f7e60d0ed3be499c4d45183d0024841378f))
* セッションサイドバーのアクティブ行背景を幅いっぱいに表示する ([e6820a2](https://github.com/kt0319/any-console/commit/e6820a2f5e5fb09146c248afbed49488f10574db))
* セッションサイドバー最後の項目にも罫線を表示する ([f2e38b6](https://github.com/kt0319/any-console/commit/f2e38b6979820f9673d5dc9a769502fb875c257e))
* ターミナルURLダイアログでURLを省略せず折り返し表示する ([6a50175](https://github.com/kt0319/any-console/commit/6a501753d68dd53fbb31c0e87bb64808e2a652d4))
* タブの右クリックでブラウザのコンテキストメニューを出さないようにする ([d08a964](https://github.com/kt0319/any-console/commit/d08a9646d3fc084e535d4283740ebf723c155bd6))
* メイントークンがdispatch rerunのactivityログへ平文で記録される問題を修正 ([d72b5c6](https://github.com/kt0319/any-console/commit/d72b5c65257847b821b1fc82a4d34936d071f6a1))
* ワークスペースモーダルのタブアイコンをピル・ブランチ対応時のみ着色する ([0b18ef7](https://github.com/kt0319/any-console/commit/0b18ef74bddd0447cdc2111c2af6d04fc368d985))
* ワークスペースルートでもFile BrowserのDownloadボタンを表示する ([1723461](https://github.com/kt0319/any-console/commit/1723461ff1e6d9a19b288bdc255aa0382710e879))
* 直接TLS終端時にデバイスcookieへSecure属性を付与する ([5f57dce](https://github.com/kt0319/any-console/commit/5f57dce8996e564024cc7852aeb20d6b2a75c6b5))


### Refactor

* Config FileのDownload/Uploadボタンを一番下に移動する ([edbcf71](https://github.com/kt0319/any-console/commit/edbcf7134c2236fec0ff916e3a917c815d1e4dbf))
* dispatchキューの永続化先をdata/へ統一する ([77e2d93](https://github.com/kt0319/any-console/commit/77e2d93e496c602dd5e1cab309ac14b616af9d79))
* dispatchを「実行するか破棄するか」だけのモデルに単純化する ([d85b47d](https://github.com/kt0319/any-console/commit/d85b47db02b5c460ec20dccfee92a2cfe6605bbe))
* hookスクリプトのhttpsフォールバックを削除する ([513c5d3](https://github.com/kt0319/any-console/commit/513c5d35b0d367c0b13a54f36bb253d41094ee36))
* noImplicitAnyを有効化し暗黙anyに型注釈を追加する ([1205f1d](https://github.com/kt0319/any-console/commit/1205f1d0f29428e703c71174e6192cd1e57c20a4))
* preview proxy用証明書ディレクトリをdata/certsへ移動 ([b042c66](https://github.com/kt0319/any-console/commit/b042c66125152372ca11cc0d23fc4f33c822e775))
* System InfoのProcessesとDev Server画面を統合しServer Processesページにする ([744ead2](https://github.com/kt0319/any-console/commit/744ead29987221bf6efd893b67ee6524136443ff))
* vitestのlocalStorageバッキングファイルをnode_modules配下に移す ([785ca5a](https://github.com/kt0319/any-console/commit/785ca5a085689b1114dd41eff49a53dd76087fd4))
* タブの長押しクローズを削除しシンプルにする ([e901554](https://github.com/kt0319/any-console/commit/e9015546526226143bd9d128de86084c48e2e385))
* 本体のTLS終端を削除する ([85cc500](https://github.com/kt0319/any-console/commit/85cc500d8a0515e9059164bcfe951284d949fa43))
* 認証設定を簡素化する ([5b84408](https://github.com/kt0319/any-console/commit/5b8440865ef330d58a9bb309ec9032dabfcb8270))


### Documentation

* iPhoneから始めるガイドを新規作成する ([04fca87](https://github.com/kt0319/any-console/commit/04fca87cae1692b0d855eb3ee94b8fa7d83e27e6))
* tailscale serveコマンド例をCLI新構文に修正 ([265a3ea](https://github.com/kt0319/any-console/commit/265a3ea058bdc2e23f8249d35f8ae2e0bf42f1a3))
* 簡素化後の運用手順を更新する ([fc966d6](https://github.com/kt0319/any-console/commit/fc966d6500e8ba984789e94975c7af241bfc7f10))


### Tests

* job_auto_tag_via_foreground_argvのポーリング上限を15秒に延長 ([34c2205](https://github.com/kt0319/any-console/commit/34c2205f6ba021c936989284ff401c2188a7e2a0))

## [0.13.0](https://github.com/kt0319/any-console/compare/v0.12.1...v0.13.0) (2026-08-15)


### Features

* Add Workspaceページでアイコンを登録時に設定できるようにする ([26d06f7](https://github.com/kt0319/any-console/commit/26d06f729c25bca5e79d6e38b85b9f27e3d2df70))
* Dev Server一覧のOpen/Killをpillと同じ確認フロー・共通killボタンにする ([1a69f8a](https://github.com/kt0319/any-console/commit/1a69f8a1877316aa53a1c2aac7c8a3f83970e6b3))
* OpenモーダルでRecent Jobsを編集モードから削除できるようにする ([30c2812](https://github.com/kt0319/any-console/commit/30c28123c57004b47b9fec294d2652fdb5c519ab))
* worktreeのdispatch履歴を元のディレクトリと共有表示する ([cd72852](https://github.com/kt0319/any-console/commit/cd728528288a4267810c4c50ac968da1bdac2547))
* worktree削除時にdetachedセッション・dev serverプロセスの残骸も掃除する ([dfec0c7](https://github.com/kt0319/any-console/commit/dfec0c7fe63c8159c579ea12fb4c3ff75570dbe9))
* worktree削除時にそのworktreeを開いているセッションがあれば確認の上で閉じる ([2cde41b](https://github.com/kt0319/any-console/commit/2cde41bb8940886a80c358e976c3ed49bacdf791))
* セッションサイドバーのワークスペースアイコンにもダーティマークを付ける ([0cd650d](https://github.com/kt0319/any-console/commit/0cd650d054fc43b98b9d4be0d2840a8406e558c6))
* セッションタブ間・タブと+ボタンの間にChrome風の区切り線を追加 ([1643bd6](https://github.com/kt0319/any-console/commit/1643bd6dc7cc946be7c0aa1a3ac6224cb0ac30b4))
* ブランチpillをworktreeの時はworktreeアイコン(青)に変更 ([df28136](https://github.com/kt0319/any-console/commit/df2813619dcecb0bdb066cb5a6564d124050a0c1))


### Bug Fixes

* config 読み込みをマイグレーション→正規化の順に変更 ([b3e6fb5](https://github.com/kt0319/any-console/commit/b3e6fb501336da07b1b10ffa97aee6c5eeabd994))
* detached リネームの過渡期互換(旧SPAバンドル・旧キャッシュ)を追加 ([049ee73](https://github.com/kt0319/any-console/commit/049ee73fffa85fbebe05979b3301847b903bca10))
* Dispatch実行フォームのSession/Workspace欄とworktree作成時の不具合を修正 ([3b8242a](https://github.com/kt0319/any-console/commit/3b8242a71efc3f31e3089cecc82ec5a9e75949e2))
* Files pill/workspace peekでワークスペースアイコン未設定時にjobアイコンへフォールバックする不具合を修正 ([a28a9fa](https://github.com/kt0319/any-console/commit/a28a9fa60a27cb96bc920f4319b4dde78e704ff2))
* Files pillの説明文から削除済みのdirtyドット記述を除去 ([7580108](https://github.com/kt0319/any-console/commit/7580108dc3c5f1aff9ca1e8fd5a5c19cb799aa10))
* preview::testsのSSL_CERTFILE/SSL_KEYFILE環境変数レースによるCI落ちを修正 ([5b77bff](https://github.com/kt0319/any-console/commit/5b77bff1bbe91595d67be01240b163693b24c6da))
* Recent Jobs編集モード中は行クリックでジョブを起動しないようにする ([f937159](https://github.com/kt0319/any-console/commit/f937159ffbf48bb8d7866ad16558248d8c1f2b6f))
* recent-jobs の detached 過渡期互換を GET 応答まで拡張 ([8b2238f](https://github.com/kt0319/any-console/commit/8b2238fb7b9c1ec09f5529b878791cfe86133398))
* worktree削除でセッションタブが閉じないバグを修正しE2Eを追加 ([3791c4c](https://github.com/kt0319/any-console/commit/3791c4c2902874876a5923a57046e2a30522b044))
* worktree配下のcwdをbase名でなくbracket形式で解決するよう修正 ([6a130dd](https://github.com/kt0319/any-console/commit/6a130ddc7602075d66bac6e2bc068824778ebdc1))
* サイドバーのworktree行タイトルをベース名のみにし下段のブランチ表示との重複を解消 ([3c6a98a](https://github.com/kt0319/any-console/commit/3c6a98a1e865328f379adc8ee3a1cfa34a3989d1))
* サイドバーの通知ベルマークの色をアクセントカラーから警告色に変更 ([36890d6](https://github.com/kt0319/any-console/commit/36890d6aecbd358a5b4a697421d312dd3b0d70e5))
* セッションサイドバーの背景色をKeyboardBarと同じ色に揃える ([522d838](https://github.com/kt0319/any-console/commit/522d8387182870905be984fd2aefffe5ffd177f9))
* セッション一覧パネルのヘッダーからタイトルを消し閉じるボタンをタブバーと同じ高さで左端に配置 ([abed46c](https://github.com/kt0319/any-console/commit/abed46c2d97323e0498d9ec38684cf9b150b24b8))
* タブのworktreeアイコンをwsIcon/jobIconより後ろにして常に一番右に表示する ([fb7c19f](https://github.com/kt0319/any-console/commit/fb7c19fbbc6b9bae56b7915adc32e55fd6fede66))
* タブ名からworktreeのブランチ名を消しベース名のみにする ([42fe4ba](https://github.com/kt0319/any-console/commit/42fe4baab4b487de56341a69181a983c957f5462))
* ブランチ一覧のworktree削除ボタンを「Remove WT」テキストから他行と同じゴミ箱アイコンに統一 ([0d863ce](https://github.com/kt0319/any-console/commit/0d863cec8fc5b942e0fdbaf1b27424e4de7277d1))
* モーダルをEscapeで閉じた際にターミナルへESCバイトが漏れる不具合を修正 ([17d1c47](https://github.com/kt0319/any-console/commit/17d1c472d8986c3bf940cc9a2604179c56a3c507))
* モバイルでもタブ区切り線を表示し非アクティブタブの減光を廃止 ([7a2feff](https://github.com/kt0319/any-console/commit/7a2feff47e0b685fa5176803123ab39dac0098b6))
* ワークスペースアイコン未設定時はデフォルトアイコンで埋めるようにする ([5ec37c0](https://github.com/kt0319/any-console/commit/5ec37c023c94d68fa61e7debc0dc08a11c8fc48d))
* 素のターミナルでジョブが動的検出された時にアイコンが即時反映されない不具合を修正 ([e1a0dee](https://github.com/kt0319/any-console/commit/e1a0dee58b146e3c8abfb9708c0b2e5f56fd554f))
* 通知設定のPhrase notify delayをPhrase detectedの直下に配置し無効時はdisabled表示にする ([e9aa85c](https://github.com/kt0319/any-console/commit/e9aa85cdd8538d1c721e3c16586d9113c6660ef7))
* 長文ペースト時にPTYへの書き込みが途中で欠落する不具合を修正 ([8a7a38f](https://github.com/kt0319/any-console/commit/8a7a38f396f35337a36f5dbda693affd0618da65))
* 開いているタブが1つだけの時に通知ベルマークが消えない不具合を修正 ([feaf6a3](https://github.com/kt0319/any-console/commit/feaf6a3bfce4ceb056cebdda49ba7e15bf407967))


### Refactor

* Files pillのアイコンをワークスペースアイコンから汎用のfilesアイコンに変更 ([935bfd3](https://github.com/kt0319/any-console/commit/935bfd3c77b035bb8da403115985b0bcac67fb87))
* GitHub表記の統一とビュースタック実装の共通化 ([0f5168d](https://github.com/kt0319/any-console/commit/0f5168deb028eb32ea2e500c35ac80014bc5380e))
* Icon Pickerの分かりづらさを解消しグリッドアイコンを見やすくする ([05ebaa8](https://github.com/kt0319/any-console/commit/05ebaa8832bbb7e68abee72fe8acfb89385bea91))
* ui/composables を TypeScript 化 ([dafdea1](https://github.com/kt0319/any-console/commit/dafdea117d4f8980fc3f83e0dbeb77aed3ee0649))
* Vue コンポーネントの script を TypeScript 化 ([f5437df](https://github.com/kt0319/any-console/commit/f5437df5699ebfe82db85932ad62d981cd2ef7f2))
* worktreeワークスペース名の区切り文字を角カッコからコロンに変更 ([15e6fcc](https://github.com/kt0319/any-console/commit/15e6fcc4ac6afba057c61b6d60fe0bc855bf8386))
* worktree残骸検出のマッチング条件を共通化する ([d86722c](https://github.com/kt0319/any-console/commit/d86722c6b82740d7357a418564308d5c536cc49b))
* エントリポイントを TypeScript 化（vue-main / app-bridge） ([b5e9ca2](https://github.com/kt0319/any-console/commit/b5e9ca2bfbac03e2c7d19c99736630c72d6c614c))
* バックエンドの重複コードを共通ヘルパーへ集約 ([53bb7d1](https://github.com/kt0319/any-console/commit/53bb7d13d76f503f2f136d96992228869258e039))
* フロントエンドの命名修正とDRY化(第1弾) ([4180ad5](https://github.com/kt0319/any-console/commit/4180ad587c5259954d8aa6d1842397fc98b0c685))
* 仕様統一3件(モバイル境界 / GitHub整形 / モーダルシェル共通化) ([55a4406](https://github.com/kt0319/any-console/commit/55a44067cabbfa64abc1501e88f4d21fcb95d8d4))
* 仕様統一4件(detached / preview / gitエラー文言 / ファイル閲覧) ([668acdd](https://github.com/kt0319/any-console/commit/668acddcf658855fb15d0660164c262d26b02bf5))
* 実装と乖離したバックエンドの命名を実態に合わせて修正 ([b9656a9](https://github.com/kt0319/any-console/commit/b9656a959493679474422fcaf836b9f6dd82e3b2))
* 通知バッジクリア処理をterminal.tsのclearSessionNotifyBadgesに集約 ([b048b87](https://github.com/kt0319/any-console/commit/b048b871ae517584567dbf85300611e25e537a9c))


### Documentation

* session_job_boundのiconコメントを実際のクライアント挙動に合わせる ([27ceace](https://github.com/kt0319/any-console/commit/27ceace8b1d4cf91d5be602a68affe9e3d1bb0ad))
* TypeScript 移行完了に伴いドキュメントのファイル参照を更新 ([f2b8b76](https://github.com/kt0319/any-console/commit/f2b8b769d973e0c38f66d22eeb8b89471f1af4ac))


### Build

* Cargo.lock のバージョンを 0.12.1 に同期 ([4bf9668](https://github.com/kt0319/any-console/commit/4bf966898783d9ddc67a9445052bce08226c559f))


### CI

* リリースPRのCargo.lockをバージョン変更に自動追従させる ([70fbf2e](https://github.com/kt0319/any-console/commit/70fbf2ed032281a166e39f47459a2db30d9c7b80))


### Dependencies

* npm audit fixでhigh severityの脆弱性6件を解消 ([6ddd49e](https://github.com/kt0319/any-console/commit/6ddd49edc39ae890cf1d621bf3e7bbe687808630))

## [0.12.1](https://github.com/kt0319/any-console/compare/v0.12.0...v0.12.1) (2026-08-13)


### Bug Fixes

* aarch64-linuxでgetpwuid_rのバッファ型が合わずビルドできない問題を修正 ([41b2a83](https://github.com/kt0319/any-console/commit/41b2a83b32b2e8905610d38dd9b22ac0241d40d7))


### Build

* Cargo.lockのバージョンを0.12.0リリースに追従 ([c07f1b7](https://github.com/kt0319/any-console/commit/c07f1b7526006363ecb7b0b6fe890dff8622f8b0))


### CI

* リリースのIntel macビルドを廃止済みmacos-13からmacos-15-intelへ移行 ([a0e1955](https://github.com/kt0319/any-console/commit/a0e1955b4aeaf5ac1424cf9ef32888f99a86ec59))

## [0.12.0](https://github.com/kt0319/any-console/compare/v0.11.0...v0.12.0) (2026-08-13)


### Features

* ./any-consoleスクリプトをバイナリ配布レイアウトでも動くようにする ([31e0a65](https://github.com/kt0319/any-console/commit/31e0a658180835ce458e6a5daff04dee234ec202))
* .gitが無い環境ではUIのUpdateカードを自動非表示にする ([5f02bb0](https://github.com/kt0319/any-console/commit/5f02bb00b02b94f15fbece9e8d19913c4ae41cf3))
* ActionsピルのpeekでGitHub Actionsの全ステータスを色分けする ([c6b5bd4](https://github.com/kt0319/any-console/commit/c6b5bd4b4e294ace7ec3bc18f05bf0c01a3ce4af))
* ActionsピルのpeekをPush/Pullと同様に状態で色分け+boldにする ([588f300](https://github.com/kt0319/any-console/commit/588f3007b2120aa044a395007272c6ea2cc69804))
* Actionsピルのpeekをアイコンはブラウン固定、ステータスのみ色分けに変更 ([8c82e2a](https://github.com/kt0319/any-console/commit/8c82e2ae50a8e5cc788dccae6cc685762e2cc677))
* agent_watch のポーリングループ・push 通知連携を実装 ([a9ac978](https://github.com/kt0319/any-console/commit/a9ac9783e3346e0488832cecdce2cb70633f0252))
* agent_watch.rs に collect_agent_states を実装（配線は未実施） ([e50b1a7](https://github.com/kt0319/any-console/commit/e50b1a791d1c46c484ae3e210faa1b36359e503f))
* agent-hooks イベント受信を Rust ネイティブへ配線する ([d0601ad](https://github.com/kt0319/any-console/commit/d0601ade0a5bfecf617653075736514054ec4c5f))
* blocked誤検知調査用にhookイベント受信の一時デバッグログを追加 ([9f8f5ac](https://github.com/kt0319/any-console/commit/9f8f5ac6ceb0530449ce280babe6bd4a3efedd3a))
* Claude Code hooksをリポジトリ管理・自動install化する ([cb2f94a](https://github.com/kt0319/any-console/commit/cb2f94a45981c9ff79229a9e6dd2b70c47c57781))
* dev server ポートプレビュー（preview.py）を Rust ネイティブへ移植する ([b90f528](https://github.com/kt0319/any-console/commit/b90f52823557db7ab38cc63679f49513d281c8aa))
* dispatch キューをネイティブ status stream へ直接配信する ([866cdb3](https://github.com/kt0319/any-console/commit/866cdb3bc68dfbf512f2de00c84dcaad1f10e355))
* Dispatch一覧でpendingを目立たせ実行済みを沈ませる ([55c778f](https://github.com/kt0319/any-console/commit/55c778f18abd01fe90bd54c8f7aeebe097e7c1de))
* embed-assetsフィーチャーでdist/agent_manifestsをバイナリに埋め込み可能にする ([e72df46](https://github.com/kt0319/any-console/commit/e72df46c58c3c289b23638d2e12518e6334cc031))
* git_watch の FS 監視ループ・自動 fetch ループを実装 ([2f7d551](https://github.com/kt0319/any-console/commit/2f7d55165f509da20231f27cb94c47a6f6a8da75))
* Historyペインで未pullのコミットを非アクティブ表示する ([5b6f1cf](https://github.com/kt0319/any-console/commit/5b6f1cfee177dd788421a6627209e36de6771e3d))
* Historyペインで未pushのコミットを非アクティブテキストで表示 ([3c6fc74](https://github.com/kt0319/any-console/commit/3c6fc74f0f64e3eb92a125fc5f2e99b5ef1fbe49))
* idleバッジを常に非表示にし、working完了後はdoneを既読までキープする ([08e9963](https://github.com/kt0319/any-console/commit/08e9963b87463bc220d44825290b10b218ce551a))
* manifest_update.pyの定期実行ループをRustへ移植 ([7640d3c](https://github.com/kt0319/any-console/commit/7640d3cf436efac5175a6d8b53b7a1918c2c2659))
* Open Session/Settingsをサイドバーからタブバーの独立ボタンへ分離 ([f0c85c5](https://github.com/kt0319/any-console/commit/f0c85c5c27cd823857ec7e6d7bc89f35cf1c7a68))
* push通知を端末単位で閲覧中セッションには送らないようにする ([3d60906](https://github.com/kt0319/any-console/commit/3d60906c8aac0c9c95ae28aed163ac312ab33e51))
* python3のランタイム依存を撤廃しany-console-server自身のCLIに統合する ([6b3c0fd](https://github.com/kt0319/any-console/commit/6b3c0fd5efbb03116d7853e8050c3f8bf2f0bb8b))
* Pythonへのプロキシ転送を撤去しRustを完全スタンドアロン化 ([f317cca](https://github.com/kt0319/any-console/commit/f317cca933155c2404a2f11981616c674e16fe9a))
* Rust移行 agent_hooks.rs — hookイベント駆動の状態更新を移行（配線は未実施） ([8f7f70d](https://github.com/kt0319/any-console/commit/8f7f70d4e70f36639155f1e0d36f5d574d8a0e41))
* Rust移行 agent_watch.rs — 状態判定・通知猶予判定を移行（配線は未実施） ([0519ae7](https://github.com/kt0319/any-console/commit/0519ae7479c4a92b82d10b0b5a55a253738e6c6e))
* Rust移行 foreground.rs — 前面ジョブ検出を移行（配線は未実施） ([d5528ec](https://github.com/kt0319/any-console/commit/d5528ec03fd99d8f6ad00520c69b5dc12107b11e))
* Rust移行 git_watch.rs — 監視対象決定ロジックを移行（配線は未実施） ([37725f6](https://github.com/kt0319/any-console/commit/37725f64b6fa4fd80008750e3f20b0b826e56916))
* Rust移行 job_match.rs — ジョブコマンド照合を移行（配線は未実施） ([7919a3a](https://github.com/kt0319/any-console/commit/7919a3aacb71cfcefd4106b15c5a36cbbd45971b))
* Rust移行 manifest_update.rs — リモートマニフェスト更新の検証ロジックを移行（配線は未実施） ([f47aa55](https://github.com/kt0319/any-console/commit/f47aa5511c95f4a6414554f911d07f944ea166eb))
* Rust移行 screen_manifest.rs — herdr manifest 評価エンジンを移行（配線は未実施） ([656eff9](https://github.com/kt0319/any-console/commit/656eff9a43a207774772793d02a322df3c4f243f))
* Rust移行Phase 0 — axumフロントサーバとPythonへの透過proxy骨格を追加 ([ed97fa4](https://github.com/kt0319/any-console/commit/ed97fa4bdc8acf14849f0603e65cb407b78f4d6e))
* Rust移行Phase 1 — config書き込みエンジンとsettings/groupsを移行 ([3c32093](https://github.com/kt0319/any-console/commit/3c320934255e8cd11ed10b4bcaa8748ad0708514))
* Rust移行Phase 1 — system routerをRustネイティブ実装へ移行 ([e445706](https://github.com/kt0319/any-console/commit/e44570686e3eadcd382a7e22e59a04c613a472a9))
* Rust移行Phase 2 — git実行コアと履歴/差分/コミット/スタッシュ系を移行 ([3902bde](https://github.com/kt0319/any-console/commit/3902bde616c72a2e710dc19078f7a50457a7afd8))
* Rust移行Phase 2完了 — ブランチ/ファイル/worktree/GitHub連携を移行 ([b7fd6a0](https://github.com/kt0319/any-console/commit/b7fd6a0c9928fe041cf9a1e61083187c58dc6e6a))
* Rust移行Phase 3 — ジョブCRUDとrecent-jobsを移行 ([c4657c1](https://github.com/kt0319/any-console/commit/c4657c170676450c955efc5eb8388986b32c400e))
* Rust移行Phase 4 — workspacesルーターとgit_infoを移行しnudgeブリッジを追加 ([59a15e0](https://github.com/kt0319/any-console/commit/59a15e0d7b1fa49ba166c75619e58816d662dd1a))
* Rust移行Phase 5基盤 — PTY/tmux制御を移行（配線は未実施） ([0239e06](https://github.com/kt0319/any-console/commit/0239e06b79f73dc4e51f1aaa420578ede1a443a8))
* Rust移行Phase 5基盤 — terminalルーターと移行ブリッジを追加（配線は未実施） ([23a4a61](https://github.com/kt0319/any-console/commit/23a4a6168ace21380c9be666236f8c3bf6e8529b))
* Rust移行Phase 5基盤 — ターミナルセッションレジストリを移行（配線は未実施） ([40b19f7](https://github.com/kt0319/any-console/commit/40b19f763f6c7e5643a71c9edfdb5b3db8eb5902))
* Rust移行Phase 5完了 — dispatch/runを移行しterminal/run/dispatchを配線 ([550f143](https://github.com/kt0319/any-console/commit/550f143b8ae77e10aa18c62a14752fc19496d6e1))
* Send History表示を最新が先頭になる順序に変更 ([bad67d3](https://github.com/kt0319/any-console/commit/bad67d3e71219b5ccd8b4ae14259da4a518be93a))
* status stream WS エンドポイント本体を実装（未配線） ([efa92cd](https://github.com/kt0319/any-console/commit/efa92cd309c623ac33e7beec19ef6ca9cd28cd4a))
* status stream WS を Rust ネイティブ実装へ切り替える ([019282e](https://github.com/kt0319/any-console/commit/019282efddcb107b1ff98a41dfb5af1111e87503))
* status stream の共有基盤（status_stream.rs / session_watch.rs）を追加 ([a019fd5](https://github.com/kt0319/any-console/commit/a019fd5026c5f41ba23a716938040f20f669c82f))
* tmux.rs に list_session_ids/list_pane_meta を追加 ([a5b4f17](https://github.com/kt0319/any-console/commit/a5b4f178c10b3311528324e9dd448e0b41100137))
* Web Push（VAPID/RFC 8291）をRustへネイティブ移植 ([f68cc68](https://github.com/kt0319/any-console/commit/f68cc687b942c268a35541dbc03c52340082a24d))
* workingの誤検知調査用にhookイベントの一時デバッグログを追加 ([c7b00e8](https://github.com/kt0319/any-console/commit/c7b00e83ded69f39f9bd1768d02f94a52401a8f3))
* エージェントがblockedになったらpush通知を送る ([acc7f3c](https://github.com/kt0319/any-console/commit/acc7f3c9a5610b09d1a8a6d65627b83f5236abf4))
* キーボードバーの入力欄を複数行対応にする ([5f8cef6](https://github.com/kt0319/any-console/commit/5f8cef6b0fc2717c1ed81387169e36b024ae4a7b))
* スニペットを使用しても並び替えず追加順（先頭=最初に使ったもの）にする ([674c2fd](https://github.com/kt0319/any-console/commit/674c2fdbbc46302893835b8da9bf48f5479806b4))
* セッションサイドバーの各行にもpeekピル（変化の一時表示）を出す ([fdadc41](https://github.com/kt0319/any-console/commit/fdadc41e0a48b383502e9367a8f9adbd6ccc0d39))
* ターミナル設定に選択時自動コピーのオン/オフ(Copy on Select)を追加 ([dd0ee3f](https://github.com/kt0319/any-console/commit/dd0ee3f372406073c0bd2bb84867dbc78d511f4e))
* バージョンをCARGO_PKG_VERSIONへビルド時埋め込みしrelease-pleaseと同期する ([286f2c2](https://github.com/kt0319/any-console/commit/286f2c2f701e8a298c3ed1b2f54313a9b8b74ae2))
* バイナリ配布にchecksum検証・原子的更新・--versionを追加する ([ed58e89](https://github.com/kt0319/any-console/commit/ed58e8992dccb3c6312dc2b4cc03497792e47c86))
* ランチャーをRust単独起動へ切替 ([05da309](https://github.com/kt0319/any-console/commit/05da309a9193dd9128fe9f0eeb239f76018e5dfd))
* リリースビルドCIとinstall.shでバイナリ配布を可能にする ([b79a5b9](https://github.com/kt0319/any-console/commit/b79a5b9d607a76b7ccbd3bb99dff764a5d098123))
* 公開bindへTLS終端をネイティブ実装（axum-server） ([05ecade](https://github.com/kt0319/any-console/commit/05ecade720454df1562326320e9ec2a637c9c8ce))
* 独立していたStashesタブをChangesタブへ統合する ([e1a2a0c](https://github.com/kt0319/any-console/commit/e1a2a0c708eb7d33d6dc991247ffb80b4db9ddb9))
* 画像アップロード（/upload-image）をRustネイティブへ移植する ([aa499a6](https://github.com/kt0319/any-console/commit/aa499a6fa2630f6d738da737e42b0c36110bc2af))
* 認証ドメイン（devices/api_tokens/pairing/auth.json）をRustネイティブへ移植する ([4c2a02f](https://github.com/kt0319/any-console/commit/4c2a02f239d99f4e7f4309ade04608c1f6438ee6))


### Bug Fixes

* --versionのgit SHA表示が同一ブランチの新規コミットで更新されないのを修正 ([6f06fd9](https://github.com/kt0319/any-console/commit/6f06fd94265b9369c7480087fac91cb2d91cdfed))
* /upload-imageのfileフィールド欠落を422へ揃え、アップロード定数を一本化する ([38a672e](https://github.com/kt0319/any-console/commit/38a672e9352f99e5895d4ea3b59133867beff76a))
* 2セッション目以降のタブでhook用環境変数が最初のタブの値になる不具合を修正 ([e243823](https://github.com/kt0319/any-console/commit/e2438230ca511bc1b67620357118226c523e59c0))
* activity ログ追記を1回の write にまとめて行の破損を防ぐ ([0d67991](https://github.com/kt0319/any-console/commit/0d6799112097082db711b3f8df7dc18f1e3223c3))
* auth.jsonのtokenが非文字列truthy値のとき認証が無効化される脆弱性を修正 ([57d4b4b](https://github.com/kt0319/any-console/commit/57d4b4b1d23c12aef2641649e109df1b8702ee71))
* bashパーミッションプロンプトのblockedが答えた後も居座らないようにする ([b9d7fb8](https://github.com/kt0319/any-console/commit/b9d7fb8600c9a876ad094c542fc4c701fb66350b))
* clippy question_mark 警告を解消（push.rs） ([ff2e819](https://github.com/kt0319/any-console/commit/ff2e819c2f1481623fcb4ed087ac6af29ce377dd))
* Codexレビュー指摘のセッション整合性・pending text関連バグを修正する ([c2de864](https://github.com/kt0319/any-console/commit/c2de8643f256038710cc0b21ceed1f397b98cde9))
* Codexレビュー指摘のデバイスlast-seen更新・recent-jobs検証を追加する ([d127046](https://github.com/kt0319/any-console/commit/d127046eb37f315c8803b922d5791398560a3868))
* Codexレビュー指摘の認証バイパス系脆弱性を修正する ([1085fa6](https://github.com/kt0319/any-console/commit/1085fa6637be5621644092487b49f3278a175252))
* config スキーマの bool/int 変換を Pydantic の lax 変換に合わせる ([d1662c5](https://github.com/kt0319/any-console/commit/d1662c53bfc3e504af1c7da0819d2a40a9931971))
* config.json のread-modify-writeを排他ロック下で原子化しlost updateを解消 ([5525416](https://github.com/kt0319/any-console/commit/55254167ee4112fb572e1af467db990a1e626b06))
* dispatch rerun の activity ログに実際の認証ラベルを使う ([ff06d4c](https://github.com/kt0319/any-console/commit/ff06d4c078887d3591ab69cbd543ba208acbc7cd))
* dispatch キューの Python 側ブリッジを定期的に再送する ([7b383bf](https://github.com/kt0319/any-console/commit/7b383bfbc7a1608e0f6702b3b055cdfbba18bb84))
* dispatch キューのブリッジスナップショットに有効期限を設ける ([d8564fa](https://github.com/kt0319/any-console/commit/d8564faebe80069c41571655fdc698094cbe4182))
* dispatch の承認二重実行と dedup 集約漏れの競合を解消 ([ee6ca78](https://github.com/kt0319/any-console/commit/ee6ca7871d83b58037fc8fd59119c6c39167c06b))
* dispatch ブリッジのスナップショット送信に revision を付けて順序保証する ([d5bf468](https://github.com/kt0319/any-console/commit/d5bf468d06d83f1f21a46d2ab5da6f0ca90ac54f))
* dispatch 履歴に effective_workspace を再計算して保存する ([461a984](https://github.com/kt0319/any-console/commit/461a98481caca93fbbd8b5281904cd650c98dc82))
* doneなセッションは操作またはアクティブ化で即座にdoneを解除する ([f63f518](https://github.com/kt0319/any-console/commit/f63f518bd42ecb5848fcd8a1f85230279c9fdbd1))
* dynamic_workflow_promptのblockedも答えた後に居座らないようにする ([79dec60](https://github.com/kt0319/any-console/commit/79dec6024fe0d18d74685a287d4d9f93c2f1458c))
* History内で異なるコミットの同名ファイルdiffを選び直しても更新されない不具合を修正 ([d8943cc](https://github.com/kt0319/any-console/commit/d8943ccf8d1382c35d8f01a2b064a4b7081be057))
* hooks用URLがTLS環境で繋がらない問題を修正 ([ab73cb6](https://github.com/kt0319/any-console/commit/ab73cb643110f242a4ea4dfa1108327781776f22))
* Job作成のScope選択をCommon/Workspace単一selectに統合する ([6b2cdb6](https://github.com/kt0319/any-console/commit/6b2cdb64ff015e75a07bb894e9da6df8b2b9bf92))
* mainのJob browserタイプ廃止にRust側を追従させる ([06bd005](https://github.com/kt0319/any-console/commit/06bd005bb536114e006227729b0f66c5f8c9d549))
* Notificationフックの汎用リマインダーをblocked扱いしないよう修正 ([2a47b05](https://github.com/kt0319/any-console/commit/2a47b05e205c4faf3894704ac332ba83e1130c23))
* PageUpとPageDownの捕捉を強化 ([1544eac](https://github.com/kt0319/any-console/commit/1544eacfa7eb423543a06cdff2170d12185c0b79))
* PageUpとPageDownをターミナルへ送信する ([832767c](https://github.com/kt0319/any-console/commit/832767c0e082575b19348de1facb5cdfefa15e7e))
* pending text の flush 権をセッション単位で1回だけクレームする ([01a0bd4](https://github.com/kt0319/any-console/commit/01a0bd4b75bcc93cbfe67dee75ed2a3d351f229b))
* proxy で元クライアントの Host ヘッダを upstream へ引き継ぐ ([d1da93d](https://github.com/kt0319/any-console/commit/d1da93d7eed1d571ebdc10434936202fdeefe192))
* Pull/Pushでコミット0件の時のトースト文言をPulled/Pushedと区別する ([3b16ad9](https://github.com/kt0319/any-console/commit/3b16ad92fe739957ba1139658d42e9ea50ac37aa))
* pullがバックグラウンドfetch後でも正しい取得件数を報告するよう修正する ([e91e477](https://github.com/kt0319/any-console/commit/e91e47703eebf5fc55eedbc1e41b334e7ae6273f))
* reqwest に rustls-tls を追加して favicon の HTTPS 取得を可能にする ([7885f06](https://github.com/kt0319/any-console/commit/7885f06244117784fc91a95fd8879cd716ea4660))
* ssが無い環境ではポート検出をlsofへフォールバックする ([75df61f](https://github.com/kt0319/any-console/commit/75df61fddd1ac9ab2db923949afde73fa7a1f694))
* update/https-setupで登録済みサービスのユニット定義を作り直す ([0b7e4a2](https://github.com/kt0319/any-console/commit/0b7e4a2e9bdf75bb7c86a180914f71a7dc053c29))
* upstream未設定での初回pushでもトーストにコミットメッセージを表示する ([018a8d3](https://github.com/kt0319/any-console/commit/018a8d306f45c6b5e031b83f29e54e8fd7823dd8))
* アイコン保存失敗を握りつぶさずエラーとして伝播する ([1c68044](https://github.com/kt0319/any-console/commit/1c68044645fb0f509138027f3ee8b910070f7f6b))
* サイドバーworkingアニメーションの向きを下→上にする ([2e787bf](https://github.com/kt0319/any-console/commit/2e787bffa3cfdad05a5a095a64b50250de607c10))
* サイドバーのpeekピルを右寄せにし、peek中は閉じるボタンを隠す ([5bac482](https://github.com/kt0319/any-console/commit/5bac48228131d9b8ed5bb86ab521b0f69f0aee2d))
* セッションサイドバー行のResizeObserverをアンマウント時に解放する ([f37dc68](https://github.com/kt0319/any-console/commit/f37dc6865dd2461e01c928c08dd61cc57392ba2c))
* タブバーの+ボタンがタブ本体と重なる不具合を修正 ([4b4ab59](https://github.com/kt0319/any-console/commit/4b4ab59c74056e701d64f088d6ed22a4ae803e0c))
* タブバーのアクセシビリティTODOを修正 ([845d6a1](https://github.com/kt0319/any-console/commit/845d6a163924091b0fb8673f7785c5d8110133e2))
* バイナリgit実行経路にもCロケール強制を適用する ([767eb60](https://github.com/kt0319/any-console/commit/767eb605979699a5dd278c81b3c0cfcf6e4a437c))
* ブランチモーダルのpush/pull後にHistoryペインを更新する ([d6ba451](https://github.com/kt0319/any-console/commit/d6ba4516d539d3be58f4019cf8943dca643c1ed2))
* ブランチ作成ダイアログのボタンへ共通のdialog-btnスタイルを適用する ([9d9a0da](https://github.com/kt0319/any-console/commit/9d9a0da7e423f80cb5ee65f357b793639c742c01))
* ブランチ切り替え成功時にSessionsサイドバーまで閉じてしまう不具合を修正 ([e09e045](https://github.com/kt0319/any-console/commit/e09e0452c16def4ff627c2e704f884f45401433a))
* マーキーピルが最後まで流れきる前に消えるのを修正する ([f6537d1](https://github.com/kt0319/any-console/commit/f6537d1f14d450f984c67751b16c6f8fb4108688))
* ワークスペースパス検証でシンボリックリンク経由の脱出を防ぐ ([1a6d55c](https://github.com/kt0319/any-console/commit/1a6d55cf149f383d95d8903cc88d31e4d115908b))
* 一瞬だけworking扱いになったセッションをdoneと誤表示しないよう修正 ([e84d4ee](https://github.com/kt0319/any-console/commit/e84d4ee9a6d0c448814be452c0c6d717fbebde8e))
* 不正な stash リクエストボディを 422 で拒否する ([bae00bd](https://github.com/kt0319/any-console/commit/bae00bdba9dd22ef38632fb0ea74309e0d0d879f))
* 常時表示のActionsピルのアイコン色をブラウン固定にする ([42388f7](https://github.com/kt0319/any-console/commit/42388f7fc4b45deccc436eef5dbd6799cee2e538))
* 端末リサイズだけでworking誤検知しないようにする ([8722f0d](https://github.com/kt0319/any-console/commit/8722f0d5ae88dd3288ac089d9eaabe9ad8bc01f8))
* 通知タイプをオフにしてもpush通知が表示される不具合を修正 ([952ffb8](https://github.com/kt0319/any-console/commit/952ffb8b7a0b8008ea77da986d5efe398ad857cd))
* 非ASCIIファイル名のダウンロードで500になる問題を修正する ([eff7d3b](https://github.com/kt0319/any-console/commit/eff7d3b451835e30fb319b9653f07911ef7b3ee5))


### Performance Improvements

* worktree 探索・git_info 取得を Python と同じ上限付き並列度に合わせる ([2bdc312](https://github.com/kt0319/any-console/commit/2bdc31269db5a22240ab3f15a64f0814d17c3f0f))
* セッション一覧取得のtmux問い合わせを並列化する ([503690d](https://github.com/kt0319/any-console/commit/503690d3541dcae50391f09a83b4efe08420d23d))


### Refactor

* activityログのfieldsヘルパーをgit_helpersへ共通化する ([fa2a7c2](https://github.com/kt0319/any-console/commit/fa2a7c2fae4228663053b1af8619329244aaa084))
* agent_watchの状態定数をscreen_manifestの定義へ統一する ([4298db8](https://github.com/kt0319/any-console/commit/4298db8289d01d61065ab5d92c658deeb78a3cbb))
* Ctrl/Cmd+Cのターミナル選択コピーをclipboard.jsへ共通化する ([3f3363d](https://github.com/kt0319/any-console/commit/3f3363d33779dbc4256efb9f950d21c431c9a4a6))
* DispatchDecision/DispatchRerunの共通フィールドをserde(flatten)で一本化する ([44cda66](https://github.com/kt0319/any-console/commit/44cda6655c790e5d7894d4e8450ef597b84934c7))
* dispatch実行ログ・worktreeエラー変換・auth読込の定型を共通化する ([6499efb](https://github.com/kt0319/any-console/commit/6499efbc7b34a950a845dba798ca3222a9c40fa0))
* peekピルの派生値をusePillPeekへ集約し古い「…ピル」前提の命名・コメントを修正する ([2d1632e](https://github.com/kt0319/any-console/commit/2d1632ee75de12d0431beb9d706436f80052bdb1))
* Pythonバックエンド一式を削除しRust単独運用へ完全移行 ([786dacd](https://github.com/kt0319/any-console/commit/786dacd6173f813ee337ace8c0ddbc36a19ac920))
* SessionListViewのピル遷移組み立てをopenPaneForへ集約する ([5925803](https://github.com/kt0319/any-console/commit/59258032bddfa1cb9ecce6ffe79258b4b04b8f2e))
* task_running・IS_MACOSをutil.rsへ集約しsystem.rsのgitヘルパーを共用化する ([6eddf78](https://github.com/kt0319/any-console/commit/6eddf782230a9cbaeeadf747914274ff6a82ce76))
* TERMINAL_JOB_KEYの二重定義をjobs_commonの定義へ一本化する ([49d7365](https://github.com/kt0319/any-console/commit/49d7365533d34fe93658af1234f3035062663722))
* tmux関連の重複を整理する（skip_if_no_tmux共通化・セッション列挙の共用） ([bd2ff2c](https://github.com/kt0319/any-console/commit/bd2ff2ca7921a13e10cc54fadd5907c6aea8f512))
* viewingメッセージの組み立てをstatus-stream.jsへ集約する ([03c9518](https://github.com/kt0319/any-console/commit/03c9518894f4bf0a0dd609e04e266b89daff24ce))
* グローバルキー無視ガードと端末入力送信経路の重複を解消する ([3c69616](https://github.com/kt0319/any-console/commit/3c696166e09b29b74c80619816e39a2e97f655c7))
* セッションサイドバーの通知アニメーションを行単位の左インジケーターへ統一し速度をタブに揃える ([95d407a](https://github.com/kt0319/any-console/commit/95d407a77f287b488d8355de3ab5ea1a4a2dfc3a))
* タブのロービングフォーカス計算を純粋関数tab-nav.jsへ切り出す ([26ad8de](https://github.com/kt0319/any-console/commit/26ad8de56d55ab02419f4bd5233760dc51277bba))
* トースト発火をuseToastへ統一する ([d5fde4f](https://github.com/kt0319/any-console/commit/d5fde4faf94bce8fe7c86ef54e6eaefb933d692e))
* ピル幅の直書き数値をconstants.jsへ集約しpeekフィールド組み立てを一本化する ([d6f3c0e](https://github.com/kt0319/any-console/commit/d6f3c0e39bd294aadc004001f2b4c256a303ccf1))
* モーダルビューのinject直書きをuseModalViewへ統一する ([f3d5325](https://github.com/kt0319/any-console/commit/f3d53258bf44d865afe5acff3a3743b0c94ae624))
* 参照されていないデッドCSSを削除する ([bea52f9](https://github.com/kt0319/any-console/commit/bea52f95f3a8a0d1e8e41ae26cf37a5bea7c2179))
* 実装と食い違う関数名を実態に合わせてリネームする ([4981281](https://github.com/kt0319/any-console/commit/4981281a93ce5d440d2b65f3b300b1c155b4f979))
* 履歴↑↓のカーソル行境界判定を純粋関数としてkeyboard.jsへ切り出す ([f230efd](https://github.com/kt0319/any-console/commit/f230efdb76c193e55010c08c0374e027356bf5a2))
* 未フォーマットのRustコードにcargo fmtを適用する ([25a2a0c](https://github.com/kt0319/any-console/commit/25a2a0c4db287acbd749b21cf79c36ae128f8f9e))
* 未使用のmetadata_json/save_workspace_jobs_dataを削除する ([c02ddca](https://github.com/kt0319/any-console/commit/c02ddca1ff0facad3cbe70e29f52f6e948b5ac48))
* 生成経路の無い.pill-peek-errorのCSSを削除する ([5cd2f89](https://github.com/kt0319/any-console/commit/5cd2f898f057b1c7ac8ec645fffd37638f5b86bf))
* 直近の修正で残った重複・デッドコードを整理する ([c4fb954](https://github.com/kt0319/any-console/commit/c4fb954b1136d7989f5a64c6ba0d95537e7bfda9))
* 統合テストのAppState構築・共通ヘルパーをtests/common/へ一本化する ([0b7544f](https://github.com/kt0319/any-console/commit/0b7544f5cacdb49ddf942d9d83c209123c44ef51))
* 重複していた時刻・文字列ヘルパー等をutil.rs/jobs_commonへ集約する ([bf7a9cc](https://github.com/kt0319/any-console/commit/bf7a9cce41530d399cdb7a93eb63b20bd41fd6cb))
* 長さ検証check_max_lenをjobs_commonへ一本化する ([bfd5c25](https://github.com/kt0319/any-console/commit/bfd5c25b5b95d6112ec539a92d1df4783da6194c))


### Documentation

* job_match.rs が agent_watch.rs から利用中である旨を反映する ([b345715](https://github.com/kt0319/any-console/commit/b345715f11d30bde79102ff808d0c928a311655c))
* Python撤去後の残存参照をさらに削除 ([be54a20](https://github.com/kt0319/any-console/commit/be54a2014c6a68d1f7f854c5496698d35e6590f1))
* Python移行完了後に陳腐化したコメントを実装に合わせて修正する ([d3fc878](https://github.com/kt0319/any-console/commit/d3fc878fdb1feb7c21cb1e9553178e6461556a5e))
* README/install.shのpython3必須記載を削除する ([49d38f4](https://github.com/kt0319/any-console/commit/49d38f49e7d0f6c0a0b1dcb3357657b599c44747))
* READMEの配布方法をQuick installのみに統合し簡素化する ([3d99d5f](https://github.com/kt0319/any-console/commit/3d99d5fc66c91b73cc8a54932a3fffbb00cc85d5))
* RUST_MIGRATION.md に agent_watch.rs の移行状況を反映 ([c334ddb](https://github.com/kt0319/any-console/commit/c334ddbeeaa309b6e0689c99f46b8d244bed7854))
* RUST_MIGRATION.md に collect_agent_states 実装状況を反映 ([3cd1720](https://github.com/kt0319/any-console/commit/3cd1720dec0c19496edb4f54a17a09fc1df3c22e))
* RUST_MIGRATION.md に foreground/job_match/agent_hooks/screen_manifest の移行状況を反映 ([914a5dd](https://github.com/kt0319/any-console/commit/914a5dd0a42f3e38f3853832ccbc3713b9098a1b))
* RUST_MIGRATION.md に git_watch.rs の移行状況を反映 ([85fb646](https://github.com/kt0319/any-console/commit/85fb646b801a4b98d81059c5cd008b73f4ab0d80))
* RUST_MIGRATION.md に manifest_update.rs の移行状況を反映 ([21a108e](https://github.com/kt0319/any-console/commit/21a108e8624a180aaac96807a70274bf083d3483))
* RUST_MIGRATION.md に status_stream.rs / session_watch.rs の移行状況を反映 ([51dd4cc](https://github.com/kt0319/any-console/commit/51dd4cca6b48d563d61f04b7335e8ba326aca53c))
* RUST_MIGRATION.mdのIS_DARWIN参照をutil.rsのIS_MACOSへ更新する ([6e03d3f](https://github.com/kt0319/any-console/commit/6e03d3fdfa80b4c5218ab2f19e294eb3d310603c))
* Rust移行ドキュメントを status stream 本番切替完了の状態に更新する ([81b71ae](https://github.com/kt0319/any-console/commit/81b71ae3898d241e8ec3ba816c9a8cbfd01d61ec))
* ドキュメントを現行実装に追従させる ([df9368c](https://github.com/kt0319/any-console/commit/df9368c62d116e518b742db799fcc46321d2d7ff))
* バックエンドRust移行の優先順位付き計画を追加 ([5122d3c](https://github.com/kt0319/any-console/commit/5122d3c4206ac2c4d4a72c26b653384183004e25))
* バックエンドRust移行の優先順位付き計画を追加 ([a152790](https://github.com/kt0319/any-console/commit/a15279034ce2f283481d3f47391ca70459a4008f))
* 既存インストール先のRust切替パスに関する注意を追記 ([5ef6e6c](https://github.com/kt0319/any-console/commit/5ef6e6c942c89a116d9dc0050220a11517bf2066))


### Tests

* agent_watchの実tmux依存テストのflakinessを解消する ([068d84b](https://github.com/kt0319/any-console/commit/068d84ba62a5b49034ad52cfd33e7c95cd01e4cc))
* APIワイヤ契約のE2Eスペックを追加しRust移行の回帰網にする ([7a72c4b](https://github.com/kt0319/any-console/commit/7a72c4bc07f452e4a57adec36d65e894bae22057))
* claude/codexを複数同時起動するローカル専用stressスクリプトを追加 ([174a733](https://github.com/kt0319/any-console/commit/174a7334164a05336b0a9400b1621fd3ebf83b38))
* E2Eテストを拡充する ([26f4715](https://github.com/kt0319/any-console/commit/26f47158dd46ff53c31e571a391f8ba4e2c93bd3))
* E2Eのログイン+セッション後始末フックをhelpersへ共通化する ([ea7ab9a](https://github.com/kt0319/any-console/commit/ea7ab9a305d17761090b22c1e8f26c28d65706f7))
* E2Eの新規ターミナルオープンとナビルート遡りをhelpersへ共通化する ([04d00a3](https://github.com/kt0319/any-console/commit/04d00a39eceed85febd844ca6fafbf2abc09b8e2))
* hooks install-claudeの統合テストを追加する ([b3fcf29](https://github.com/kt0319/any-console/commit/b3fcf290f9d15d63e6cd2db9818d08f24479447a))
* サークルキーパッドのページキー送信を検証 ([4b55e87](https://github.com/kt0319/any-console/commit/4b55e87f1c809c9c31070e1c2eddbfb494a3caab))
* 二重化していたpill-peekのテストファイルを統合する ([5b616ec](https://github.com/kt0319/any-console/commit/5b616ecb98ac4ccdf0a3ad5cb7a5947163fa1581))


### Build

* cargo fmtでフォーマットする ([59aefde](https://github.com/kt0319/any-console/commit/59aefdeee25e4cd34b2b5a085a4e126ea844ef5f))


### CI

* macos-setupから不要になったsetup-pythonステップを削除する ([eb9c7a6](https://github.com/kt0319/any-console/commit/eb9c7a6ae57d6f6769a38f287ca51c378aa97572))
* Rust front を経由した api-contract E2E ジョブを追加する ([5f236e4](https://github.com/kt0319/any-console/commit/5f236e4b4e650d58db054f5ce15ba5e1a4ee71bb))

## [0.11.0](https://github.com/kt0319/any-console/compare/v0.10.0...v0.11.0) (2026-08-08)


### Features

* branch peekのPushed/Pulledに件数を表示する ([f782028](https://github.com/kt0319/any-console/commit/f7820287d48975c8d95cd0758b8e6238c6b8438b))
* branch peekのPushed/Pulledに件数を表示する ([a4b63cc](https://github.com/kt0319/any-console/commit/a4b63ccf707bc0eabee0deb83c4ea4258f765dfc))
* herdrのscreen manifestで既知エージェントの承認待ち(blocked)を検知 ([5db8ca1](https://github.com/kt0319/any-console/commit/5db8ca1cc6d4b69a80293665a9c951eefb264dc3))
* PCサイドバーはターミナルをリサイズし、WorkspaceDetailを独立オーバーレイに切り出す ([84b75de](https://github.com/kt0319/any-console/commit/84b75deaeee022ab73dc204bf0f3afeb592697e3))
* pendingワークスペースの承認待ちdispatchをサイドバーで扱えるようにする ([a138598](https://github.com/kt0319/any-console/commit/a138598774e37931072fcfd41d41baf5d2746864))
* pending行の承認待ちが1件だけならRun Dispatchへ直接飛ぶ ([1ae3aa9](https://github.com/kt0319/any-console/commit/1ae3aa928c8841ad6a8cb75524bd8189774eeee2))
* screen manifestをherdr同構成に拡張（全エージェント同梱・リモート更新・ローカルoverride） ([e10217a](https://github.com/kt0319/any-console/commit/e10217a62ee3a88a415f864a42a4f1f424309ce7))
* エージェントhooksをセッション状態の最優先ソースとして追加 ([f407928](https://github.com/kt0319/any-console/commit/f4079288c351566697a29d211aecce85d26569ba))
* エージェント状態判定システムの実装（manifest・hooks・ジョブ照合） ([986d569](https://github.com/kt0319/any-console/commit/986d569acd4405cdbd4f3229725fab25eb904596))
* セッションサイドバーの各行にInfo Pills（Files/History/Branch/PRs/Actions等）を表示する ([18b61eb](https://github.com/kt0319/any-console/commit/18b61ebfe97249d6d42f082f6db8f1398a8eb4c9))
* セッションサイドバーの開閉状態をlocalStorageに保存する ([f491133](https://github.com/kt0319/any-console/commit/f491133afa94a6f2b7807792b2842526a39f0c07))
* セッションタブ左端のハンバーガーからセッションサイドバーを開けるようにする ([2cb74e9](https://github.com/kt0319/any-console/commit/2cb74e948abc93b33a62c632e17a1b9810a2edeb))
* セッションタブ左端のハンバーガーからセッションサイドバーを開けるようにする ([dcb4612](https://github.com/kt0319/any-console/commit/dcb4612b24cdafe424de11bf92ff9eb607aff6b1))
* セッション一覧の行にタブと同じ状態演出を揃える ([9b2a360](https://github.com/kt0319/any-console/commit/9b2a360139d8173699a1b9b926529d7c54eb5170))
* ソフトキーボードにQWERTY/Fn/History/Snippetの切替タブを追加 ([b08aad2](https://github.com/kt0319/any-console/commit/b08aad276b4f7acb602e95a7ac04485bb9488609))
* モバイルの設定オーバーレイに右下の閉じるボタンを追加する ([80726a1](https://github.com/kt0319/any-console/commit/80726a167d299394e2aa1ff3cd64e00edf3dc9ed))
* ワークスペース/ジョブの自動紐付けをpush通知しタブアイコンとトーストで即座に反映する ([c819b5a](https://github.com/kt0319/any-console/commit/c819b5a7c98df33eee271c384908560e9f9bdc46))
* 前面ジョブのargvでラッパー起動検知と手打ちコマンドのジョブ自動タグ付けを追加 ([85057b2](https://github.com/kt0319/any-console/commit/85057b29ea86c6d75fe306d171851f2873786a54))
* 実行済みDispatchをモーダルで内容を編集してから再実行できるようにする ([bf699e6](https://github.com/kt0319/any-console/commit/bf699e6e3563cd98a9c83446419972d4332e3f78))
* 既知エージェントのworking/idleもscreen manifestで判定する ([75addaa](https://github.com/kt0319/any-console/commit/75addaa69f86ed0ce4f9ddee6c9e03ae13488380))
* 歯車ボタンを廃止しセッション一覧と設定をハンバーガー1つに統合する ([78af690](https://github.com/kt0319/any-console/commit/78af690203c274be29365101490de2d9f2eb4926))
* 稼働中セッションもペインcwdでワークスペースを自動紐付けする ([b1e6287](https://github.com/kt0319/any-console/commit/b1e62872e978ddc5e11028f0264b8fcec6b695dc))


### Bug Fixes

* Actionsピルのアイコンと色を状態によらずタブと統一する ([f6b7847](https://github.com/kt0319/any-console/commit/f6b78470cb852e1114b14d7ac11a0e07b3a7235d))
* blockedの点滅を通知と同じ青に統一する ([379e554](https://github.com/kt0319/any-console/commit/379e554613137a0ad5f5c9025f9262ebd0f5bb36))
* branch peekの表記を"Push Done"/"Pull Done"から"Pushed"/"Pulled"に変更 ([4bfcf40](https://github.com/kt0319/any-console/commit/4bfcf408f80f579fb75aaf1bf42ac63c324fcd58))
* Dispatch Queueの「Rerun without changes」ボタンを削除 ([a1e5e10](https://github.com/kt0319/any-console/commit/a1e5e104f25f99bbe9ba2439b41b4698606d5c58))
* Dispatch/pendingの見た目をピンクに統一しアイコンも変更する ([9adb0b6](https://github.com/kt0319/any-console/commit/9adb0b63c5967842865f96e87d2c9bb95fd4525f))
* git pull --rebase後のトーストに自分のリベース済みコミットが混入する不具合を修正 ([d8566b6](https://github.com/kt0319/any-console/commit/d8566b66c6a800b12fc6088e6ab0e1a49dc32a29))
* Info Pillのマーキーを先頭の文字が見えている状態から開始する ([0b610ff](https://github.com/kt0319/any-console/commit/0b610ffd4efca0053bb66296c68d5f24184eda75))
* match_workspace_by_pathがホーム配下のワークスペースパスを一切マッチできない不具合を修正 ([41411e8](https://github.com/kt0319/any-console/commit/41411e8538b53ea73d7f0d95ef44a58b8b339f51))
* pairingのポート判定でURL.portをintに確定させmypyエラーを解消する ([a3b883e](https://github.com/kt0319/any-console/commit/a3b883ebbc974fc0950d92bd39f8742760666710))
* PCでもサイドバーのセッション行にClose tabボタンを表示する ([b6f133b](https://github.com/kt0319/any-console/commit/b6f133be74b9fbf1569254bf085cf535778fccf3))
* pending行のFilesピルにワークスペースアイコンを出す ([78048c2](https://github.com/kt0319/any-console/commit/78048c2ec830a9d68a02bab7159e527b5651896a))
* pull/push成功トーストの表記を"Pull done"/"Push done"から"Pulled"/"Pushed"に統一 ([de92a2e](https://github.com/kt0319/any-console/commit/de92a2e912ed9096251baf2aa4fa0deec0bbf919))
* PWAインストールプロンプトのリスナ累積とイベント取り逃しを修正する ([e4f3ade](https://github.com/kt0319/any-console/commit/e4f3ade5f8a69e2e980b8b154c5a99daf393be3c))
* WorkspaceDetailオーバーレイでHistory等のペインがスクロールできない不具合を修正 ([081f828](https://github.com/kt0319/any-console/commit/081f828c611434762e884390099afacabe9db3e7))
* サイドバー表示中はハードウェアキーボードのキー転送を止めEscで閉じられるようにする ([8bc237a](https://github.com/kt0319/any-console/commit/8bc237af0d94ae9e671847acfcfcd01d0b38ba27))
* セッション一覧行のホバーがピル部分でも連動するようにする ([9cb88f5](https://github.com/kt0319/any-console/commit/9cb88f5b92f97134c7652c0f0feae6525a32180e))
* ダブルタップズーム防止の除外を現行のハンバーガーとKeyboardBarに更新する ([95a40a4](https://github.com/kt0319/any-console/commit/95a40a4fb6734966b8ed2029560427e43257abb6))
* ハンバーガーで開いた時は常にセッション一覧から始まるようにする ([1ff2942](https://github.com/kt0319/any-console/commit/1ff2942e0593657f2204730cfe4af1e559c1d9c1))
* フォルダzipダウンロードに.git除外・symlinkスキップ・サイズ上限を追加する ([6e9f630](https://github.com/kt0319/any-console/commit/6e9f630d176e821f90623617756e6e93603c8e87))
* モバイル設定オーバーレイの閉じるボタンをWorkspaceDetailModalと同じ形にする ([30f984d](https://github.com/kt0319/any-console/commit/30f984d7b139afb8fa596a136e3679e8e24d796d))
* ローカルブランチ作成後にリモートブランチ一覧が重複表示される不具合を修正 ([81b0e78](https://github.com/kt0319/any-console/commit/81b0e788a851ceb8c64c90fa73ea9fb033a61d96))
* ローカルブランチ作成後にリモートブランチ一覧が重複表示される不具合を修正 ([cf8476b](https://github.com/kt0319/any-console/commit/cf8476b3bef8763791e0943780ebd5a4369449cc))
* 入力履歴↑↓のフリック矢印と物理キーボードで状態を共有する ([7cce00e](https://github.com/kt0319/any-console/commit/7cce00e717aec2b7024fc289316623d14c3d9be5))
* 復元時のワークスペース自動判定を match_workspace_by_path に委譲する ([196f740](https://github.com/kt0319/any-console/commit/196f7409441c9b433709987b1984e9b381c053c9))
* 登録済みワークスペースパスの解決マップを git_utils に一本化 ([c65eb23](https://github.com/kt0319/any-console/commit/c65eb236337e09ed58587b068ca3e7822031ff67))
* 通知とblockedのタブ点滅を同じリズムに統一し色だけで種類を示す ([26436a0](https://github.com/kt0319/any-console/commit/26436a03fb8e0a8e058ae692fbc0a3c4f1b60fbe))


### Performance Improvements

* GitHubのPR/Actionsポーリング間隔を専用定数の30秒に分離する ([7b43163](https://github.com/kt0319/any-console/commit/7b431637a0d7f71d06ee5334213972a055b535ea))
* ブランチ一覧の未push件数計算をrev-list 1回に一括化する ([09dc81c](https://github.com/kt0319/any-console/commit/09dc81caeec67c0ba837ea6206590f3c14335f3d))


### Refactor

* bg-tertiary系ホバーを hover-bg / hover-bg-text ユーティリティに共通化 ([0aef9d7](https://github.com/kt0319/any-console/commit/0aef9d7e007c0cd8e7e240c6cd391f58c98c0cee))
* bindホスト解決とloopback判定を common / config に共通化 ([3395162](https://github.com/kt0319/any-console/commit/33951624944589b9c1c9d704236ca912e4efdceb))
* Detached Sessionsの表示位置と操作をシンプルにする ([5482c57](https://github.com/kt0319/any-console/commit/5482c577219dc32841a9c7aab3fdd761f12f91b1))
* dev server URL組み立てとGitHub PR/run照合をui/utilsへ共通化する ([cb235d9](https://github.com/kt0319/any-console/commit/cb235d9b8fa51e9bf695ac91c29b303d79eb3442))
* DispatchのセッションURL直書きをEP_TERMINAL_SESSIONS定数に置き換える ([7a9960c](https://github.com/kt0319/any-console/commit/7a9960c4a854c98b7c075f43593d6b750591b8b6))
* Dispatchをワークスペース詳細のタブに統合する ([4e92f33](https://github.com/kt0319/any-console/commit/4e92f33dd32b27c616d4d4bcefdca135da25da2e))
* Dispatch履歴の永続化をcommonのsave/load_json_fileへ一本化する ([f143609](https://github.com/kt0319/any-console/commit/f14360903f1530abffffe6e3cecdf8145fbb0e0c))
* Dispatch直近履歴の保存スキーマをDispatchRequestに正規化する ([da2bb15](https://github.com/kt0319/any-console/commit/da2bb15bfe2e39410d8c69130509636738cc8ff5))
* Dispatch行・FileBrowserヘッダー等の残る重複を共通化する ([4b7e171](https://github.com/kt0319/any-console/commit/4b7e171fa5ffa8e835026125042582f032809e05))
* git fetch / stash drop の activity 記録を共通エピローグへ統一 ([7413f77](https://github.com/kt0319/any-console/commit/7413f77eaaf7e7cf7e54e127ca26f7e9e0688d8d))
* GitHubファイルURL生成を buildGithubFileUrl に一本化 ([598e002](https://github.com/kt0319/any-console/commit/598e002f13b26509932d93848fbd5c9e6e75d320))
* git操作成功時のactivity記録エピローグを git_helpers に共通化 ([7a56097](https://github.com/kt0319/any-console/commit/7a560974432d5ac6599365bb68d122631a37e98d))
* Info Pillsのツールチップ組み立てとGitHubポーリング開始/停止を共通化 ([0693057](https://github.com/kt0319/any-console/commit/06930577cb1a3c443e7e25c78b1b2582e76f2511))
* Info Pills定義をui/utils/info-pills.jsの単一テーブルから導出する ([d86fb51](https://github.com/kt0319/any-console/commit/d86fb512566cc57e340ff1f1a39ce01f5e57d6f2))
* localStorage 永続化を storage.js のヘルパーに集約 ([f54e951](https://github.com/kt0319/any-console/commit/f54e9516e26aee63e7a5ed225dc753b9c7b72557))
* Open Sessionをセッション一覧の最上部に配置しPCの閉じるボタンを整理する ([205b7fe](https://github.com/kt0319/any-console/commit/205b7fe99eb81c1f7b6347d796b74a66c63ae45e))
* Open Sessionを下部固定メニューのSettingsの上に戻す ([1089dd5](https://github.com/kt0319/any-console/commit/1089dd5f4cb33afc1cb082f22ea68d2d10e267e3))
* Open Workspaceのタイトルをボタン文言に揃える ([012b49e](https://github.com/kt0319/any-console/commit/012b49e51edd0e99c3a15ca6318ff7c1f47faaff))
* PR/Actionsのワークスペース単位ポーリングを共通ファクトリに一本化する ([215076a](https://github.com/kt0319/any-console/commit/215076a705f723cd0857ecd43cb844ac28319c1e))
* preview の subprocess 直呼びを run_subprocess_safe に統一 ([a7d7d07](https://github.com/kt0319/any-console/commit/a7d7d076552c93f5576ef0b9cb26c14387805e43))
* secret_hash 除去フィルタを devices.py の strip_secret_hash に共通化 ([89ea723](https://github.com/kt0319/any-console/commit/89ea723980cc76495765ea154fd23465fa0793f2))
* SendHistory / SendSnippet の重複を command-list.css と useEmbeddedPanel に集約 ([934c771](https://github.com/kt0319/any-console/commit/934c771ad1efd6cb0ee2d64867ba6c8987b0f4c7))
* Serverピルのアイコン色をCSS変数（--lime）に切り出す ([c09ba63](https://github.com/kt0319/any-console/commit/c09ba63a95d912d17d4032dfe561e505b84ba738))
* Server項目をDev Serverに改名しSettings配下へ移動する ([1527b8c](https://github.com/kt0319/any-console/commit/1527b8c6ee54ff775d637803c5f20a5c958cdac3))
* Sessionsサイドバーと設定画面のナビゲーションを整理する ([82729c5](https://github.com/kt0319/any-console/commit/82729c50bd20fcf86aeb3ab946aed9eb6b57f8bc))
* TerminalPaneのピルUIをInfoPillRow/PillPeekと専用composableに分割する ([86c983e](https://github.com/kt0319/any-console/commit/86c983ef84d6ad71b405b46e6ff753813d4379b0))
* WebSocket購読者へのfan-out送信を ws_broadcast に共通化 ([f4ad0d5](https://github.com/kt0319/any-console/commit/f4ad0d51f311f45831c00d8fc00f2ad5643f7936))
* WorkspaceDetailのペイン読み込み状態をusePaneLoaderに集約する ([b47641c](https://github.com/kt0319/any-console/commit/b47641ccf627e50da32843452460b93045fbbffb))
* worktree削除の二重実装を共通composableと確認文言ビルダに一本化する ([d4b8749](https://github.com/kt0319/any-console/commit/d4b874996892e098bb5f2178d5b1befc4c9fca6a))
* サーバ設定ストアの load/save 定型を createServerSettings に共通化 ([70e3413](https://github.com/kt0319/any-console/commit/70e3413909b768e120765e69a6652719721e597b))
* スレッド越しのループ呼び出しと bind ホスト変換を共通化 ([4e9c015](https://github.com/kt0319/any-console/commit/4e9c0151e69b2155e720c942c327e08a2b5e2eeb))
* セッションタブバーの「+」ボタンを削除する ([af00aab](https://github.com/kt0319/any-console/commit/af00aabd4ead26e70a186b7d772aab4dde06fe31))
* タブ・セッション行・ソフトキーボードの残る重複を整理 ([375fd9e](https://github.com/kt0319/any-console/commit/375fd9ef0c681381bb1b4873ce56bc17040b741e))
* パスのbasename/dirname処理をui/utils/path.jsに共通化する ([cbbc7c0](https://github.com/kt0319/any-console/commit/cbbc7c0f15bcad8eb0325111475fc067d8a319f3))
* バックグラウンド git fetch を git_utils.background_fetch に共通化 ([d292b0b](https://github.com/kt0319/any-console/commit/d292b0b4eef06f50640414b5fe73c423c188c008))
* フォーム要素判定とWS再接続バックオフ計算を共通化 ([6d96ba8](https://github.com/kt0319/any-console/commit/6d96ba8ac3b3192498b49502c8cab51e68f91ca8))
* モーダル・設定メニューの重複CSSをグローバルCSSへ集約 ([1a51807](https://github.com/kt0319/any-console/commit/1a51807b8f1fdfa800b24928e0a562cdee621d29))
* ワークスペース系URLの組み立てを endpoints.js に集約 ([db10ce5](https://github.com/kt0319/any-console/commit/db10ce5488bf8ab29b08a8610cdeb79ffa91b0e9))
* 削除・discardの確認文言をconfirmIrreversibleに統一する ([7906c7b](https://github.com/kt0319/any-console/commit/7906c7b607057ae609b3317e52d0ef88d9d1c6ef))
* 外部URLを開く処理を openExternal に統一 ([f2efc59](https://github.com/kt0319/any-console/commit/f2efc59f7e57c60153d684f0cd510cea5854360e))
* 常駐タスクの stale 判定と停止を common に共通化 ([1c8974b](https://github.com/kt0319/any-console/commit/1c8974b600d958f42fab4b5e9ec316209d5b2d51))
* 常駐タスクの起動/停止判定を task_stale / cancel_task_quietly に統一 ([24cb5ed](https://github.com/kt0319/any-console/commit/24cb5edd5ed9ddb4494de311096fed39aa3319fd))
* 廃止済みWorkspaceStatusBar向けの未使用派生値を削除しドキュメント乖離を修正する ([e746bbc](https://github.com/kt0319/any-console/commit/e746bbc3532748253f27170138397c0546516c1c))
* 散在していたUI数値定数を constants.js に集約 ([ad1547d](https://github.com/kt0319/any-console/commit/ad1547df717da0d660eb67b85e4cf160705ac156))
* 通知猶予秒数の解決を config.notification_grace_sec に一本化 ([645afda](https://github.com/kt0319/any-console/commit/645afda49c4d1f171cbb58e84b9ea33318d12467))
* 重複していたCSSアニメーション定義を base.css に集約 ([c00f455](https://github.com/kt0319/any-console/commit/c00f455d02d19c768d88cca0c610e587fb3ef260))


### Tests

* _branch_tracking_infoのフォーマット変更(objectname追加)にテストを追従させる ([0ad9292](https://github.com/kt0319/any-console/commit/0ad9292c53702047513e3914de88aa9e92f58f8a))
* 廃止済みUIを参照していたE2Eを現行導線に追随させる ([982bb39](https://github.com/kt0319/any-console/commit/982bb39afd53e679795247e73b4c0559a73f2999))
* 廃止済みセレクタを参照していたE2Eテストを修正する ([67a78ce](https://github.com/kt0319/any-console/commit/67a78ce1c7a3b5e1503746578492b3e2b8746b3e))

## [0.10.0](https://github.com/kt0319/any-console/compare/v0.9.0...v0.10.0) (2026-08-06)


### Features

* 「...」を右端固定トグルにして展開ボタン群を左向きに開くよう変更 ([8db50b1](https://github.com/kt0319/any-console/commit/8db50b1c46fb49387bebd5af6652769dc38ea862))
* Actions/branch peekのピル・タブ色調整をブラウン/push-pull色に揃える ([2520388](https://github.com/kt0319/any-console/commit/25203883b2cc84d9635113103c307f5a041a5150))
* Actionsピルはsuccessをpeekで知らせた後、そのrunを非表示にする ([bbc4e17](https://github.com/kt0319/any-console/commit/bbc4e17ed35ff461fda98d81124ad1fc58f80927))
* branchピルタップでHistoryタブを開くと同時にBranch一覧を展開する ([ef3d002](https://github.com/kt0319/any-console/commit/ef3d0021d56743dfafbac1c96a0785bd297d60d5))
* BranchピルとPull/Pushピルを1本の連結ピルに統合 ([2db1632](https://github.com/kt0319/any-console/commit/2db16328fff50022ca6043d1d15b085c4765fc9a))
* BranchピルにPush/Pull件数バッジを追加しActionsピルをポーリング対応 ([ad4bd28](https://github.com/kt0319/any-console/commit/ad4bd28a101c3c03ae555a52ef28333a94bfd39b))
* Branchモーダルでリポジトリのデフォルトブランチを表示する ([8e7875a](https://github.com/kt0319/any-console/commit/8e7875aec9f7654f0b818557bb6409c8970aa7c4))
* chevronの位置にPush/Pullボタンを配置し現在ブランチを一覧から完全に外す ([27f535a](https://github.com/kt0319/any-console/commit/27f535abcf4dfa0b84651c4b798ec2a508f5623f))
* defaultブランチ以外の強調表示・ピルの配色調整・peekアニメ廃止 ([d503961](https://github.com/kt0319/any-console/commit/d50396196ee44892adf2a0213e09eaaad35d7339))
* Dev Server Previewにワークスペース対応表示とステータスバーからのOpenボタンを追加 ([7b8c8e4](https://github.com/kt0319/any-console/commit/7b8c8e4aa74e3a06da2a56c0cc7bb746dbe743c1))
* Dev Serverのpeekテキストにポート番号を表示 ([8700ed7](https://github.com/kt0319/any-console/commit/8700ed7115d750d7a218e3fd59154d742588dbb2))
* Dev Serverのpeekピルアイコンにアクセント色を付ける ([3c3cc67](https://github.com/kt0319/any-console/commit/3c3cc673cf637ded92f228f86917cdf5ed058dfd))
* Dev Server停止時にDev Server Stopのpeekピルを表示 ([54a833d](https://github.com/kt0319/any-console/commit/54a833ddaa4af782b70da76710c32b0267d5d523))
* Dispatch Queueで承認/却下後も直近5件をRecently executedに残す ([990cf30](https://github.com/kt0319/any-console/commit/990cf302c5e10560f58e85a1eebc1cb50cd56c29))
* Dispatch Queueの実行済み履歴からRerunできるようにする ([0fa8204](https://github.com/kt0319/any-console/commit/0fa8204445f5dbbba29511cb425723a3399a5d1b))
* Dispatchピルを追加し1件なら詳細へ複数なら一覧へ遷移する ([43e988c](https://github.com/kt0319/any-console/commit/43e988cd9afe5be08d61be3d47394b7285ad5f27))
* Dispatch実行履歴をJSONへ永続化し保持件数を10件に増やす ([96b03a2](https://github.com/kt0319/any-console/commit/96b03a215df54b520342138f1f9001bb30809fd4))
* Dispatch実行画面のBranch selectで現在ブランチを先頭にソートする ([b519e43](https://github.com/kt0319/any-console/commit/b519e43b86e03f722d208bf245ab38f5c0366a01))
* Emptyスクリーンの Setup チェックリストを改良 ([fc9ff24](https://github.com/kt0319/any-console/commit/fc9ff24f38ad7f3412e91b4199ffc07ec829e014))
* FileBrowser の Loading / Error メッセージにアクセシビリティ属性を追加 ([abef811](https://github.com/kt0319/any-console/commit/abef81134ecf13ec5e6206bed3c2f8a5f5d2081a))
* FilesピルをGitワークスペースでも表示する ([6d48e16](https://github.com/kt0319/any-console/commit/6d48e16d12caa4433a4358d29c54bbd50b8c1952))
* GitHub PRピルを追加 ([eda25bf](https://github.com/kt0319/any-console/commit/eda25bf36b3d08b43f4ecf4a84eadbd87435aa53))
* Historyタブのbranchトグルとブランチ一覧をセレクトボックス風に統合する ([dbab5ef](https://github.com/kt0319/any-console/commit/dbab5efa5c0cd92a146fdd76cfe9656e17bc6b20))
* Historyタブのブランチ一覧をシェブロンで開閉する折り畳み表示にする ([cd4e13c](https://github.com/kt0319/any-console/commit/cd4e13c8c506225fbdba0e536855dedec3b8f91f))
* Historyピル/タブのアイコンをピンクにする ([c72add5](https://github.com/kt0319/any-console/commit/c72add57ddb0ec8dfb4f0ec337e3ca56a61feb81))
* HistoryピルとPeekラベルのアニメーション方向修正 ([71881f3](https://github.com/kt0319/any-console/commit/71881f33bf5d765ee7fcf7e98d95f26aba08a6f9))
* Historyピルのツールチップに直近コミットメッセージを表示 ([cdd8615](https://github.com/kt0319/any-console/commit/cdd86153f61aaadbb1e700e10b981ce9bfd3ec37))
* HistoryモーダルとBranchモーダルを統合する ([4f308e1](https://github.com/kt0319/any-console/commit/4f308e1199739c0902b0f576cfa0da9325ac8fd4))
* Info Pillsの画面位置(上/下)を設定画面から切り替え可能にする ([0883848](https://github.com/kt0319/any-console/commit/0883848b523794e1826a4ff128326eda7d9034e9))
* Info Pillsの表示位置設定・ドラッグ切替えを廃止しデバイスに応じて自動決定 ([8315986](https://github.com/kt0319/any-console/commit/8315986fae1740084753ff00c0fb3da9b8f86bf5))
* Info Pillsの表示順を設定画面から変更できるようにする ([172fe24](https://github.com/kt0319/any-console/commit/172fe24cc6660494dff5d517660461ef50a53b5a))
* Info Pills設定画面を追加し表示/非表示をチェックボックスで切替可能に ([84c93ac](https://github.com/kt0319/any-console/commit/84c93acfd999f627612bf6b32304ddae66938a01))
* Job作成でWorkspaceスコープを選んだ時、対象ワークスペースもプルダウンで選べるようにする ([aee17f7](https://github.com/kt0319/any-console/commit/aee17f75c239a84ee2598b6b67e7e26ef9fd1e7a))
* Job作成をCommon/Workspaceどちらか選べる1ページに統合する ([c1a5e93](https://github.com/kt0319/any-console/commit/c1a5e93a6428273b8a61610fed9406936d65c9b3))
* PCでピルをホバーするとラベルを動的に表示 ([476a0f9](https://github.com/kt0319/any-console/commit/476a0f9e4ac42566e422523c6295014824921f51))
* PCでピルをホバーすると背景をアクティブ色にする ([37a4164](https://github.com/kt0319/any-console/commit/37a4164d77f56f404bb7074405538f2f919662e1))
* PCで右クリック+ドラッグでもサークルキーパッドを開けるようにし、History/Filesピルの色を整える ([c8f5b0e](https://github.com/kt0319/any-console/commit/c8f5b0e8c297a0a3f37fff6b6bd5a54e3761006c))
* peekのbranchで矢印が消えた瞬間にPush Done/Pull Doneを表示 ([105f5f0](https://github.com/kt0319/any-console/commit/105f5f095cea5a691755476d74c353df43f824a6))
* peekピル・通常ピル・ワークスペースピル・閉じるボタンをフェードで切替える ([6fcfb48](https://github.com/kt0319/any-console/commit/6fcfb4898d1f47afe6a6f5423f0050dc7f85033f))
* peekピルのマーキー・幅拡張をHistory以外の全ラベルにも適用 ([d779474](https://github.com/kt0319/any-console/commit/d7794741514e5c9178dc5d614030b7e4e37acd26))
* peekピルをクリック/タップした時に対応する画面へ遷移する ([25bf516](https://github.com/kt0319/any-console/commit/25bf5162875677360724696c3de00084a2fda998))
* PR/Dev Serverピルのアイコンをアクティブ色にする ([f135add](https://github.com/kt0319/any-console/commit/f135add463bcbb86ddfc1b850dea28d6b8da0ea3))
* PRピルを専用アイコンに変更、GitHub Actionsピルを追加 ([ec7b0a3](https://github.com/kt0319/any-console/commit/ec7b0a359e09f6bfb4394e1d11d9e1c045083912))
* Pull/PushをBranchの右に配置、Historyのコミットメッセージpeek、PRピルをブランチ限定表示、Changesアイコンをアクティブ色に ([5384465](https://github.com/kt0319/any-console/commit/538446515f5557d209714137e152acd288d6b65a))
* WorkspaceStatusBarを一旦非表示にする ([aac719c](https://github.com/kt0319/any-console/commit/aac719c360ea1d992e0ea92e293538042e89c604))
* アクティブペインのワークスペースピルをタブバーと同じ地色にする ([0eb5935](https://github.com/kt0319/any-console/commit/0eb59356abd4b4217043007ea3726348f959484c))
* インフォピルが狭い時にワークスペース名を省略する ([74417e1](https://github.com/kt0319/any-console/commit/74417e132ff578fa67b8407fff17080764c83467))
* インフォピルにDev Serverボタンと常時ahead/behind表示を追加 ([9d1c3b3](https://github.com/kt0319/any-console/commit/9d1c3b3bf699f363c813a51c710a70deaf412657))
* インフォピルのボタン群をタップで開閉しスライドアニメーションさせる ([a9604dc](https://github.com/kt0319/any-console/commit/a9604dc46b54685430a1f2d627696e1cb533f6ed))
* インフォピルの可変ボタンにアニメーションを追加 ([b77b04c](https://github.com/kt0319/any-console/commit/b77b04cee2defface4969920e3991ad18edc6041))
* インフォピルをPC常時展開・畳み時に不透明度を下げる表示に変更 ([188a181](https://github.com/kt0319/any-console/commit/188a1812f0ba063653cd78623da4d65e58af7bc8))
* コミット詳細のReset --soft/--hardを1つのResetボタンに統合しmixedも選べるようにする ([47d1a18](https://github.com/kt0319/any-console/commit/47d1a188e6aeb8b80d751ba0285f263a90d7172b))
* ステータスバーのChangesボタンとNo git表示を整理 ([37c0a82](https://github.com/kt0319/any-console/commit/37c0a827853c50e78b69611882ae16f2280f464b))
* タブタイトルラベルにブランチ名を表示 ([a84d6e4](https://github.com/kt0319/any-console/commit/a84d6e47c02c755e3153772617faa630ff34bee0))
* タブタイトルラベルにブランチ名を表示 ([514a73f](https://github.com/kt0319/any-console/commit/514a73f2fcf49fdf5f6fcd50ddc3fc5a86013a26))
* タブ切替え時にワークスペース名をpeekピルで表示する ([619e3fe](https://github.com/kt0319/any-console/commit/619e3fe39ce1295819fd494b28949fbe022201ac))
* タブ通知/エージェント実行中アニメーションを全ピル共通にする ([4fce986](https://github.com/kt0319/any-console/commit/4fce986e529fcc4155c882bf0c6c5f4fd53f42e8))
* ピルのpeek表示をアイコン+マーキーの単独ピルに変更 ([ebe40aa](https://github.com/kt0319/any-console/commit/ebe40aab8c598377dbeb633edfac3066d087e5a2))
* ピルのホバーで実際の値をヒントに表示、ピル間の余白を調整 ([394798c](https://github.com/kt0319/any-console/commit/394798cf3aa6f780fde62c7250a1360675c9372e))
* ピルの開閉トグルをPC・モバイルで統一し、chevronで状態表示 ([799344b](https://github.com/kt0319/any-console/commit/799344bf37eb0dedd6a9789cb2041fbf58c51045))
* ピルの開閉トグルを廃止し、常にアイコン表示+変化時だけラベルをpeek表示 ([34908c5](https://github.com/kt0319/any-console/commit/34908c58e0511fd3e626692926fded809d8b74aa))
* ピルの開閉時に横スライドアニメーションを追加 ([0834b4e](https://github.com/kt0319/any-console/commit/0834b4ea17e11d9699046da1a778ec7f6920ede2))
* ファイル/コミット詳細のアイコンボタンにラベルを追加しモバイル対応を整理 ([24ea21a](https://github.com/kt0319/any-console/commit/24ea21a192e494e960a3d1101936823ac6f97148))
* フォルダのダウンロード（zip化）に対応する ([d5179d2](https://github.com/kt0319/any-console/commit/d5179d22e2c89484b0be02359c413b32afe89f11))
* フォルダのドラッグ&ドロップアップロードに対応する ([a600d1e](https://github.com/kt0319/any-console/commit/a600d1e3a14ebcc49420a404f830646a8b193988))
* ブランチセレクトの左にAdd・右にFetchボタンを配置し一覧下のフッター行を削除 ([d10ebfe](https://github.com/kt0319/any-console/commit/d10ebfec78c986b8f98826bd297c0e7c696e371f))
* ブランチ一覧フッターにCloseボタンを追加し折り畳みを閉じられるようにする ([014c37b](https://github.com/kt0319/any-console/commit/014c37b86a56a3b1290aacbfebbad896f95bc9e4))
* ペイン選択画面のAdd paneの左にAdd workspaceボタンを追加 ([6aeffbe](https://github.com/kt0319/any-console/commit/6aeffbef3b6d494e5fa4537d05bd99b8c7b1848b))
* モバイルでピル展開時にワークスペース名ラベルを非表示にする ([f60cebb](https://github.com/kt0319/any-console/commit/f60cebb4fa45ca00ae8602c7f1c4240a15729760))
* モバイルのタブドラッグをアクティブタブのみ・長押し無しにする ([852cf91](https://github.com/kt0319/any-console/commit/852cf91272e2b4cb50752a3734deda8f3549b421))
* ワークスペースピルと開閉「...」ピルを統合 ([7b8b8a6](https://github.com/kt0319/any-console/commit/7b8b8a6c407545545a998cb65c4ea6569164c757))
* ワークスペースピルのドラッグをピル群の上下位置切替えに変更 ([b187d25](https://github.com/kt0319/any-console/commit/b187d25ff709787d838ffbf88677b3b449afa03e))
* ワークスペースピルは展開時にだけワークスペース名を表示 ([38386e9](https://github.com/kt0319/any-console/commit/38386e9eee2409d02fd4c763b1358f0157f526fd))
* ワークスペースピルをFilesピルに統合しInfo Pills設定でトグル可能にする ([2e154c5](https://github.com/kt0319/any-console/commit/2e154c5a8da39199c981597971098b40c8712c81))
* ワークスペース一覧でJobsをインライン展開できるようにする ([9003798](https://github.com/kt0319/any-console/commit/90037980cf84d5ec4cc761a95a1e43b5311bcef7))
* ワークスペース一覧にEditモードを追加し編集系操作を分離する ([ed85b92](https://github.com/kt0319/any-console/commit/ed85b9232300b7ae2626103a0cd4f3ddd1efb2c6))
* 分割の空きペインで候補タブが1つだけの時は自動的に選んで開く ([6ab80fb](https://github.com/kt0319/any-console/commit/6ab80fbe6659e2017e9d4552d066f35f50eb5335))
* 情報ピルにブランチボタンを追加 ([73d25a8](https://github.com/kt0319/any-console/commit/73d25a8e167b7757282642d63862acaa3ab7b0ed))
* 現在ブランチトグルをチップ風にしコミットファイル一覧表示中はBranchヘッダーを隠す ([8098c31](https://github.com/kt0319/any-console/commit/8098c3125031ea92614a802fa6ce4c8c6ac59b2d))
* 現在ブランチの横にAddボタンを追加しFetchボタンをブランチ一覧の下へ移動 ([b8f6357](https://github.com/kt0319/any-console/commit/b8f63575d0296f067bda5f9a73d930e730510125))
* 現在ブランチを一覧から外しPush/Pullボタンを一覧の一番上に固定表示する ([94631d1](https://github.com/kt0319/any-console/commit/94631d18487299186866733aa2eb3835d6d17777))
* 畳んだ「...」ピルが更新内容を数秒だけプレビュー表示するように ([6c7651f](https://github.com/kt0319/any-console/commit/6c7651fb93226829538e28e942cc518b205bd5f5))
* 設定一覧にNotificationsのOn/OffとTabs & Sessionsのセッション数を表示 ([3ccc09f](https://github.com/kt0319/any-console/commit/3ccc09ffbb1ecebea30b6049e2f847c70c7dddde))
* 開閉トグルと閉じるボタンの間に余白、展開中はトグルをアクティブ色に ([4416dc2](https://github.com/kt0319/any-console/commit/4416dc2afc57519cd9270278298bb2601c0530da))
* 開閉トグルをワークスペースピルから分離した専用ピルに ([1d5b148](https://github.com/kt0319/any-console/commit/1d5b148153a1f00bf95b51883e067b3cc8216c97))


### Bug Fixes

* --purpleを濃くする（PRアイコン等） ([253e012](https://github.com/kt0319/any-console/commit/253e0127936f6e8dc89e84837267130aa43eebb0))
* Actions peekピルのアイコンをActionsタブと同じ固定アイコンに揃える ([9d9bfb8](https://github.com/kt0319/any-console/commit/9d9bfb87dd3a6b891a10a417528578897c381036))
* Actionsピルをfailure以外の完了runでは非表示にする ([222bacf](https://github.com/kt0319/any-console/commit/222bacffbf0af56caa559d089f9a88c1c041d6ea))
* actionsピル出現時にワークスペースピル・閉じるボタンが画面外に出るのを修正 ([c6654fa](https://github.com/kt0319/any-console/commit/c6654fa82a02ceb45c1cc434059d6aae9bd0102d))
* Actions成功時もpeekで一度知らせ、ピルの共通CSSをまとめる ([c1aaad6](https://github.com/kt0319/any-console/commit/c1aaad6d0f02e785f6ce71a2c0bc36d60ccfc5ea))
* Addボタンのラベルをターミナルのcd後も追随させる ([12da1cf](https://github.com/kt0319/any-console/commit/12da1cfa91675e88a8fb36fcc12429befbefb0a5))
* Addボタンのラベルをマウント時点で最新化 ([9e8ec05](https://github.com/kt0319/any-console/commit/9e8ec05c61413a3a196fa7da88838eaf1f6fb273))
* Addボタンをブランチ一覧下のフッターへ移動しBranch一覧は常に畳んだ状態で開始する ([bd9de09](https://github.com/kt0319/any-console/commit/bd9de0966c8266842ebcef030341de824fd13b60))
* BranchesのLOCAL/REMOTEカテゴリ名見出しを削除する ([2b5091d](https://github.com/kt0319/any-console/commit/2b5091d8994a143708f4e20a8769a15e5fe40b3a))
* Branchピルを常に緑、Files/Addをaccent色に変更 ([9cf5829](https://github.com/kt0319/any-console/commit/9cf58290edfa1c27db11ab164cf8426393b44657))
* Branch折り畳みヘッダーのchevronを右端に移動し未フェッチ時のヒント文言を削除 ([aac1f42](https://github.com/kt0319/any-console/commit/aac1f429f053419e57f95f74af3a706c47960d25))
* Changesピルアイコンの色をダーティドットと同じオレンジ系黄色に変更 ([2064e89](https://github.com/kt0319/any-console/commit/2064e89c4bb58f4d2c6ff5e3f11deed0dff93961))
* Codexレビュー指摘を反映（peek不具合・PRポーリング・a11y等） ([1ddc510](https://github.com/kt0319/any-console/commit/1ddc510c61039033a79d5f87d38781ae49558e79))
* Codexレビュー指摘を反映（ポーリング鮮度・障害時キャッシュ・a11y等） ([f8a37d8](https://github.com/kt0319/any-console/commit/f8a37d81d3585e6a9bdc6425de55d69b64e40307))
* defaultブランチ以外の強調色を緑にする ([8bef59e](https://github.com/kt0319/any-console/commit/8bef59e98fb6dc3e7018942716f85b797a6a109f))
* Dev Server Previewの"this console"ラベルを右寄せにする ([2ab8703](https://github.com/kt0319/any-console/commit/2ab8703ab2b9b0fa25bd0e198379430b016775d9))
* Dev Server停止から一覧に反映されるまでの待ち時間を短縮する ([4d4e2c6](https://github.com/kt0319/any-console/commit/4d4e2c642eb63df92dcfe4e65975c8fbca492aa4))
* dispatch_recent.jsonを.gitignoreに追加 ([c450799](https://github.com/kt0319/any-console/commit/c4507990b122af115a5c66e860bfcf2a354a3623))
* FileBrowserのLoading/Errorメッセージにrole属性を追加 ([7688d3d](https://github.com/kt0319/any-console/commit/7688d3d90bd316c3a4fcea610243032fcdb14df6))
* FileBrowserのライブリージョンを常時マウントするよう修正 ([d6342dc](https://github.com/kt0319/any-console/commit/d6342dcc8340a1a2835ea91ed587c4c5f27bab3f))
* Files/Add・default時のBranchピルアイコンを非アクティブ色から専用色に変更 ([5724943](https://github.com/kt0319/any-console/commit/5724943509f71eb626ef95ff411e6e84d337e5bc))
* GitActionBtnをキーボード到達可能にし、ピルの展開ボタン群を横スクロール対応に ([1a26b2f](https://github.com/kt0319/any-console/commit/1a26b2f1e188f6215d42dc8ccbee9e94e9ab8e5f))
* GitHub Actionsピルはsuccess時に表示しない ([559a079](https://github.com/kt0319/any-console/commit/559a07961edef036c5a07a1e29aca069a3a2571c))
* Gitアクションボタンのupstream専用アイコンを廃止しPushに統合 ([adcf57c](https://github.com/kt0319/any-console/commit/adcf57cc4b06486e7ce3732847226e2a5cc5aeed))
* Git操作の実行中ロックをワークスペース単位に変更 ([3a0d918](https://github.com/kt0319/any-console/commit/3a0d918f4a28613b8195466e939050f7685f3de2))
* Git操作の実行中ロックをワークスペース名でなく物理リポジトリ単位に変更 ([2ed81d1](https://github.com/kt0319/any-console/commit/2ed81d11df3c38aeeae9c35a43f113c622ce7089))
* Git操作の実行中状態を分割ペイン間で共有 ([bf95e65](https://github.com/kt0319/any-console/commit/bf95e6579da526b6cd8b4af9789f76649018f757))
* Historyタブ再訪時にコミットファイル一覧表示状態を実際の状態へ同期する ([baeafdc](https://github.com/kt0319/any-console/commit/baeafdc4a44c75f3975cd41ef7752a148d724676))
* Historyのpeekテキストをアイコンだけピンクにしコミットメッセージは白に戻す ([7d89599](https://github.com/kt0319/any-console/commit/7d89599655ec5c143af33b9a6f0aa3f76771661b))
* Historyマーキーを1回きり・収まる時は動かさない仕様に、changesの区切りにスペースを追加 ([f04fe33](https://github.com/kt0319/any-console/commit/f04fe3383244934908612477ec2093fca6728630))
* Jobの編集ボタンをEditモード中のみ表示する ([3d51eff](https://github.com/kt0319/any-console/commit/3d51effe63ac2583173fe4033f7801a4e83851e3))
* PCホバーでのラベル動的展開を廃止 ([2dc48c9](https://github.com/kt0319/any-console/commit/2dc48c9e2c27fc971f301fc368a894fce7526f67))
* peekキューの合計表示時間を4秒に収める ([664c1ac](https://github.com/kt0319/any-console/commit/664c1acfbbc76a239426d4f9f6f862012cab6ab1))
* peekのbranch/actionsテキストをアイコンだけの色分けにし、actions名を[名前]表記に変更 ([182b7b5](https://github.com/kt0319/any-console/commit/182b7b552bdcbac3f6b298ed7df945b7d95699ec))
* peekのBranchピルと詳細モーダルのタブアイコン色をピルの配色に合わせる ([ee2fde2](https://github.com/kt0319/any-console/commit/ee2fde28993a40fef4fbc8642184360b4192bb7d))
* peekピルが複数同時に変化した時は上書きせずキューで順番に表示する ([93f83cc](https://github.com/kt0319/any-console/commit/93f83cc6654f96a18d66393e604df5275ab001d5))
* peekピルと通常表示一式をまとめて1ブロックとしてフェードさせる ([91a6b27](https://github.com/kt0319/any-console/commit/91a6b2740456e534ecc7688c62c499cdf567aa27))
* peekピルにmin-width:0を指定し長いHistoryメッセージでの範囲外はみ出しを修正 ([18e45eb](https://github.com/kt0319/any-console/commit/18e45eb08501d4bfadd3a9097d2ffe4523e70abc))
* peekピルのマーキー判定がTransition挿入待ちより早く走り動かないことがある不具合を修正 ([b4b557c](https://github.com/kt0319/any-console/commit/b4b557cd55d460b57bec1ce4f140d6be49a5ef13))
* peekピルの表示時間を3秒から4秒に延長 ([e035c9d](https://github.com/kt0319/any-console/commit/e035c9d67ba4cc0f07dc919745b0c304cf4dc6a3))
* peekピルの表示時間を4秒から5秒に延長 ([c1c6cf7](https://github.com/kt0319/any-console/commit/c1c6cf70af0ccdb6b110d07f66efec54b16fba4d))
* peekピルの表示時間を5秒から4秒に戻す ([96fb4b7](https://github.com/kt0319/any-console/commit/96fb4b7c4171a855f93a9259b7f1b5963ef85f6a))
* peekピルを常時trailingMaxWidthまで広げず内容に合わせた幅にする ([0072e92](https://github.com/kt0319/any-console/commit/0072e925515141cc93a5d5ef9fd3e32bf5f06d9a))
* peekピル終了時に通常ピル一式が即時表示されるようTransitionを廃止 ([5ca26da](https://github.com/kt0319/any-console/commit/5ca26dad9aa4f761c6a378a4bdc559417af9b510))
* peek表示で他のピルまで一緒にスライドしてしまう不具合を修正 ([ad2beff](https://github.com/kt0319/any-console/commit/ad2beffbc0111aaf31d43f4049b3d3081ad9ce34))
* peek表示のラベルアニメーションが無くなっていたのを復活 ([da3aa44](https://github.com/kt0319/any-console/commit/da3aa44a8aa62a71629ac8349237ca88642638f6))
* peek表示を実ボタンと完全に同じ構造にする（不要なラベル文字列を削除） ([2ad1ad3](https://github.com/kt0319/any-console/commit/2ad1ad358603a5a31d6fe88f84d2e153eb0a5136))
* peek表示中はワークスペースピル・閉じるボタンも非表示にする ([d34fd76](https://github.com/kt0319/any-console/commit/d34fd76a86520a23e9473411f05ebba5c2ff282f))
* PRレビュー指摘を反映しPushボタンとベアターミナル操作を復元、Dev Serverポーリングを集約 ([6efa3be](https://github.com/kt0319/any-console/commit/6efa3bef53fa1d204ce588d4d78b63bae8340e10))
* Recent Jobsの動的worktree判定漏れとGET時の更新競合を修正 ([12a1e86](https://github.com/kt0319/any-console/commit/12a1e86f4b35ed6eea862559375eafecce473cb1))
* RenameとMove統合に合わせてe2eテストを更新しCI失敗を修正 ([ea4eea7](https://github.com/kt0319/any-console/commit/ea4eea7a460edfb135f479d9ba24508f308f5f5d))
* Server/Files/Addピルのアイコンが他より明るく見える不具合を修正 ([e91acfe](https://github.com/kt0319/any-console/commit/e91acfe18bc861262507f58f0d6c9fed5a2632af))
* Setup見出しトグルのフォントサイズが他の見出しと揃わない不具合を修正 ([1210984](https://github.com/kt0319/any-console/commit/12109849069695832f9ef8bfc4ec60c29a7bdc4e))
* tabオブジェクトの差し替えでソケット/入力バインドが分裂する不具合を修正 ([80eae00](https://github.com/kt0319/any-console/commit/80eae007b16e893415df95b20a661943239458d5))
* upstream未設定ブランチのPushボタンに未push件数が出ない不具合を修正 ([54ba160](https://github.com/kt0319/any-console/commit/54ba160fbe271c735059a1887dbcdc33d4a7e444))
* WorkspaceDetailのPR/Actionsタブアイコンをピルと揃える ([aacf5d2](https://github.com/kt0319/any-console/commit/aacf5d26f180bcc691ad3de266c0df6f5ea08374))
* worktreeBranchLabelの縦線プレフィックスを単独表示箇所から除去 ([e7ff73d](https://github.com/kt0319/any-console/commit/e7ff73daf50e265b0c953cb12bf9273db6edbb9d))
* アクティブタブの判別をワークスペースピルの背景色から枠線色に変更 ([1bd303b](https://github.com/kt0319/any-console/commit/1bd303b391f4bd64350d0f78b58e7af6cc5ea721))
* アクティブなワークスペースピルの色味を少し抑える ([f0e8c94](https://github.com/kt0319/any-console/commit/f0e8c946d75861fb3ca448afda50e60672246568))
* アクティブペインの見せ方を背景色一本化、ホバー展開のアニメーションを廃止 ([22b882a](https://github.com/kt0319/any-console/commit/22b882ad23f5de3fed0ef9cb9f6611a44cb3ee4c))
* アクティブ枠線をもう少し明るくする ([3c61950](https://github.com/kt0319/any-console/commit/3c619508cd03889f654212518b389cb7e9e6f1be))
* インフォピルのスライドアニメーションと位置を調整 ([025390e](https://github.com/kt0319/any-console/commit/025390e4ced449831de3516f725449225512e364))
* インフォピルのポップアニメーションを横方向の伸縮に変更 ([a136d87](https://github.com/kt0319/any-console/commit/a136d87eed7e5f82866e4172c3246e98cc10dd7b))
* コミットファイル一覧から戻った後ブランチ一覧が空になる不具合を修正 ([3c7d364](https://github.com/kt0319/any-console/commit/3c7d3641a50ac3fd4c975fe3ed05342371ed5513))
* コミット詳細のMerge/Rebaseボタンで長いブランチ名を省略表示にする ([db0ed21](https://github.com/kt0319/any-console/commit/db0ed2112c357757cd2469fd07cefb366612f205))
* サークルキーパッドのEnterキーのラベルを記号(↵)からEnter表記に変更 ([929ed5d](https://github.com/kt0319/any-console/commit/929ed5d362306c3b41e5057edd2c96a27cf7baaf))
* ジョブアイコンが同期ポーリングの一時的な揺らぎでmdi-playに戻る不具合を修正 ([96e9fb2](https://github.com/kt0319/any-console/commit/96e9fb27687f3688af2d02068a8b1fdf1018022e))
* ジョブアイコンが特定ワークスペースだけmdi-playに固定される不具合を修正 ([388a84f](https://github.com/kt0319/any-console/commit/388a84fb76c021a38c8ec316dd798114bc2d8f33))
* ジョブアイコンのキャッシュ判定をアイコン文字列でなく解決成否で行う ([c96e4b0](https://github.com/kt0319/any-console/commit/c96e4b0df58dcfd8b910e3725baaabf7a58d6a12))
* ジョブアイコンの解決済みキャッシュを全てのタブアタッチ経路で共有 ([0e548d5](https://github.com/kt0319/any-console/commit/0e548d558f1444e703875e24761120369a2243a0))
* セッションタブ本体のタップ/クリックでの閉じるを廃止しXボタン経由に一本化 ([aa6457c](https://github.com/kt0319/any-console/commit/aa6457c25dc65fab8ec5770d425e7bced6a7fdf5))
* ターミナルの長押しURL検出が改行境界で途中切れする不具合を修正 ([29ca1d7](https://github.com/kt0319/any-console/commit/29ca1d762529c8b446d5ddcf65d0892ffdf7b1ba))
* タブ/分割ペイン/ブランチ選択のアクティブ表現とタブアイコン色を整える ([be8fd03](https://github.com/kt0319/any-console/commit/be8fd03c76d4c54bfca169b9dd9bd67422bc7daa))
* タブタイトルのブランチ・ジョブ区切りを縦線に変更 ([8d35f1e](https://github.com/kt0319/any-console/commit/8d35f1e3a1a31f1d093a0184d17c02b3e1d5e703))
* タブタイトルのブランチ・ジョブ区切りを縦線に変更 ([4ccc80d](https://github.com/kt0319/any-console/commit/4ccc80da424ba75b5f848a10720e61acf2422886))
* ツールチップのマーキー表示をやめellipsisでの省略表示に戻す ([536835a](https://github.com/kt0319/any-console/commit/536835af580e184a3811fba65ea2dc284839c90b))
* ツールチップの最大幅を制限し長いテキストはマーキーで末尾まで表示 ([938cd28](https://github.com/kt0319/any-console/commit/938cd28299fcc025090f70510f2dfe90a79550a1))
* ピルpeekの切替を左右フェードにし、History表示は最大幅+マーキーに変更 ([4733df9](https://github.com/kt0319/any-console/commit/4733df9fcf1212bb322170a554a5de21066a1505))
* ピルpeek表示のテキストマーキーをやめてピル自体のスライドインに変更 ([f8d7c8c](https://github.com/kt0319/any-console/commit/f8d7c8cd3babb0f5da0da410ae2be9d86fe3fc78))
* ピルpeek表示を通常ピル位置固定・上下フェード切替・多色表示に変更 ([50d262f](https://github.com/kt0319/any-console/commit/50d262fb1d91d308196c16302862e103cfe417f2))
* ピルサイズ拡大・×アイコンをmdi化・ワークスペースピルを右端に移動 ([6f78367](https://github.com/kt0319/any-console/commit/6f783672fb21b07db535dc563e82887990752dbd))
* ピルの並び順をChanges・Pull/Push・Branchesの順に変更 ([87b0687](https://github.com/kt0319/any-console/commit/87b0687c7b7ee7e66ba13c7f1a5c90d5a347242e))
* ピルの枠線を少し明るくする ([a12ac52](https://github.com/kt0319/any-console/commit/a12ac524392782871114a256c610b696a5dcf0d6))
* ピルの枠線色をアクティブ/非アクティブで変えず統一する ([3323da9](https://github.com/kt0319/any-console/commit/3323da9116edd61100522855038b8690a41ca57f))
* ピルの枠線色をアクティブ/非アクティブで統一しシャドウで区別する ([97d762a](https://github.com/kt0319/any-console/commit/97d762aba6913cfe21b992ab746a557a4ae2fc40))
* ピル位置スライドをボタンの出現/消失と同じく瞬時にしてズレを解消 ([d41af42](https://github.com/kt0319/any-console/commit/d41af42f1fbb0b3725871ea5fd85f0ce0a8af0c5))
* ピル開閉時に×ボタンを固定端にしたまま左向きに滑らかに開閉するよう修正 ([c907cfd](https://github.com/kt0319/any-console/commit/c907cfd48ad7a4fac02cb023ad1b4d316f796c09))
* ブランチセレクトのchevron付近をクリックしても展開/折りたたみできない不具合を修正 ([278d41b](https://github.com/kt0319/any-console/commit/278d41bf709a86f34f9fcf34313555b53068a032))
* ブランチ一覧のdefaultバッジを控えめな見た目にする ([80646b1](https://github.com/kt0319/any-console/commit/80646b1f562e971bac3880b0d7e6c87865aeb5f0))
* ブランチ一覧フッターのCloseボタンを削除する ([e7a3fed](https://github.com/kt0319/any-console/commit/e7a3fedf997de0c3628ba27fa2b87361de278ec5))
* ブランチ切替え時にHistoryでなくBranchのpeekピルを優先表示する ([5c325da](https://github.com/kt0319/any-console/commit/5c325da3b399d3e2fc22aa607c584eb18cdb7b90))
* プレビューポート取得の同時リクエストを1本にまとめる ([33d2050](https://github.com/kt0319/any-console/commit/33d20508e099083afa36e12002e31068f2090597))
* ベアターミナルのDev Server誤検出とピル横スクロール阻害を修正 ([9352398](https://github.com/kt0319/any-console/commit/93523984672832fbb07d24841e47350615bf7175))
* ペイン選択画面のボタンをAdd workspaceからOpen workspaceに変更 ([457960b](https://github.com/kt0319/any-console/commit/457960b1f593c3d908c053be249e2d360e5b11b0))
* モバイルでエディタで開くボタンを押した時にトーストで非対応を明示する ([d6e1a13](https://github.com/kt0319/any-console/commit/d6e1a139284074ab8ccc5faeaca1f561f010a414))
* モバイルのタップで合成mouseoverによりツールチップが一瞬表示される不具合を修正 ([2330c9b](https://github.com/kt0319/any-console/commit/2330c9b52a2ac0901f69e5560de109d3219a8d9a))
* モバイルの画面回転でブランチピルが誤って反応する不具合を修正 ([f862a80](https://github.com/kt0319/any-console/commit/f862a80648d4c34491caf1fceac0e6e1fd907c66))
* レビュー指摘2件を対応（Addボタンのラベル誤り・不要なプレビューポーリング） ([1268fd1](https://github.com/kt0319/any-console/commit/1268fd195b779086c7caeb3f5042f9d012cc80b6))
* レビュー指摘3件を対応（CWD Files復元・分割ペイン幅対応・初回peek誤検知） ([4b3e0b1](https://github.com/kt0319/any-console/commit/4b3e0b1f36c18909ba737b204189dab5f427e04c))
* ワークスペースピルのchevronを上下から左右アイコンに変更 ([cdb22c7](https://github.com/kt0319/any-console/commit/cdb22c73cac51c9d841c974825e4fa6c3035aa01))
* ワークスペースピルのchevron左右を逆にする ([5beefa2](https://github.com/kt0319/any-console/commit/5beefa226c8819da87cf96f75c8532e94e7447f4))
* ワークスペースピルのアクティブ枠線を明るいグレー、非アクティブを暗めに変更 ([8787f3e](https://github.com/kt0319/any-console/commit/8787f3ee125151f0f48f8e630f1f8e9b9c72d2bb))
* ワークスペースピルのタップでFilesペインを開くようにする ([5f2c195](https://github.com/kt0319/any-console/commit/5f2c195e407564f5f5382689eb363b062fa2bf11))
* ワークスペースピルのタップで開くペインをJobsに戻す ([a533bc6](https://github.com/kt0319/any-console/commit/a533bc644ab86a9f859553cd78dfd1082864d04c))
* ワークスペースピルの開閉アイコンを90度回転した向き(unfold-more/less)に変更 ([ecdbd34](https://github.com/kt0319/any-console/commit/ecdbd34b503314d4085607fb4ef18f504a8c464e))
* ワークスペースピルの開閉アイコンをunfold-horizontalに変更 ([1d5e7cf](https://github.com/kt0319/any-console/commit/1d5e7cfb663ad0f2d1f493f62bc8cc0952c7ea81))
* ワークスペースピルをキーボードで操作可能にする ([7241602](https://github.com/kt0319/any-console/commit/7241602cd7cd6d62a7e73d57983d595e73936d7e))
* ワークスペースピルをホバーしてもラベルが表示されない不具合を修正 ([6efbbd7](https://github.com/kt0319/any-console/commit/6efbbd7271bd112fcbdea35f357978c56497934c))
* ワークスペースピル畳み時に他ボタンの退場後に開閉ピルを表示する ([6f4a24c](https://github.com/kt0319/any-console/commit/6f4a24cf0e54e60fbcbc0102bec060ee7e223092))
* ワークスペース一覧のJobs展開を排他的にし、ツールバーの表示条件を調整 ([7f5cfcd](https://github.com/kt0319/any-console/commit/7f5cfcdcfc1ea123b1963afa47cb1dd222bdf7bb))
* ワークスペース一覧のシェブロンを行の右端に、Edit中はpush/pull numstatを隠す ([4a6b703](https://github.com/kt0319/any-console/commit/4a6b703362b2f751b7e23c026422926631de4cb1))
* ワークスペース一覧の細かい調整（枠削除・Add workspaceのEdit限定・区切り文字） ([18640ac](https://github.com/kt0319/any-console/commit/18640ac66ab45db784eced28822bb87e3b811e08))
* ワークスペース紐付け後にTerminalPaneが即座に更新されない不具合を修正 ([593c9ba](https://github.com/kt0319/any-console/commit/593c9ba37e6c23c4a882f8742abcdf58e97c7e6b))
* ワークスペース紐付け直後にタブ名・タイトルへ反映されない不具合を修正 ([af43e44](https://github.com/kt0319/any-console/commit/af43e447d3159b72c12e6ee026e6967cce366885))
* ワークスペース詳細タブの並び替えとPRアイコンの色を修正 ([58a88b5](https://github.com/kt0319/any-console/commit/58a88b55689a78d4174cc10f81453d733ea4343b))
* 分割ペインの枠線を通常・アクティブとも少し暗めにする ([afc4bea](https://github.com/kt0319/any-console/commit/afc4beabc3af90141b9cc0720cc64241cd4d5ca8))
* 分割中は非アクティブペインでのスワイプでサークルキーパッドを開かないようにする ([44f5a98](https://github.com/kt0319/any-console/commit/44f5a982ed15b0285a5528ed52cf4186c72eeb1a))
* 分割時のペイン枠線でアクティブペインを判別できるようにする ([5fa0313](https://github.com/kt0319/any-console/commit/5fa0313421d89c0f3483d4e4ad59c98f3e437f9a))
* 削除済みジョブを参照するRecent Jobsのアイコンがplay固定になる不具合を修正 ([841d7ad](https://github.com/kt0319/any-console/commit/841d7adf4be61d41ebf1c1877c1ab0ff5b4c1fc4))
* 削除済みジョブを参照するRecent Jobsのアイコンがplay固定になる不具合を修正 ([4ab5bc2](https://github.com/kt0319/any-console/commit/4ab5bc2864ec4157f797475d9d5473c2ffa433be))
* 存在しないアイコンクラス指定でchevronが表示されない不具合を修正 ([ecd806b](https://github.com/kt0319/any-console/commit/ecd806b3186d39beba2f36aef675f952bb654999))
* 展開ボタン群・peekピルもワークスペースピルと同じアクティブ/非アクティブ枠線にする ([df5f6bc](https://github.com/kt0319/any-console/commit/df5f6bcd1ab26673a14118d598ec43ba80e43fea))
* 情報ピル畳み時の点線ボーダーを廃止し常に実線にする ([6a1076a](https://github.com/kt0319/any-console/commit/6a1076aeaf4ae14652d938154a8486f9d12adaf3))
* 日本語IME変換中でもキーボードバーの送信ボタンで送信できるように修正 ([72ef466](https://github.com/kt0319/any-console/commit/72ef466ac512acbbe4305f7a78484b287cf777f7))
* 現在ブランチ行の背景色をやめる ([7ab4b3f](https://github.com/kt0319/any-console/commit/7ab4b3f83a37c90b98d10d87bd25eda8c15a52ed))
* 画像貼り付けがxterm自身のpasteリスナーにも伝播し二重処理される不具合を修正 ([8a522bf](https://github.com/kt0319/any-console/commit/8a522bf972e2acbf41a566ef9c2c16d4c63b886e))
* 画像貼り付けが二重にアップロードされる不具合を短時間ロックで防止 ([d7e4804](https://github.com/kt0319/any-console/commit/d7e4804fb07a59e766fd50eefced6d3a1d9babec))
* 空きペインの自動選択を生成時点の判定に変更しマイナスボタンでの復帰を可能にする ([0081704](https://github.com/kt0319/any-console/commit/00817044ea1e9aa0fd2313c553b66c569b2b2c44))
* 設定メニューのDev Server Previewアイコンをピルと同じmdi-serverに統一 ([8075008](https://github.com/kt0319/any-console/commit/80750084dfa486abdf2c41bcf4d02bd71d89ebde))
* 設定メニューのInfo Pillsの並び順をTerminalの直後に変更 ([174dab9](https://github.com/kt0319/any-console/commit/174dab92204f150767f8ad58f65499f0be4779bd))
* 詳細モーダルのChangesタブアイコンを常時色付けに変更 ([7c83b46](https://github.com/kt0319/any-console/commit/7c83b463bf233d4cc8b6280385564dfab8dfb834))
* 通常ピル⇔peekピルの切替えアニメーションを左右スライドからクロスフェードに変更 ([395884e](https://github.com/kt0319/any-console/commit/395884e7690b3ebd6c8bd1abd7538761f3ac7e31))
* 閉じるボタンの位置ズレ・見切れをJS計算の廃止で根本的に解消 ([74c07b7](https://github.com/kt0319/any-console/commit/74c07b74da3890487e4316011f1c052dc710f5b8))
* 閉じるボタンをtransitionタイミングに依存しないposition:absolute固定に変更 ([71103ee](https://github.com/kt0319/any-console/commit/71103ee59c9905264698e6104267be679ad1db3d))
* 開閉トグルを閉じるボタンと隣接する固定クラスタに移動 ([24aeb40](https://github.com/kt0319/any-console/commit/24aeb404bc50707ee3c50829c3e18df97dc9e49b))
* 開閉トグルを開いた時にピルの背景が透明に見える不具合を修正 ([3024b28](https://github.com/kt0319/any-console/commit/3024b286ccea1a8829bd989641442750014802ba))
* 開閉トグル展開時の配色を背景色ではなくアイコン色のみに変更 ([ce3791a](https://github.com/kt0319/any-console/commit/ce3791ae03a20f71a96e58bb53519926480432c2))
* 非Gitディレクトリをワークスペース追加してもAddピルが消えない不具合を修正 ([3fa627c](https://github.com/kt0319/any-console/commit/3fa627c30a23527a839ba080e5f9846f5d8fb8db))
* 非GitワークスペースでGit系ボタンが残る不具合を修正、peek配色を実ボタンに揃える ([19be36c](https://github.com/kt0319/any-console/commit/19be36c3d7df5357ef28f89870f3e4c0a3110b84))
* 非GitワークスペースのターミナルでもAdd workspaceボタンを表示する ([ca7104b](https://github.com/kt0319/any-console/commit/ca7104b80d1749843ba1ba41a600c590076c7a5b))
* 非アクティブピルのopacityを0.55から0.7に上げ見えやすくする ([855b05d](https://github.com/kt0319/any-console/commit/855b05d56a04ea0e8ba54b8a9e5f8405b8332bbc))
* 非アクティブペインでのサークルキーパッド操作はそのペインをアクティブにする ([b47712a](https://github.com/kt0319/any-console/commit/b47712a0a49fbb0288a548f6643a169e54fbb6f6))
* 非アクティブペインのピルをbox-shadowでなくopacityで暗くする ([778c831](https://github.com/kt0319/any-console/commit/778c831d1ee47621e1dc32ec647c08bde4d1bb4d))


### Performance Improvements

* セッション同期ポーリングでjobs/workspacesを新規セッションがある時だけ取得 ([138c0d9](https://github.com/kt0319/any-console/commit/138c0d9705d8755ba25748bcce7b6505f9e242e3))


### Refactor

* Add/Openボタンのラベルを固定化しcwd追随ポーリングを廃止 ([4da6fef](https://github.com/kt0319/any-console/commit/4da6fefa942fb3fa530c29cc63ae44fa34f43c45))
* Info Pillsの整理（並び順統一・Pull/Push設定統合・ワークスペース名を必須化） ([6959878](https://github.com/kt0319/any-console/commit/6959878be27cbbed39bf148297c5d1419497544d))
* Info Pills並び替えUIをワークスペース一覧と同じドラッグハンドル方式に変更 ([7bb4474](https://github.com/kt0319/any-console/commit/7bb44742a26e0f9f9a1e2ba474cb4389ec431339))
* peek表示をルックアライクではなく実ボタンそのものの一時表示に変更 ([432b4cc](https://github.com/kt0319/any-console/commit/432b4ccbf8ea7ae6cd30faacc4961ae9d9a2a79f))
* Pull/PushピルはBranchピルに統合済みのため設定項目を削除 ([a61dff4](https://github.com/kt0319/any-console/commit/a61dff4b0d24569add8c44d8f7c4432ba9021996))
* RenameとMoveボタンをMoveに統合する ([9b1ebb0](https://github.com/kt0319/any-console/commit/9b1ebb0e79f8a9be5210bbb998b1d424daa4f49e))
* WorkspaceStatusBarを削除しインフォピルに機能を一本化 ([496401c](https://github.com/kt0319/any-console/commit/496401c94c160ac69ee4a6e594893c508c1db6c3))
* ピルのボタン個別スライドインを廃止しpill-group位置スライド1本に一本化 ([762c91f](https://github.com/kt0319/any-console/commit/762c91fa7201f97f9de566a4c08cdbf9576b2e4b))
* ワークスペース詳細からJobsタブを削除 ([a4eb873](https://github.com/kt0319/any-console/commit/a4eb8730eeb58a4a8579f3bc02a2980ceb4bd148))
* ワークスペース詳細を開く手段をツールバーのAdd jobへ集約する ([84bcec4](https://github.com/kt0319/any-console/commit/84bcec40f5b60c461f5ffaf9fa0924967b765acb))


### Documentation

* A11Y監査のFileBrowser TODOを完了扱いに更新 ([ab45e71](https://github.com/kt0319/any-console/commit/ab45e717debd4eff2a48d0a10c39a3a123dc76fe))
* Dispatch APIの使い方をREADMEに追加 ([c9d449c](https://github.com/kt0319/any-console/commit/c9d449c538778365d617af80d543be590a44e90f))
* Info Pills設定のFilesラベルをWorkspaceに変更 ([cf9e1b4](https://github.com/kt0319/any-console/commit/cf9e1b447e70c848c32b2dbbf880c721a678832c))
* Info Pills設定の各項目説明を実際の表示条件に沿って詳しくする ([0651b3c](https://github.com/kt0319/any-console/commit/0651b3c39c2539990910e8064ebda9dad11668f1))
* pill-group内の古いposition:absolute説明コメントを削除 ([f0af5e2](https://github.com/kt0319/any-console/commit/f0af5e2528a96631fe1c27dc5a15b161c402af57))

## [0.9.0](https://github.com/kt0319/any-console/compare/v0.8.0...v0.9.0) (2026-07-31)


### Features

* Auth Config に API Tokens 管理 UI を追加 ([59f3d73](https://github.com/kt0319/any-console/commit/59f3d736dbcb8237c6fac55d9157fb8280ffd1d9))
* Changesタブのホバー起動メニューを廃止し差分ページヘッダーにアクションを統合 ([65cbdf2](https://github.com/kt0319/any-console/commit/65cbdf27cef5fc332ab09ee5349d757b7d045d8b))
* Circle Keypadの方向キー割り当てに数字(0-9)を追加 ([28176db](https://github.com/kt0319/any-console/commit/28176dbdc5b7bd1db484a0f56b6f749ff16bf8b1))
* Dispatch Queueを常時表示にしDispatchesへ改称、説明文を追加 ([93e240a](https://github.com/kt0319/any-console/commit/93e240a38131a0baaf7b235fc9560086bd7b56f6))
* dispatch キューの重複排除と direct フラグによる即時実行 ([0635072](https://github.com/kt0319/any-console/commit/063507213b61d2407ed4fe00764380cc979625fd))
* dispatch のキュー項目を dedup_key で束ねる ([c537e5b](https://github.com/kt0319/any-console/commit/c537e5be6914035693d0244a29882da81c22e8c5))
* dispatch を direct 実行指定に改名し未コミット変更のブランチ切替を防ぐ ([a54d4d7](https://github.com/kt0319/any-console/commit/a54d4d70a6dbd6673370fb05717a2f6aef319535))
* dispatch 専用のスコープ付き API トークンを追加 ([b53ca05](https://github.com/kt0319/any-console/commit/b53ca0562fc24ff23e613608ba6ba813698aaefd))
* Dispatch承認画面にworktree新規作成フォームを追加 ([4367037](https://github.com/kt0319/any-console/commit/43670371cb00a8962a9166db345d8617b8bd7c6b))
* dispatch通知本文にjob/branch/textの詳細を追加 ([1b7996f](https://github.com/kt0319/any-console/commit/1b7996f7d3e03a38d802ff051abdee3614bd386b))
* Filesタブのホバー起動メニューを廃止しフォルダの常設ボタンとファイル詳細ヘッダーに移行 ([d98d575](https://github.com/kt0319/any-console/commit/d98d57565abd8e9e62a6686e48ece8bd1cf96d79))
* Historyタブのコミット選択でアクションメニューをコミット詳細画面に統合 ([435a1ed](https://github.com/kt0319/any-console/commit/435a1ed32063f0736e8ccdedd3848c901c232244))
* Historyタブの差分ファイル一覧のホバー/長押しメニューを廃止し差分ページヘッダーに統一 ([0d1ea7b](https://github.com/kt0319/any-console/commit/0d1ea7b88c2b497ccf8dad2c650668127151e6cf))
* PCのセッションタブに×ボタンを復活させる ([53a1d4e](https://github.com/kt0319/any-console/commit/53a1d4e4b294be2a030fe1291743088ef29f3c56))
* pushの20秒猶予での活動検知をタブ通知マークの取り消しにも適用 ([3f31bed](https://github.com/kt0319/any-console/commit/3f31bed0c614f579264b57b0e1ba77b7f316fee5))
* QRコードによるデバイスペアリング機能を追加 ([462b28d](https://github.com/kt0319/any-console/commit/462b28d9fb894b7ec47bc39b3482dae2186c8319))
* QRコードによるデバイスペアリング機能を追加 ([87f4f54](https://github.com/kt0319/any-console/commit/87f4f54aeff80278f5d594be3867ea332d717b44))
* Recent Jobsにピン留め機能を追加しWorkspaceOpenのカテゴリ表示をSettings画面に揃える ([c97902b](https://github.com/kt0319/any-console/commit/c97902b37525229172511ccf25bbc6a94c8e22d9))
* Recent Jobsのピン留めをサーバーに保存するよう変更 ([b7d37ba](https://github.com/kt0319/any-console/commit/b7d37badac702a68fa0248fa908f9eb90b3c1733))
* Recent Jobsの上限を10件にしワークスペース一覧でMoreボタンによる展開表示を追加 ([8ef8f01](https://github.com/kt0319/any-console/commit/8ef8f01d04baef5ca902845efb9543c498d00fac))
* Recent Jobsの非ピン留め履歴もサーバーに保存するよう変更 ([ed64a04](https://github.com/kt0319/any-console/commit/ed64a0439a3849779ae8b8c0cbdb62d5f49ba14f))
* ScreenEmptyのRecent JobsにMoreボタンを追加しRecentJobsListコンポーネントに共通化 ([482da30](https://github.com/kt0319/any-console/commit/482da307b62ad263a31fead438079057c7b4a759))
* System InfoにTailscale情報カードを追加 ([dd471e7](https://github.com/kt0319/any-console/commit/dd471e749d949a5546530820572f53a8eb0ad1b0))
* WorkspaceOpenモーダルにRecent Jobsセクションを追加 ([a2aad3b](https://github.com/kt0319/any-console/commit/a2aad3b99f37f0fbb8c24e0e876864b2b278ebd0))
* インフォピルにpush/pullマークがある時はクリックでBranchesペインを開く ([4d656b7](https://github.com/kt0319/any-console/commit/4d656b79d7ada1c947d559497a69008ec7b1ad30))
* スタートページのSetupセクションにHTTPS/PWA/通知の導線を追加 ([4065e32](https://github.com/kt0319/any-console/commit/4065e322d6fe4d02d8ac0cdd857c2ae5ff88e945))
* スタートページのSetupセクションを最上部に配置する ([ae06cf5](https://github.com/kt0319/any-console/commit/ae06cf5d3a452dc8261357b4c63891dbf6d511c2))
* スニペット/履歴の挿入を設定画面のSend Snippet/Send Historyに統合 ([c64cf29](https://github.com/kt0319/any-console/commit/c64cf291f4abec2eae13e7b76e3ea48e66ffbffd))
* セッションタブ・ワークスペース詳細タブのアクティブ切替をアニメーション化 ([2aaefc9](https://github.com/kt0319/any-console/commit/2aaefc94eccf7bfc45165675574fdaefa3e18ecb))
* セッションタブ・ワークスペース詳細タブのサイズを拡大 ([669dcae](https://github.com/kt0319/any-console/commit/669dcaed46d28dc2bbd716e0d0e1e618be0177ae))
* セッションタブにnotify_phrase検知の通知マークを追加 ([0f48188](https://github.com/kt0319/any-console/commit/0f481881ee174f8bc949afc1a4cb8998879208e5))
* ターミナルresize適用時にセッション別ログを追加(調査用) ([55887e5](https://github.com/kt0319/any-console/commit/55887e590f50ac292a49e568469d6c764ac970fb))
* ターミナルWSアタッチ時にもクライアント別ログを追加(調査用) ([b1ea124](https://github.com/kt0319/any-console/commit/b1ea1245e5bf9031bf06f9bdd2cfe48e264b3321))
* タブのダーティマークをワークスペース/jobアイコンの右下バッジに変更 ([6cbf1e7](https://github.com/kt0319/any-console/commit/6cbf1e7eb2d657353e844a05d03bfa702cf40902))
* タブバーのタブ・＋ボタン・設定ボタンの見た目を統一する ([88f347e](https://github.com/kt0319/any-console/commit/88f347e0f78b0bfc8a0ec625075b913cdf346f88))
* フォルダのRename/Move/Deleteをコンテキストメニューからページヘッダーに展開 ([8c85d37](https://github.com/kt0319/any-console/commit/8c85d3717d8406eb7b60b3d70ee35c63bbf4e1d0))
* フレーズ検知の猶予秒数を設定可能にする ([14a4470](https://github.com/kt0319/any-console/commit/14a447004ae700eb9ed5057a02e92ccd58109f9f))
* モバイルのタブはアクティブ再タップでクローズ確認、長押しクローズを廃止 ([5ddcdf5](https://github.com/kt0319/any-console/commit/5ddcdf57183085e14756c64d6cdbffb7207654ab))
* モバイルのタブレイアウト設定をSingle pane/Vertical splitのみに絞る ([28cb8b8](https://github.com/kt0319/any-console/commit/28cb8b8017d02810de4fbb75dfcd0a171bf34c01))
* ログイン画面にQRコード読み取りによるペアリング機能を追加 ([0c366c6](https://github.com/kt0319/any-console/commit/0c366c6fdd677bc1f9ff4c44d46788058fd5dd18))
* 入力フォームにスニペット挿入ボタンを追加し矢印/fnキー切替を廃止 ([1f236b8](https://github.com/kt0319/any-console/commit/1f236b87a5150337778c2bdc68d617df78451f20))
* 入力フォームのスニペットボタンに履歴表示を追加 ([8ab59f7](https://github.com/kt0319/any-console/commit/8ab59f7b0f451670bf510d77457ee271bb5481ac))
* 入力フォームの物理キーボード矢印キーによる履歴ナビゲーションを復活 ([7440de7](https://github.com/kt0319/any-console/commit/7440de738027a5e8442a5e5fd665391d33b4a2da))
* 分割モードのインフォピルにahead/behind表示とChanges numstatボタンを追加 ([46f6eb5](https://github.com/kt0319/any-console/commit/46f6eb5f5cb14d44eb630a5e03c889f60023b93c))
* 分割モードの情報ピルにもアイコン右下のダーティバッジを追加 ([bb1513f](https://github.com/kt0319/any-console/commit/bb1513fb365a3fa3fc2f5265acb452fd1aecc85d))
* 初回起動ログにトークンのQRコードを表示し1台目もQR経由でログインできるようにする ([c0f3b5b](https://github.com/kt0319/any-console/commit/c0f3b5b93323c70338bce216058677086f72e352))
* 承認モーダルで新規ブランチ作成時の dirty ワークスペースをブロック ([3f902a8](https://github.com/kt0319/any-console/commit/3f902a8c5ec8f26ab0161b1acfce3b3b8c6557c6))
* 設定メニューのPort Previewに検出サーバー数を表示 ([96a0c35](https://github.com/kt0319/any-console/commit/96a0c3578a6363731ffb26b89708197078a983a8))
* 設定メニューをPCでもモバイルと同様のフルスクリーン表示にする ([f627e2f](https://github.com/kt0319/any-console/commit/f627e2fb2bf5498f50ac6ee84362c6de43db4892))
* 設定画面ヘッダーに分割セッションと同じ見た目のクローズボタンを追加 ([3ea12b2](https://github.com/kt0319/any-console/commit/3ea12b22cb624689ba2623ec2bdff0757261a8af))
* 設定画面表示中にタブを切り替えたら自動でダイアログを閉じる ([6757576](https://github.com/kt0319/any-console/commit/67575766ee27cc3d52ebe8ab36035ded3864d53b))


### Bug Fixes

* +ボタンをタブのスクロール行内・最後のタブの直後に戻す ([000c342](https://github.com/kt0319/any-console/commit/000c34234685a40c516e10b460ba55c58610d550))
* api_tokens のrevoke/verifyをロックで直列化し失効の巻き戻りを防ぐ ([99a247d](https://github.com/kt0319/any-console/commit/99a247ddf40d15fdf95660ad2b324e1798f1f85b))
* Chrome PWAで貼り付けが二重に反映される不具合を修正 ([6ae29b9](https://github.com/kt0319/any-console/commit/6ae29b95e65fe1415fa8ee9b94e0f12133d02471))
* Create worktree選択時に無関係なbranch_statusノート(missing等)が表示される不具合を修正 ([74cd757](https://github.com/kt0319/any-console/commit/74cd757a706229724dddbe53f65640ad3d440671))
* dispatch 置き換え時に dispatchId を引き継ぎ通知リンクを有効に保つ ([1bb2323](https://github.com/kt0319/any-console/commit/1bb23235933834e6013b68cdbfd4e5a524c1309e))
* dispatch 置き換え時に開いたままの承認ダイアログを閉じる ([5df714a](https://github.com/kt0319/any-console/commit/5df714ac412cae76da7e13f42c93cea47d07f470))
* dispatchトークンからのsession_id指定を無視し隠れたセッション誘導を防ぐ ([c1f5a44](https://github.com/kt0319/any-console/commit/c1f5a4434e3213346646ea88aec0310e9bb730d7))
* dispatchのnew session実行で同一セッションのタブが二重に開く不具合を修正 ([f7dc737](https://github.com/kt0319/any-console/commit/f7dc737c2c5caa842a5951beb2280311d8d6ebc6))
* Dispatch項目を開いた時のセッションタブ自動切り替えを廃止 ([056def8](https://github.com/kt0319/any-console/commit/056def8bc2bd99b8ed6eace622107c7133ee7a83))
* Dispatch項目を開くと設定画面が閉じてしまう不具合を修正 ([8bc4eee](https://github.com/kt0319/any-console/commit/8bc4eeea1f653ef9ed7d4fa9ce6bb016a7eddbff))
* E2Eのメニュー項目名をSend Snippet/Send Historyに追従 ([90acd69](https://github.com/kt0319/any-console/commit/90acd6955ec9a3d1c25478d7117011e3a719bc55))
* Empty画面のPCレイアウトでRecent Jobsを右列・サーバー情報をウィンドウ右下端に固定 ([5f89198](https://github.com/kt0319/any-console/commit/5f89198ea7913b2a23b960ae346ad37a488e5a63))
* FilesペインE2Eテストを廃止済みのホバーメニュー前提から新UI（ファイル詳細ヘッダー）に合わせて修正 ([fb56cfa](https://github.com/kt0319/any-console/commit/fb56cfadd1c1e28a13415338cbe535e518ada3f5))
* New branch name入力をhide/showではなくdisable/enableに変更 ([6d885a0](https://github.com/kt0319/any-console/commit/6d885a0b73f99bf42f72886cf1de37dbc4bb7059))
* Open on your phone経由のPairDeviceConfigで戻るとAuthに戻るよう修正 ([f66530a](https://github.com/kt0319/any-console/commit/f66530a04f6f5dd3e18ff7db08dc4a353c7149b6))
* pairページのリライトテストがdist/の有無で結果が変わる不安定性を修正 ([d41b6bb](https://github.com/kt0319/any-console/commit/d41b6bb7173988c24b528aa0494fbf0da35dcd1a))
* PCでターミナル領域クリック時にターミナルへフォーカスを当てる ([a6b4998](https://github.com/kt0319/any-console/commit/a6b49983b2d16a0048b6afdddf1c7770f87baa95))
* pytestでpush通知が実運用データを読み書きしてしまう隔離漏れを修正 ([9f05e99](https://github.com/kt0319/any-console/commit/9f05e99eaa4fd86fed2c668c28fca92cdd79b263))
* Recent JobsのMore/LessトグルをEmpty画面のみ廃止し全件（最大10件）表示にする ([c5ff3ee](https://github.com/kt0319/any-console/commit/c5ff3eefc335b83802474483189f1c142fd8863a))
* Select & Copyのテキストエリアが二重スクロール構造でスクロールしづらい不具合を修正 ([50006ab](https://github.com/kt0319/any-console/commit/50006ab370b5b0dca4284bae67b8586993688450))
* server_key初回生成のTOCTOUをロックで解消 ([52b454c](https://github.com/kt0319/any-console/commit/52b454cc8d0cbf79181bf9fce525b420fb4a0459))
* Terminal設定画面でスクロールが効かない不具合を修正 ([95fc797](https://github.com/kt0319/any-console/commit/95fc797d4e81d3e28362a7423cf26017ca1dcf57))
* update_tokenのメモリ代入をロック内に含め完了順の食い違いを防ぐ ([e131b55](https://github.com/kt0319/any-console/commit/e131b551b8d9414b69fe5ea89ebdfef651fd8f16))
* User Tokenのコピーボタンのaria-labelをAPI Tokens側と重複しないよう修正 #CI ([62956bf](https://github.com/kt0319/any-console/commit/62956bf347fd7787c92cc003f0487d3d69fc467a))
* vitest happy-domでglobalThis.localStorageが未定義になりtest_workspace_store.jsが失敗する不具合を修正 ([fe67888](https://github.com/kt0319/any-console/commit/fe678888f3b9d5819ac10ba6e0d6caf1c8a7c4d0))
* warningタイプのトーストに背景色が定義されておらず透明に表示される不具合を修正 ([6f5a472](https://github.com/kt0319/any-console/commit/6f5a47265716e17435b6fde04420b49f76cf436b))
* アクティブタブの下線インジケーターが境界線からはみ出し実際より大きく見える不具合を修正 ([e9e895f](https://github.com/kt0319/any-console/commit/e9e895f73817d6f7fc4decf35e80504f4791c0a5))
* コピー失敗時にもCopied表示になる不整合を修正しコピー処理を共通化 ([9f3d053](https://github.com/kt0319/any-console/commit/9f3d053c7c325e4031f558c27a46bff736cdb782))
* コミット詳細のアクションボタンをトグルではなく常時表示に変更 ([5bda5c6](https://github.com/kt0319/any-console/commit/5bda5c6605dbfe04657457a4257e278bed41686e))
* サーバー再起動後に他デバイスのタブがタブバーから消える不具合を修正 ([2bb68d2](https://github.com/kt0319/any-console/commit/2bb68d2e72f45cd9043048a40909db8486599673))
* スニペット/履歴の項目挿入時にテキストボックスへフォーカスしないよう修正 ([a94f6c4](https://github.com/kt0319/any-console/commit/a94f6c4780ad3e86d1481a3d0928c614bd5d3812))
* スプリット枠外の未マウントタブがバックグラウンド復帰時に巻き込まれてリサイズされる不具合を修正 ([419c8cf](https://github.com/kt0319/any-console/commit/419c8cf602ffc1a923dd65e5be5a3860ab82e838))
* セッションタブの+ボタンを正方形にしてアイコンを拡大 ([9e41faa](https://github.com/kt0319/any-console/commit/9e41faaf113d7fd8c437bc677b3a33b753b7e0ad))
* セッションタブのアクティブ切替アニメーションと×ボタンを廃止し再タップクローズに戻す ([088d449](https://github.com/kt0319/any-console/commit/088d4493bf90506bee1327164fcee8f4a25ee77c))
* セッションタブのフォントサイズをPC/モバイル共通で14pxに縮小 ([0e5b206](https://github.com/kt0319/any-console/commit/0e5b206a7ba51fba375d5e91c50ee401c7ef0c18))
* セッションタブの歯車ボタンを正方形にしてアイコンを拡大 ([2485e43](https://github.com/kt0319/any-console/commit/2485e43cf79d336829ed1dac6c6ba096470b0276))
* セッションタブの閉じるボタン・ラベルの縦位置ズレを修正 ([bfbbbfd](https://github.com/kt0319/any-console/commit/bfbbbfd381f15626090ff326bd01ee35a8e4959f))
* セッションタブの閉じるボタンがモバイルで反応しない不具合を修正 ([ac39e7d](https://github.com/kt0319/any-console/commit/ac39e7ddf2fa369208e94fd19e721578fa9ed3cd))
* セッションタブの閉じるボタンのタップ領域を拡大 ([70b03ae](https://github.com/kt0319/any-console/commit/70b03aea8360cd12bab386015601c5c997e40537))
* セッションタブの高さがステータスバーと1px揃っていない不具合を修正 ([7411837](https://github.com/kt0319/any-console/commit/7411837c9685a4bc73768712d47c4eebd81e3eec))
* ターミナルタブの複数クライアント間同期をWebSocket pushに変更 ([ea45e59](https://github.com/kt0319/any-console/commit/ea45e59d557acdc52d754066337a19cc7049306b))
* ターミナルのURLクリックがアプリ改行で途中で切れる不具合を修正 ([647fb72](https://github.com/kt0319/any-console/commit/647fb72d45c1f7c3f010a928bbedcd943cebd5ba))
* ターミナル情報ピルが設定ダイアログより前面に表示されるのを修正 ([ad92429](https://github.com/kt0319/any-console/commit/ad924292b4dd01d82943e260da7d439a3c674f67))
* タブバーのDetach選択が無視される不具合を修正 ([994fb38](https://github.com/kt0319/any-console/commit/994fb3851b94fb8aea5fa085cd9e7faac587004e))
* タブ切替時にタッチ操作でソフトキーボードが誤起動する不具合を修正 ([fd31623](https://github.com/kt0319/any-console/commit/fd31623bd29358eb1e22bf8bc219eb3f3f2e2252))
* テストが実運用のauth.json/devices.jsonを汚染していた2つの隔離漏れを修正 ([87a9170](https://github.com/kt0319/any-console/commit/87a917095f6dcfab1918e6f9d22e3be138d93375))
* ペアリング開始失敗時にサーバの具体的な理由を表示する ([8ddc77b](https://github.com/kt0319/any-console/commit/8ddc77b1a71e40c19696748ec148b6abdaedffda))
* メイントークンのローテーションもauth.json書き込みロックの対象にする ([02ada5d](https://github.com/kt0319/any-console/commit/02ada5da3a35ce1805b0fb6240557ebd4ae524e0))
* メイントークンの文字列をprefixで誤判定していたdispatch認証を修正 ([26fbbd1](https://github.com/kt0319/any-console/commit/26fbbd196f890793e4b52f8b6f23851107649495))
* モバイルでFilesタブのファイル選択が2タップ必要な不具合を修正 ([bfc10b5](https://github.com/kt0319/any-console/commit/bfc10b581ee10030149d6b1840cac641f2f91a0d))
* モバイルでアクティブタブの再タップによるクローズ確認を出さない ([41fc8c2](https://github.com/kt0319/any-console/commit/41fc8c2d77e50cb69f2c8b164d5aba4ad7449f3e))
* モバイルのセッションタブでアイコンサイズをアクティブ/非アクティブ間で統一 ([80900d2](https://github.com/kt0319/any-console/commit/80900d232e273a640d532ff1dcd905d5531ca91e))
* モバイルのセッションタブでアイコン間隔をPCと統一 ([4e74a28](https://github.com/kt0319/any-console/commit/4e74a2880f0c5692081384c18914442e628cae89))
* モバイルのセッションタブでワークスペーステキストを常に非表示にする ([fa2264d](https://github.com/kt0319/any-console/commit/fa2264d69d817578c9a35b22b7b415c981b5529d))
* モバイルのタブアイコンがdirtyドットの分だけ中央からズレるのを修正 ([518fe0c](https://github.com/kt0319/any-console/commit/518fe0ce7ec59675eaecd4e8e46ca1587f7f8593))
* モバイルのワークスペース詳細タブのpadding-bottomでmodal-headerとの隙間ができる不具合を修正 ([c6de910](https://github.com/kt0319/any-console/commit/c6de910a760b6826d4804feaa5850eed21a914a0))
* モバイル設定画面でmodal-headerの上マージンによりタブとの隙間ができる不具合を修正 ([50718f6](https://github.com/kt0319/any-console/commit/50718f6f898604594cf0f1d74886f992865e2989))
* モバイル設定画面のタイトル下の余白を22pxから8pxに詰める ([34fbe2e](https://github.com/kt0319/any-console/commit/34fbe2e2a201d2629bf663e512fc6030d9c6c204))
* ワークスペース詳細タブにaria-labelを付与しE2Eのタブ特定をhasTextから移行 ([c9bf798](https://github.com/kt0319/any-console/commit/c9bf798c6881017044d0bb9fb4babd81d04c0324))
* ワークスペース詳細のタイトルにブランチ名を付けないようにする ([efc4e37](https://github.com/kt0319/any-console/commit/efc4e37cc98e86a9b9b80980c20133e42854f95d))
* 他デバイスで開いたターミナルタブがタブバーから見えなくなる不具合を修正 ([340e41e](https://github.com/kt0319/any-console/commit/340e41e35880d9cacadadd483f55c1908db01aad))
* 分割モード以外の情報ピルからdirtyドット表示を削除 ([df9ff31](https://github.com/kt0319/any-console/commit/df9ff3181785ae145d0d0c428eb70e905cf7f5d4))
* 半開きWS再接続時にhistoryを取り直し、stale検知を早める ([4b622e7](https://github.com/kt0319/any-console/commit/4b622e729ef4177a1f825bf6186d1691d0fc0ee1))
* 半開きWS検知時に即座にReconnectingオーバーレイを表示 ([012a3ad](https://github.com/kt0319/any-console/commit/012a3ad034f80422c38f285b5da2b6ef11ccc666))
* 明示的なコピー操作をcopyTextに統一し非secure contextでも動くようにする ([5bfe483](https://github.com/kt0319/any-console/commit/5bfe48330e323d15d4e48ed0b0c07d59cc8ae319))
* 自分が直接開いていないターミナルタブをタブバーから隠す ([ed0e8bf](https://github.com/kt0319/any-console/commit/ed0e8bfd8615af82c3e22c4d4520ffc4e68618f6))
* 複数ファイルドロップで上書き拒否した際にスキップ件数をトーストに表示する ([94a425b](https://github.com/kt0319/any-console/commit/94a425b3d8633c8e3523fea8c3ca9fc10f82a233))
* 設定ダイアログのタイトルのクリック域を文字列幅に、背景透過を抑える ([94393a5](https://github.com/kt0319/any-console/commit/94393a514236c28f9feed1eb379f8dbc9c91c488))
* 設定ダイアログのヘッダーとコンテンツ間の余白を詰める ([5830c99](https://github.com/kt0319/any-console/commit/5830c999c4979be6443124ade1abe9c3ebf6240e))
* 設定ダイアログをターミナル表示エリアに正確に合わせ閉じるボタンをタブバーに統合する ([9d6d097](https://github.com/kt0319/any-console/commit/9d6d0977e8cc3dc5c7b3705b9b46663210686fe3))
* 設定画面が開いている間はターミナルのCtrl+Cコピー横取りを無効化する ([96931b3](https://github.com/kt0319/any-console/commit/96931b309e06a79b447b78ee4fa099ffff8cb195))
* 設定画面のチェックボックスがOSアクセントカラー(緑)になるのを修正 ([94a6234](https://github.com/kt0319/any-console/commit/94a6234e72bb006db9e13313ec9239d6e50ed182))
* 購読開始直後にauto fetchを実行してbehind判定の遅延を解消 ([9ad2656](https://github.com/kt0319/any-console/commit/9ad2656e3670094fd1509cc5557cb5ab4757ad25))
* 通知クリックで既存タブへ再アタッチする際に設定モーダルが閉じ残る不具合を修正 ([be5185b](https://github.com/kt0319/any-console/commit/be5185bd8551fbfb76320faaf25acb26918ba081))
* 非表示タブがバックグラウンド復帰時のWS再接続で古いサイズをPTYへ送ってしまう不具合を修正 ([7f055ba](https://github.com/kt0319/any-console/commit/7f055ba7c5503fa0b9dcb250fdc2728b54e24414))


### Performance Improvements

* last_seen_at/last_usedの更新をディスク書き込み間引きで軽量化 ([8bb8b95](https://github.com/kt0319/any-console/commit/8bb8b95813df533be94c50a4c95e635d29c4a269))
* preview/portsのポーリングをアプリ起動中常時からPreview設定画面を開いている間だけに変更 ([11a32af](https://github.com/kt0319/any-console/commit/11a32afe1434adbce8037232cddf8b45ff2fe752))


### Refactor

* Authページのトークン/デバイス/APIトークンのカテゴリ表示とトークン欄UIを整理 ([bc14cfd](https://github.com/kt0319/any-console/commit/bc14cfd9c8766ad27900c86656c4d0eb4ef646c4))
* dispatch.pyのdedup判定を純関数化しWS配信テストを分離 ([5abf91a](https://github.com/kt0319/any-console/commit/5abf91ad54212cd044b3337e51a958351c61e795))
* DispatchモーダルのBranchフォームをCreate branchチェックボックス+共用セレクトに整理 ([a91e176](https://github.com/kt0319/any-console/commit/a91e176f6f76c37a6f18924cb64f313c6c94cd60))
* Dispatch承認画面のCreate branch/worktreeをチェックボックスからラジオボタンに変更し新ブランチ行を分離 ([0fa89a7](https://github.com/kt0319/any-console/commit/0fa89a763d4c91b4df40b6649de9ba93e666ccf1))
* Dispatch承認画面のブランチ状態表記を削除しRunのdisabled+エラー文に統一 ([e36976c](https://github.com/kt0319/any-console/commit/e36976c653d767c2fac55a7c0294f919f1c52a76))
* Port PreviewをDev Server Previewに表示名を変更 ([f148237](https://github.com/kt0319/any-console/commit/f148237e3e829e4377ef3b92a56edf32b79f1e8e))
* QRペアリングのレートリミッタをstart/status/claim個別から1バケットに統合 ([e399007](https://github.com/kt0319/any-console/commit/e39900749444d03d9005107840e01d95f3835ccc))
* UIから到達不能だったworking_enabledとジョブdescriptionを削除 ([b7e8610](https://github.com/kt0319/any-console/commit/b7e86108929f488657cef27945d900bd51771ab0))
* セッションタブ/ワークスペース詳細タブをボーダーレスのフラットタブに変更 ([d72863d](https://github.com/kt0319/any-console/commit/d72863d6162545f1f36d420aaafcd9791de597c0))
* どのテンプレートからも参照されていない死にCSSを削除 ([a94aeb1](https://github.com/kt0319/any-console/commit/a94aeb1ddc476d4d1114fc2c1b668de6e0a3b96c))
* バックエンドの重複処理を共通ヘルパーに整理 ([b3282f7](https://github.com/kt0319/any-console/commit/b3282f70daba93df1e7125c92160afeac42cef3f))
* フロントエンドのCSS重複をグローバルスタイルに集約 ([7bc00f9](https://github.com/kt0319/any-console/commit/7bc00f9a547e7ad26d67fee425a56e7a23912e50))
* フロントから呼ばれていない5つのエンドポイントを削除 ([c598af0](https://github.com/kt0319/any-console/commit/c598af0bebe514217cb91e1f649cb61416016b87))
* フロントの死にemit・未参照ストアstate・非公開化すべき内部関数を整理 ([08823f3](https://github.com/kt0319/any-console/commit/08823f3b3ff20f79ef8a20dae1b112f9b50939ba))
* ペアリングclaimの中間状態(claiming)を廃止しさらに単純化する ([41aef3c](https://github.com/kt0319/any-console/commit/41aef3c4f69b79c6c6acb02291fb0890596fce06))
* 解決済み不具合の調査用ログを削除する ([66f5d88](https://github.com/kt0319/any-console/commit/66f5d888da0f267ad46fc77dea0770b45428a7bb))
* 認証結果を構造化しdispatch tokenの脆い値比較判定を解消 ([6e21c86](https://github.com/kt0319/any-console/commit/6e21c86e8fe96d3b6e22e2c974894fbceb413481))
* 送信元が無くなったJob finished通知の設定トグルを削除 ([9e61659](https://github.com/kt0319/any-console/commit/9e616596b519c235a85e94a2f8ca7ca6fb1ea0bf))


### Documentation

* dispatch専用APIトークン導入のADRを追加 ([f2e83b2](https://github.com/kt0319/any-console/commit/f2e83b235988dfa2ded9f8daee0ccd284ffe1043))
* 非表示タブのリサイズ巻き込み不具合をADRに追記 [#29](https://github.com/kt0319/any-console/issues/29) ([3f0a480](https://github.com/kt0319/any-console/commit/3f0a4802e516bcc487d37c94eb398e475e5db5a7))


### Tests

* chmodベースの権限テストをroot実行時はスキップする ([8c783d0](https://github.com/kt0319/any-console/commit/8c783d0133e2e6650731f35e00b606776a45d4f4))


### Build

* app-bridge.jsの無効な動的importを解消しチャンクサイズ警告閾値を調整 ([4b9325a](https://github.com/kt0319/any-console/commit/4b9325a6e1ced237164f57042a2bf57405e1fa79))


### CI

* CI失敗時にany-consoleへdispatch通知するワークフローを追加 ([5073dbc](https://github.com/kt0319/any-console/commit/5073dbc1e57c504a2e9e3ca799da7bffb8ee98dd))
* PRブランチでのCI二重実行を解消しdocsのみの変更をスキップ ([b152f54](https://github.com/kt0319/any-console/commit/b152f5405b9561d88b8e04b2da3cb3514aed2c15))

## [0.8.0](https://github.com/kt0319/any-console/compare/v0.7.0...v0.8.0) (2026-07-24)


### Features

* AIエージェント自動登録をチェックボックス選択式にし、claudeのnotify_phraseを設定 ([d0a1a68](https://github.com/kt0319/any-console/commit/d0a1a68c824d6f0949d5761379df69faf09ba140))
* ANY_CONSOLE_DATA_DIR で data/ と config.json を隔離配置できるようにする ([63933a9](https://github.com/kt0319/any-console/commit/63933a92637d0531364232c47403105d05230c26))
* Codexの承認待ち通知フレーズをsetupで設定 ([3d8ef0e](https://github.com/kt0319/any-console/commit/3d8ef0e4cd2fd0dfbabe3d3f0f44b41d23b83ce1))
* dispatchダイアログでNew session時にworkspaceも選択可能にする ([1992ac1](https://github.com/kt0319/any-console/commit/1992ac17be14c7e6d91a1ed209a784dc9329fbf7))
* dispatchの承認待ち/承認/却下/実行を既存のactivityログに記録する ([ba1c8ab](https://github.com/kt0319/any-console/commit/ba1c8abe3aa66afb5cb76bb2c0138bca59f2dc5f))
* dispatch承認をSettingsのDispatch Queueに一覧化して非同期化 ([8fcb5a1](https://github.com/kt0319/any-console/commit/8fcb5a17775044b98d72bb02084d791a2397d692))
* GET STARTED画面にサーバー名とバージョンのステータスを表示 ([e1d2145](https://github.com/kt0319/any-console/commit/e1d2145e1a7ca8a3e8538b2cda4e5b41948ec67a))
* git操作のactivity記録にコミットハッシュを追加し、記録対象を大幅拡張 ([13db8ef](https://github.com/kt0319/any-console/commit/13db8ef363b63149812b7c3f64b0032cda54330f))
* notify_phrase検出後、アクティビティが無い時だけ通知するように変更 ([7eea1e2](https://github.com/kt0319/any-console/commit/7eea1e288d8934ef194a8af27ecb84b91fde522f))
* setup時にインストール済みAIエージェントCLIをcommon jobとして自動登録 ([32c9cb5](https://github.com/kt0319/any-console/commit/32c9cb5adff8ab1aee6a71e05264117ce82b4783))
* Workspaces一覧に+ボタンを追加しAdd Workspaceへ遷移、設定メニューから項目を削除 ([fe7f987](https://github.com/kt0319/any-console/commit/fe7f987f162b9d49bd02e8c24ab434018570751e))
* Workspace一覧画面に読み込み中のLoading表示を追加 ([82f573d](https://github.com/kt0319/any-console/commit/82f573d78abdb653c9c67304554038f8186c7eea))
* サークルキーパッドでAltキー修飾とキーの自由な組み合わせに対応 ([a8a390d](https://github.com/kt0319/any-console/commit/a8a390d9753f72a937b5200e31bca697d1ac7cb9))
* サークルキーパッドのコーナーアクションにNoneを追加し非表示にできるようにする ([1fb8542](https://github.com/kt0319/any-console/commit/1fb8542765fe20c479753fa249427e52f2578e47))
* ジョブ完了プッシュ通知をジョブ単位でON/OFFできるように変更 ([0101c7e](https://github.com/kt0319/any-console/commit/0101c7e6b93cfb4dd387797debcbe9ac78409740))
* セッション一覧をサーバ側スナップショットに集約（ADR 24） ([45e0c0d](https://github.com/kt0319/any-console/commit/45e0c0d09adebb9f3c4619bdd81eb12295680fe4))
* ソフトキーボードのキー配置とfn/snippet切替を再構成 ([c82e810](https://github.com/kt0319/any-console/commit/c82e81055ca3cf2ea17538ce760144d5d0e671ab))
* ソフトキーボードをターミナルと完全に分離しQWERTY高さに固定 ([35c8447](https://github.com/kt0319/any-console/commit/35c844751e6403a561006838703687700098ed2b))
* モバイルでタブの長押しドラッグによる並び替え・スプリットに対応 ([bbf2116](https://github.com/kt0319/any-console/commit/bbf2116dd7075bb6a3ab4c63fb94e160aa318400))
* ログイン画面にトークン確認方法のヒントを表示 ([1a46e46](https://github.com/kt0319/any-console/commit/1a46e468921e917fb011683c868c459dc9a09a17))
* ワークスペース一覧のLoading表示にピリオドのアニメーションを追加 ([725e6c9](https://github.com/kt0319/any-console/commit/725e6c96b324edd41e2766250de01bb8110cd02f))
* ワークスペース一覧のpush/pullボタンをeditボタンと同じ高さに揃える ([e7cd58f](https://github.com/kt0319/any-console/commit/e7cd58f9b4cb3b0827adf0eb9892b965734f7d30))
* 承認待ちdispatch一覧を取得するAPIを追加 ([6a9243e](https://github.com/kt0319/any-console/commit/6a9243eff8d3fba810a40e6ce100d4eed883533e))
* 空きペインに横/縦分割ボタンを追加しRemove from splitの挙動を改善 ([b23edb1](https://github.com/kt0319/any-console/commit/b23edb12c83e44e708f79439a3a528592b459e69))
* 空きペインのStop splitボタンをSplitModeSelectorによる分割パターン選択に置き換え ([015d983](https://github.com/kt0319/any-console/commit/015d98352f806b40977e13e3f69ca024feee9a32))
* 素のターミナルで現在のディレクトリのFilesを開けるようにする ([1da3063](https://github.com/kt0319/any-console/commit/1da30638e05f1fbcfa0ab142e2e483a6117a9e38))
* 非ターミナルジョブ完了時にプッシュ通知を送信 ([b65675d](https://github.com/kt0319/any-console/commit/b65675dd15cff131b401959cd8a0992e750a9c42))


### Bug Fixes

* ANY_CONSOLE_DATA_DIR の前後空白を保持する ([a36d6d2](https://github.com/kt0319/any-console/commit/a36d6d2b628a8875d4d114dd40e4a49d687ebaab))
* attachクライアント消失をセッション終了と誤判定して生きたセッションが消える不具合を修正 ([8e6a9dd](https://github.com/kt0319/any-console/commit/8e6a9dd12d9d0556ce71eccca72b9288a7c261ee))
* Changes ペインの Commit ボタンが常に無効になる問題を修正 ([182f585](https://github.com/kt0319/any-console/commit/182f585e3db6b6dc3420ebdf028b80054e542f7d))
* Dispatch Run成功時にSettingsモーダルごと閉じる ([a80aba9](https://github.com/kt0319/any-console/commit/a80aba98507a725411d5e6e687f1ee2d04e52322))
* dispatch キューも ANY_CONSOLE_DATA_DIR 配下へ隔離する ([398e057](https://github.com/kt0319/any-console/commit/398e0573159c939613145719da797ecb58cd9866))
* dispatchキュー配信をAPIレスポンスから切り離しタイムアウトで保護 ([4bbd388](https://github.com/kt0319/any-console/commit/4bbd3887e8ccf2acad32ef49c8a7b216b7a84efe))
* dispatchキュー配信を単一ワーカーに直列化しstale配信を防ぐ ([18603c1](https://github.com/kt0319/any-console/commit/18603c180c9da5caaf0e759dcd8d77033f78b954))
* dispatchダイアログのBase branchセレクトが空欄になる不具合を修正 ([1aaa730](https://github.com/kt0319/any-console/commit/1aaa730325bab38d920c96c8e55426a0cd873f35))
* dispatchダイアログのCreate branchチェック時、項目を隠さずdisabledにする ([09ee645](https://github.com/kt0319/any-console/commit/09ee6450c8051084723822e21b1df8c762088f8a))
* dispatchダイアログのNew session時、Jobを常に選択可能にする ([79f5721](https://github.com/kt0319/any-console/commit/79f5721dc9b927403bf5cb721f33caf70510c3b5))
* dispatchでのブランチ作成後にステータスを即時反映 ([2ff32ad](https://github.com/kt0319/any-console/commit/2ff32aded311fdbcc6698cd2053213dbd90a0d97))
* dispatch配信のタイムアウトでWSを閉じ、初回スナップショットと push を非同期化 ([1bed633](https://github.com/kt0319/any-console/commit/1bed633612141c8db00de2ab5468452da3d72a20))
* E2E の tmux 名前空間分離とランチャー設定の永続化 ([d7080af](https://github.com/kt0319/any-console/commit/d7080af499f0d575dd5c9882b20d2414e5af110f))
* git情報キャッシュが計算中のinvalidateで古いデータに上書きされる競合を修正 ([c9736ab](https://github.com/kt0319/any-console/commit/c9736abaa528cffe1b5f8d8ece9599b9d529d3dd))
* JSON ファイル保存をアトミック化し並行リクエスト時の認証エラーを解消 ([5527ba2](https://github.com/kt0319/any-console/commit/5527ba2b59d513215db99911a48591b7130f2ec2))
* launchdサービスをmacOSのバックグラウンド絞り込み対象外にし、スリープ対策を明記 ([295da85](https://github.com/kt0319/any-console/commit/295da85244d9bb148ff2d1c55b7eed57a8e7373a))
* Run Dispatch画面で既存セッション切替時にWorkspace/Jobを追従させる ([186e50c](https://github.com/kt0319/any-console/commit/186e50cdf59b1fad2cf49498e34ce2e8c670ee20))
* Run Dispatch画面のWorkspace/Jobセレクトを既存セッション選択時も表示 ([a29a86b](https://github.com/kt0319/any-console/commit/a29a86bd74bed63987518bd638fe959595446402))
* Settingsメニューをスクロール可能にする ([8025000](https://github.com/kt0319/any-console/commit/8025000d7655b899b79395b7f764b7cf717d7a31))
* systemd Environment 値の引用符・バックスラッシュをエスケープする ([87fe984](https://github.com/kt0319/any-console/commit/87fe984ca50f972addc29da15ad3a72d893b81e4))
* tmuxコマンド一時失敗時にエージェント状態が空扱いになる不具合を修正 ([06b538f](https://github.com/kt0319/any-console/commit/06b538fbf6dff2b2d575dcb967d0ae11b52cf708))
* tmuxコマンド一時失敗時にセッション一覧が空扱いになりタブが消える不具合を修正 ([e22a6b2](https://github.com/kt0319/any-console/commit/e22a6b292c23aaa82aa5796e4d3ea5b53b79226d))
* tmux一時失敗時に生きているセッションが消える不具合を修正 ([888306a](https://github.com/kt0319/any-console/commit/888306a16e216dd4847165cd4407572f99f6b8fd))
* uninstall の symlink 解決と --list 時の一時ディレクトリ作成抑止 ([d3ca02c](https://github.com/kt0319/any-console/commit/d3ca02cf962f38394d2d538f965b2352e46996a7))
* uninstall の削除対象パスで ~ をバックエンドと同じ規則で展開する ([adc2637](https://github.com/kt0319/any-console/commit/adc2637c5c54e7734ecfa0eeadb1a43234b11176))
* サービス定義への隔離ディレクトリ永続化と E2E ポートの動的割り当て ([d7804f6](https://github.com/kt0319/any-console/commit/d7804f683ddd2e68cddb98b1032fa802d74c49fd))
* ステータスバーのChanges/ブランチ名ボタンの太字を解除 ([2f95a3b](https://github.com/kt0319/any-console/commit/2f95a3b36cfbbe61e1d311ba73f031bb2edefe06))
* ステータスバーのモバイル表示の各種崩れを修正 ([f9c29a1](https://github.com/kt0319/any-console/commit/f9c29a121f341678b2718d3c99c9183e0a3df324))
* ステータスバーのラベルを白に統一、setupでcopilotのnotify_phraseを '1. Yes' に変更 ([fd8801e](https://github.com/kt0319/any-console/commit/fd8801e4b0e2da336cfdd91b3b681a009f9e943e))
* スナップショットの変更競合と失敗時の再試行集中を修正（レビュー指摘対応） ([5f86e1e](https://github.com/kt0319/any-console/commit/5f86e1e3e729b69c316d38dbef3d8ff5667a966f))
* セッション同期ポーリングが新規タブを一時除去しチラつく問題を修正 ([50c3120](https://github.com/kt0319/any-console/commit/50c3120c193ab45fbb78cf6a26e743ba392f96fe))
* セッション復元後のタブ接続完了を待ってから初期化完了ダイアログを閉じる ([48c6c09](https://github.com/kt0319/any-console/commit/48c6c09e704b631b5396aa817da0d80cdaa5d355))
* ターミナル内でのブランチ切替後、ステータスバーへの反映遅延を修正 ([fa33008](https://github.com/kt0319/any-console/commit/fa33008a0da5b1f672fbadb5e4bca84403ab08a2))
* タブクローズ直後にセッション同期ポーリングで再表示される不具合を修正 ([670fa15](https://github.com/kt0319/any-console/commit/670fa15e5016dcc48301755f87f24c74d764fcc6))
* タブ安定化の一連の変更を撤回し 670fa15 時点の挙動へ戻す ([96227a1](https://github.com/kt0319/any-console/commit/96227a1762f1141bac830584f985641d5f2f39b7))
* タブ安定化の一連の変更を撤回し 670fa15 時点の挙動へ戻す ([9fce538](https://github.com/kt0319/any-console/commit/9fce5385e62458a556916b41e6c719f550ac2415))
* ポートプレビューで新規ポートが起動直後の空振りで恒久的に除外される不具合を修正 ([7a447c7](https://github.com/kt0319/any-console/commit/7a447c771834d4f457ee90e29dca6a6298f4da1f))
* ランチャーの config.json 読み取りを ANY_CONSOLE_DATA_DIR に追従させる ([c5b485b](https://github.com/kt0319/any-console/commit/c5b485b62220e62c56a2300c1cb99963af11ff16))
* リストア時にワークスペースセッションが素のターミナルと誤認識される問題を修正 ([6b55c05](https://github.com/kt0319/any-console/commit/6b55c055b0cb0900f9b62ce63c80d653cbbf1908))
* ローディングドットのアニメーションで文字幅が変動しないよう固定幅にする ([622fd06](https://github.com/kt0319/any-console/commit/622fd06ecab15e51614b2e3293c82d87dfea8775))
* ワークスペース一覧がステータス取得完了までLoadingのまま固まる問題を修正 ([5009aed](https://github.com/kt0319/any-console/commit/5009aed88787c34f540ffdeb7cee004ff26e942a))
* ワークスペース未解決を観測するログを追加 ([c8a5eb6](https://github.com/kt0319/any-console/commit/c8a5eb631d2d1a08fe2f71bffc55149efd859030))
* 他端末で承認済みのdispatchが自端末のキューに残り続ける問題を修正 ([c0d5501](https://github.com/kt0319/any-console/commit/c0d5501a0bf0d891eb13759b8dceb5dcd5b871ac))
* 分割解除時にアクティブタブが必ず有効になるようにし、Add paneをタブ数でガードする ([98888c1](https://github.com/kt0319/any-console/commit/98888c1fa57f8c0c3877ec4d78601eab39a348cb))
* 初期化中のブロックレイヤーを半透明の黒に変更 ([9aadb2c](https://github.com/kt0319/any-console/commit/9aadb2c445cdf10d1ae2da1be60905f858e0787a))
* 初期化中のワークスペース読み込み完了前にタブ操作ができてしまう問題を修正 ([61e0274](https://github.com/kt0319/any-console/commit/61e027485770864d6cec9f2cd33a6e38ce890bef))
* 変更を跨いだスナップショットの配信を止め、非ジョブタブのメタ更新を継続する ([7ac4e48](https://github.com/kt0319/any-console/commit/7ac4e48f6caf76b1c8f5f72ab13782ebc1fbcda6))
* 変更を跨いだスナップショットの配信を止め、非ジョブタブのメタ更新を継続する ([7fcf1ff](https://github.com/kt0319/any-console/commit/7fcf1ffa24132a4c2a11490e19c6564840ea283f))
* 新規ターミナル作成中に現在のアクティブタブが操作できてしまう問題を修正 ([3b55993](https://github.com/kt0319/any-console/commit/3b5599334b80e5ec22d16a77e04f5bcbaf1cb1ad))
* 新規タブ作成後、実際に描画されるまでブロックレイヤーを解除しない ([46b8cf0](https://github.com/kt0319/any-console/commit/46b8cf05e93a591262afb12db43f1bdc42b4ebda))
* 既にワークスペース一覧を取得済みならLoading表示なしで即座に一覧を表示する ([519c811](https://github.com/kt0319/any-console/commit/519c8118d8295a63295fa9c150b56897229b1009))
* 読み込みダイアログがブロックレイヤーの下に隠れる問題を修正 ([9a2c606](https://github.com/kt0319/any-console/commit/9a2c60641f0d35597b62399d45bd1230b4ca9d75))
* 通知設定のDispatch通知ラベルを実際の送信タイミングに合わせて修正 ([1feff4d](https://github.com/kt0319/any-console/commit/1feff4d3dd356b549b06e245095b658a54109217))
* 隔離ディレクトリのアンインストール対応とサービス定義のエスケープ処理 ([4ca60dc](https://github.com/kt0319/any-console/commit/4ca60dc5fd6809f80d03ff33e4499895de439861))
* 隔離ディレクトリ運用の残課題をレビュー指摘に沿って修正 ([c6ba852](https://github.com/kt0319/any-console/commit/c6ba85203187da705e795e8e798bbafe87c7c645))


### Performance Improvements

* git fetch系のバックグラウンド処理を専用スレッドプールに分離 ([438b813](https://github.com/kt0319/any-console/commit/438b8132af37f96c978eefe681bcac7eb8ebc1cb))
* ワークスペース一覧のworktree列挙を並列化しis_git_repoの重複呼び出しを除去 ([be8dfb2](https://github.com/kt0319/any-console/commit/be8dfb25663bcc6648d4d6b0bb7fd186ffb87aa4))


### Refactor

* Circle KeypadをSaveボタン無しの即時保存にしReset位置をTerminalと揃える ([f9fcd3b](https://github.com/kt0319/any-console/commit/f9fcd3b92e0e9d68ed0aaeaf345fe0e5364f5879))
* dispatchダイアログのセッション選択をselectboxに統合 ([db648f4](https://github.com/kt0319/any-console/commit/db648f46c498337d2fae9e3e539358fdd79ac175))
* dispatch承認ダイアログをSettingsのRun Dispatchページに置き換え ([0498ea2](https://github.com/kt0319/any-console/commit/0498ea243e3fdf8478ce237788424dfba821bb74))
* dispatch承認を完全非同期化し専用SSEをステータスストリームWSへ統合 ([9eb393e](https://github.com/kt0319/any-console/commit/9eb393e4af3c908543789081a2b26ad42e181d9c))
* GitFilesを実態に合わせてGitChangesにリネーム ([7b790cb](https://github.com/kt0319/any-console/commit/7b790cb76f5064505821626291195ae8cb0ff304))
* notify_delay_min設定を削除しフレーズ検出時に即通知にする ([ff3df4a](https://github.com/kt0319/any-console/commit/ff3df4abf7304b494b577df939a314727666e780))
* radialからcircle_keypadへの読み替えをconfigマイグレーションに移行 ([6eb3dab](https://github.com/kt0319/any-console/commit/6eb3dab24d033cba8d69f79dc1aec518baaf0f59))
* サークルキーパッドの内部命名をradialからCircleKeypadに統一 ([926f53a](https://github.com/kt0319/any-console/commit/926f53a455f5f39dcdeebfe296025b45f49743b2))
* セッション一覧をサーバ側スナップショットに集約し tmux 呼び出しを削減 ([6152d04](https://github.com/kt0319/any-console/commit/6152d042ab7a2e4694b57a5b0b0eb4f94d4f73e3))
* タブ同期を冪等 reconcile に統合しフロントの自己回復・リトライ層を削除 ([2583580](https://github.com/kt0319/any-console/commit/2583580e3e1cfdab1ef1cb5e57f30eedc6eb7061))
* メタデータ自己回復機構を削除しスナップショットの all-or-nothing に一本化 ([c1e00e6](https://github.com/kt0319/any-console/commit/c1e00e6ec893839f9894ec808edc7bc493da21e7))
* リモートブランチ一覧のGETを読み取り専用にする ([faf5a48](https://github.com/kt0319/any-console/commit/faf5a48d41d0b253668e8386a3c39c8e803b7a80))
* ローディングドットのアニメーションを共通CSSクラスに統一 ([14e53e5](https://github.com/kt0319/any-console/commit/14e53e50b3588bfe6573acd1b8623df870fce03f))
* 実態と乖離した命名をコード全体で実態に合わせて修正 ([455907f](https://github.com/kt0319/any-console/commit/455907f56078fd5bf505c4ddeee54d69d48f34f1))
* 実態と合っていない命名・コメントを修正 ([555c523](https://github.com/kt0319/any-console/commit/555c5237295e80c48f4203578c693157400f580e))
* 空きペインの分割ボタンを横/縦選択式からAdd pane単一ボタンに変更 ([66bbab3](https://github.com/kt0319/any-console/commit/66bbab366faeee891bd1578b191dc03444f1b97b))
* 設定メニューのカテゴリ分けを整理 ([8147809](https://github.com/kt0319/any-console/commit/8147809a493a1e111c4fad862cb356d5e0e31dce))


### Documentation

* setup完了時にmacOSのファイルアクセス許可案内を表示 ([f1df07f](https://github.com/kt0319/any-console/commit/f1df07fa77bdfcad8656b6dce8f1fbf2cc1e01be))
* tmux一時失敗の区別とセッション削除原則をADR 23として記録 ([9558393](https://github.com/kt0319/any-console/commit/95583934cf1abe049574f7de556c93a12f348677))
* セッション一覧スナップショット化の ADR 24 を追加 ([f92768c](https://github.com/kt0319/any-console/commit/f92768ca060ad1c77844396a0336c1dd4231a307))
* タブ安定化の全撤回と実機A/Bによる判断確定を ADR 25 として記録 ([a464ad0](https://github.com/kt0319/any-console/commit/a464ad0e261c74546efc82adae9ba954f8d93e99))
* 削除済みの後方互換コードへの言及をDECISIONS.mdで訂正 ([a08344b](https://github.com/kt0319/any-console/commit/a08344b99a26cec2b7b0ac2c4be4c9b75e8d09cb))
* 永続ファイルのパスは common.py の定数経由にする規約を追加 ([25ec9c7](https://github.com/kt0319/any-console/commit/25ec9c7f049f9a861a2eb72088b37d8a70cc9092))


### Tests

* applyDispatchQueueのスナップショット反映とダイアログ連動のテストを追加 ([1b9cade](https://github.com/kt0319/any-console/commit/1b9cade11339983ad28ecd74fb76851eaa3157f6))
* dispatch承認テストのレース条件を修正しflakyを解消 ([4eaf82b](https://github.com/kt0319/any-console/commit/4eaf82bf5acc33f3939747144d6af7fa9a3a2a33))
* E2E スモークを拡充（ワークスペース・設定全ビュー・タブ管理・ショートカット等） ([aced8be](https://github.com/kt0319/any-console/commit/aced8beb13b38c608a9661d8dfaf41bcf1f31391))
* E2E のテスト用リポジトリに git 識別情報をローカル設定する ([cb19f9d](https://github.com/kt0319/any-console/commit/cb19f9dffaaf63ca0db0b7858fa8a027ce2d421c))
* E2E の後始末が失敗時にサーバ状態を壊さないよう堅牢化 ([10ae0cf](https://github.com/kt0319/any-console/commit/10ae0cfce93d0897fc0cce7fdbacfab8fd7a6b0d))
* E2E ログインで登録した Trusted Device をテスト後に自動失効する ([d0322e0](https://github.com/kt0319/any-console/commit/d0322e00abb685af70211c683d501700528fa876))
* E2E を使い捨てサーバ自動起動に切り替える ([dab9f2c](https://github.com/kt0319/any-console/commit/dab9f2c0dfa9a5e2d27f435346e96d0b52cceef3))
* スニペットのテスト用コマンドをテストごとにユニーク生成する ([004f225](https://github.com/kt0319/any-console/commit/004f225281c0846fc16b64927d74c45b5eb6d3a8))
* スニペットの後始末をスナップショット書き戻しから差分削除に変更 ([775f3d8](https://github.com/kt0319/any-console/commit/775f3d8311739e88bd399dc9fb559914bb62d2f6))
* スニペット復元の失敗を検知して teardown を失敗させる ([5e414eb](https://github.com/kt0319/any-console/commit/5e414eb92ed3de450cc68fa6886b615dd241c320))
* セッションスナップショット失敗時に既存セッションを誤削除しないようにする ([2a6839e](https://github.com/kt0319/any-console/commit/2a6839e8159068e5abb2c6e9ab531799c41932bb))
* デタッチ再アタッチのE2Eがテスト自身のセッションのみを対象にするよう修正 ([62994cb](https://github.com/kt0319/any-console/commit/62994cbc5bf8a1b3ee61de9f66365ff9d22a71dd))
* 不正パス検証に必ず存在しない wsDir 配下のパスを使う ([1d0063c](https://github.com/kt0319/any-console/commit/1d0063c4d2ff1e2ea0a1599997b1bb08200e8aa9))


### CI

* E2Eをsmoke/full二段構成に分離しブランチpushのCIを短縮 ([539f1b2](https://github.com/kt0319/any-console/commit/539f1b22449e2e02bd710d1c657f9e15f0a281fe))

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
