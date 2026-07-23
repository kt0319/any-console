# CLAUDE.md / AGENTS.md

このファイルは、このリポジトリで作業するコーディングエージェント向けの共通ガイドです。
`CLAUDE.md` / `AGENTS.md` のどちらで参照されても同じ内容を適用します。

---

# ガードレールのレベル

このドキュメントの規約には以下の段階がある:

- **MUST / MUST NOT** — 破ったら不具合・事故に直結する。例外を作らない。
- **SHOULD / SHOULD NOT** — 原則やらない。明確な根拠があれば例外を許容する。
- **PREFER / PREFER NOT** — 推奨しない。状況により選択可能。

既存ルールは段階的にこの体系に移行する。明示ラベルが無い項目は文意から判断する。

---

# プロジェクト概要

Web操作コンソール。スマホを主軸に、PC でも同等の操作ができるブラウザ UI。Tailscale 経由でジョブ実行・Git操作・Webターミナルを提供する。

UIは **モバイルファースト** で設計しつつ、**PCでもシームレスに使える** ことを目指す（同一URL・同一機能・画面サイズや入力デバイスに応じた自然な最適化）。

OS固有機能の追加は最小限にする（クロスプラットフォームで動く方を優先する）。本番運用は tmux を前提とし、常駐サービスは Linux = systemd / macOS = launchd の二系統を一級でサポートする（`./any-console` が `uname` で分岐）。

---

# 参照ドキュメント

| ファイル | 内容 |
|---------|------|
| `README.md` | 動作要件・セットアップ・起動コマンド・認証・リポジトリ概要 |
| `docs/ARCHITECTURE.md` | モジュール一覧と設計判断の概要 |
| `docs/DECISIONS.md` | 主要な設計判断（ADRスタイル）の背景と代替案 |
| `docs/A11Y_AUDIT.md` | アクセシビリティ監査結果と TODO |
| `package.json` / `pyproject.toml` | 依存関係（ランタイム・開発） |

---

# テスト・Lint

## 新機能を追加する時のチェックリスト (**MUST**)

新しいモジュール・エンドポイント・関数を追加したら、**コミット前に以下を必ず通す**:

1. **テストを書く**: `api/` に新コードを追加したら同じ範囲をカバーする `tests/test_*.py` を追加・拡張する。UI のロジック（`ui/utils/*.js` / `ui/composables/*.js`）も同じく `tests/ui/test_*.js` に追加する。
2. **カバレッジ閾値（85%）を維持**: `pytest --cov --cov-fail-under=85` でローカル確認する。落ちたら必ずテストを足してから push する。
3. **`ruff check api/`** が clean。
4. **`mypy api/`** が clean（型注釈に `Any` 漏れがないか確認）。
5. **`npm run typecheck`** が clean（JSDoc 型注釈漏れに注意）。

CI が落ちてからの修正コミットを増やさないために、push 前に上記をひと通り実行すること。

## 注意ポイント (**MUST**)

- **`ui/app-bridge.js` の `BUS_EVENTS` は ABC ソート順を維持する**。新規イベントを追記したら必ず辞書順で挿入する（テストで sort 検証あり）。
- **`ui/utils/constants.js` の値変更**は frontend test を必ず実行する（タイミング系の数値はテスト前提）。
- 新規 BUS_EVENT を足したら呼び出し側（`emit` / `on`）と両方で使われているか確認する。

## コマンド

```bash
pytest                 # Backend
pytest --cov           # Backend coverage
npm test               # Frontend
npm run test:coverage  # Frontend coverage
npm run test:e2e       # E2E スモーク（CI でも毎回実行）
ruff check api/        # Lint
mypy                   # 型チェック
```

CI: `.github/workflows/ci.yml`（codecov 連携）

## フロントエンドテスト方針

- テスト対象の純粋関数は `ui/utils/` に切り出して実装する
- テストは実ファイルを `import` して検証する（**MUST NOT** インラインコピー — 実コードと乖離するため）
- コンポーネント単体テストは原則行わない。ただし統合テストで担保する
  - DOM 操作を含む統合テストは `tests/ui/test_integration.js` に追記する
  - ファイル先頭に `// @vitest-environment happy-dom` を記載すること
  - 環境: Vitest + happy-dom + @vue/test-utils（すべて導入済み）
- 新たに追加する純粋関数は最初から `ui/utils/` に置く
- 既存のインラインコピーは機会があれば順次 `import` 方式に移行する
- アクセシビリティは axe-core で自動検査する（`tests/ui/components/test_a11y.js` + `axe-helper.js`）。新規・変更コンポーネントは `expectNoA11yViolations()` で担保する（色コントラストは対象外 — `docs/A11Y_AUDIT.md` 参照）

## E2E スモーク

- `tests/e2e/*.spec.js` に Playwright スモークを置く（**CI の `e2e` ジョブで毎回実行**。ローカル手動実行も可）
  - `smoke.spec.js`: 認証フロー（ログイン画面・不正トークン・認証維持）
  - `settings.spec.js`: 設定モーダルの開閉（Esc / Close）とビュー遷移
  - `settings-views.spec.js`: 設定モーダルの全ビュー遷移・Auth / Config File / System Info の表示
  - `terminal.spec.js`: ターミナル起動・コマンド実行・タブ切替時の出力保持・タブクローズ確認ダイアログ
  - `tabs.spec.js`: Tabs & Sessions（タブ一覧・アクティブ切替・デタッチ / 再アタッチ・クローズ確認）
  - `shortcuts.spec.js`: グローバルショートカット（⌘⇧N / ⌘⇧W）
  - `snippets.spec.js`: スニペットの追加・削除（テスト前の状態を API で復元）
  - `workspace.spec.js`: ワークスペース登録・重複 / 不正パスエラー・削除（確認ダイアログ）
  - `workspace-panes.spec.js`: ワークスペース詳細（Files / Changes+Commit / History / Branches / Jobs / Stash）とディープリンク（テスト用 git リポジトリを一時領域に作成）
  - `split.spec.js`: ピルドラッグによるターミナル分割
  - `preview.spec.js`: Port Preview の検出と proxy 経由アクセス
  - `mobile.spec.js`: モバイルビューポート（375px）での主要フロー
  - `mobile-terminal.spec.js`: モバイルでのターミナル + KeyboardBar 表示
  - 共通ヘルパー（ログイン・セッション後始末・設定モーダル操作・Bearer ヘッダ）は `helpers.js`
- 重要な体験フロー（ログイン → メイン画面遷移）が壊れていないか確認する用途
- **既定は使い捨てサーバモード**: `ANY_CONSOLE_URL` 未指定なら `playwright.config.js` の `webServer` が、一時ディレクトリを data 領域にしたサーバをポート 8899 で自動起動する（`ANY_CONSOLE_DATA_DIR` による隔離。実運用の `data/`・`config.json` には一切触れない）。レート制限引き上げ（`ANY_CONSOLE_RATE_LIMIT=2000`）とテスト用トークンも自動設定される。サーバ実行に python3（バックエンド依存インストール済み）と tmux が必要。CI（`.github/workflows/ci.yml`）も同じ仕組みで動く
- 起動済みの外部サーバに対して実行する場合のみ `ANY_CONSOLE_URL` を指定する。このときは対象サーバをレート制限を引き上げて起動しておく（既定 200req/60s のままだと連続実行で 429 になる）
- テストがサーバ状態を汚さないこと (**MUST**): セッション等を作るテストは自分が作った分だけを必ず後始末する（`helpers.js` の `cleanupNewSessions` を使う。既存セッションには触れない）。使い捨てサーバモードでも tmux セッション自体はホストの tmux サーバに作られるため、この後始末は省略しない
- ローカル初回セットアップ:
  ```bash
  npm install
  npx playwright install chromium
  pip install -r requirements.txt   # 使い捨てサーバモードでサーバを起動するため
  ```
- 実行前に `npm run build` で `ui/dist` を最新化する（サーバは `ui/dist` を配信する。未ビルド・古いままだと E2E が現行フロントを検証できない。CI は毎回ビルドしてから実行する）
- ローカル実行:
  ```bash
  npm run test:e2e                                     # 使い捨てサーバで実行（推奨）
  ANY_CONSOLE_URL=http://localhost:8888 npm run test:e2e  # 起動済みサーバに対して実行
  ```

---

# UIルール

## 入力デバイス

モバイルを主軸とし、PC ではそれをサポートする形で UI を提供する。

### Mobile

- tap
- swipe

を基本とする。

### PC

モバイル UI を踏襲しつつ、補助的に

- keyboard shortcut
- hover

を活用する。

## 画面設計

- 広い画面では情報密度を上げる
- 無意味な余白を増やさない

## タップターゲット

- 推奨: 44x44 px
- 最低: 24x24 px
- 24px を使う場合: 10px 以上の余白を確保

---

# Confirm Rules

破壊的操作は必ず確認ダイアログを挟むこと (**MUST**)。

対象例:

- file delete
- branch delete
- commit 破棄 / reset --hard
- stash drop
- force push
- terminal session close
- 設定リセット
- token revoke

## 実装

`useConfirm()` を使う (**MUST**)。`window.confirm()` は使わない (**MUST NOT** — フォーカストラップ等を持つ独自実装に統一するため)。

## メッセージ

英語で記述。何が起きるかを明示する。

例:

```text
Delete file "foo.txt"? This cannot be undone.
```

影響が特に大きい操作（force push、全消去など）は、対象名の入力など追加の確認ステップを検討する。

---

# CSSルール

## hover

hover は PC のみ。

```css
@media (hover: hover) and (pointer: fine)
```

で guard する。

## Clickable

クリック可能要素は:

- background
- border

などで視覚区別する。下線リンク風は使わない。

## 状態変化

JS class 切替で表現。

例:

- `.active`
- `.selected`

## backdrop-filter

`backdrop-filter` の使用 (**SHOULD NOT** — Safari 等で挙動が壊れるケースがあるため。検証済みかつ代替手段がない場合のみ例外)

## アクセシビリティ

- すべての操作にキーボードで到達可能であること (**MUST**)
- モーダルはフォーカストラップを実装し、Esc で閉じられること (**MUST**)
- アイコンのみのボタンには `aria-label` を付けること (**SHOULD**)
- アイコンのみのボタンには `data-tooltip` 属性で hover ヒントを併設すること（`aria-label` と同じ文言）(**SHOULD** — ネイティブ `title` は表示が小さく遅いため、`ui/styles/a11y.css` 内のカスタムCSSツールチップを使う)
- 色のみで状態を示さないこと（アイコン・テキストを併用）(**SHOULD**)
- WCAG AA 相当のコントラストを目安にする (**PREFER**)
- 詳細は `docs/A11Y_AUDIT.md` を参照

---

# Frontend設計ルール

## API endpoint

`ui/utils/endpoints.js` を使用 (**MUST** — URL ハードコード禁止)。

## timer

`setTimeout` / `setInterval` 等の時間値、ブレークポイント等の数値定数は `ui/utils/constants.js` に定義する (**MUST** — 直書き禁止)。

## API error

優先:

```js
apiGet(..., {
  errorMessage: "..."
})
```

`emit("toast:show")` を直接使う (**PREFER NOT** — `apiGet` の `errorMessage` を優先するが、状況により直接 emit も可)

## Component size

300行超のコンポーネントは責務分離を検討する (**SHOULD** — composables 抽出を優先。ただし単純な template 増加や明確にまとまった責務による増加は許容)

---

# Backend APIルール

## Error field

エラーフィールドは `detail` を使用 (**MUST** — `message` は使わない)。

## Exception

具体的例外を指定する (**MUST NOT** 裸の `except Exception`)。

## subprocess

失敗時は `OSError` も捕捉する (**MUST**)。

---

# コミットメッセージ

日本語で Conventional Commits 形式で書くこと (**MUST**)。

- 形式: `type: 日本語の説明`
- type: `feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `build` / `ci` / `deps`
- スコープは使わない（シンプルに保つ）

例:

```text
feat: ターミナルの選択中に Ctrl+C をコピーに割り当てる
fix: ブランチパネルの Fetch 完了トーストの表示順を修正
docs: README に Tailscale HTTPS 設定の手順を追加
```

CHANGELOG は release-please が `type:` から自動生成するため、英語タイトルや雑な要約を避けること。

---

# エージェント向け方針

既存設計・命名・UIトーンを優先すること。

以下は行わない:

- 大規模リファクタリング
- 設計変更
- 命名変更
- UI思想変更

既存コードとの整合性を重視する。

主要な設計判断と背景については `docs/DECISIONS.md` を参照すること。
