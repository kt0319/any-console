# アクセシビリティ監査レポート

## 監査情報

- **監査日**: 2026-05-22
- **対象リビジョン**: 0a7d8c8b5bf3bb54622238bb1eeb09b6a82fe5e2
- **監査手法**: 手動コードレビュー（自動ツール未使用）

## 監査範囲

- タブ・ボタン・ダイアログの ARIA 属性（role, aria-label, aria-expanded 等）
- フォーカス管理（フォーカストラップ、Esc キー、focus-visible）
- キーボードナビゲーション
- スクリーンリーダー対応（アイコンボタンの代替テキスト）
- ローディング・エラー状態の通知
- タップターゲットサイズ

---

## 検出した問題

| # | ファイル | 行 | 問題 | 影響 | 緊急度 | 推奨対応 |
|---|---------|-----|------|------|--------|---------|
| 1 | ConfirmDialog.vue | 2–9 | `role="dialog"`, `aria-modal`, Esc キー, フォーカス管理がすべて欠落 | ダイアログがスクリーンリーダーに認識されない。Esc でキャンセル不可 | **High** | role/aria-modal/Esc/フォーカス管理を追加 |
| 2 | AppToast.vue | 4–11 | `role="alert"` / `aria-live` なし | エラー・成功メッセージがスクリーンリーダーに読まれない | **High** | エラーに role="alert"、それ以外に role="status" |
| 3 | FileBrowser.vue | 26–32 | アイコンのみのボタン4本に `aria-label` なし | ボタンの目的がスクリーンリーダーに伝わらない | **High** | 各ボタンに aria-label を追加 |
| 4 | Modal.vue | 24, 295 | 閉じるボタンに `aria-label` なし / `outline: none` でフォーカス不可視 | SR に "×" と読まれる。キーボードユーザーがフォーカス位置を見失う | **High** | aria-label="Close" + :focus-visible スタイル |
| 5 | グローバル (全体) | — | `:focus-visible` スタイル定義なし | キーボードユーザーがフォーカス位置を把握できない | **High** | グローバル :focus-visible ルールを追加 |
| 6 | Modal.vue | 全体 | フォーカストラップは useModal で実装済みだが、モーダル外 DOM にフォーカスが逃げる場合がある | キーボードユーザーがモーダル背面の要素にアクセスできる可能性 | Medium | useModal の trapFocus を検証・強化 |
| 7 | WorkspaceJobsPane.vue | 4, 42 | ジョブ行が `<div>` + click で `role="button"` なし | スクリーンリーダーがボタンと認識しない | Medium | role="button" + tabindex="0" + キーボードハンドラ追加 |
| 8 | GitActionBtn.vue | 全体 | `title` prop が渡されるが `aria-label` として機能していない | SR に Push/Pull 等のラベルが伝わらない可能性 | Medium | title ではなく aria-label を使用 |
| 9 | ScreenMain.vue | 全体 | タブバーのタブに `role="tab"` / `aria-selected` なし | SR にタブ構造が伝わらない | Medium | role="tablist" / role="tab" / aria-selected を追加 |
| 10 | FileBrowser.vue | 47 | Loading メッセージに `role="status"` なし | SR にローディング状態が伝わらない | Low | role="status" aria-live="polite" を追加 |
| 11 | 色コントラスト | 全体 | `--text-muted` のコントラスト比が WCAG AA を下回る可能性 | 弱視ユーザーが補助テキストを読めない恐れ | Low | コントラスト比を計測し調整 |

---

## 今回修正した問題（5件）

### Fix 1: ConfirmDialog — ARIA + Esc キー + フォーカス管理

**ファイル**: `ui/components/ConfirmDialog.vue`

- `role="dialog"`, `aria-modal="true"`, `aria-describedby` を追加
- `visible` を `watch` して Esc キーリスナーを mount/unmount
- ダイアログ表示時に Cancel ボタンへ自動フォーカス
- ダイアログ閉鎖時に元の focused 要素へフォーカスを戻す

### Fix 2: AppToast — role="alert" / role="status"

**ファイル**: `ui/components/AppToast.vue`

- `toast-error` → `role="alert"` + `aria-live="assertive"`（即時読み上げ）
- `toast-success`, `toast-info` → `role="status"` + `aria-live="polite"`

### Fix 3: FileBrowser — アイコンボタン aria-label

**ファイル**: `ui/components/FileBrowser.vue`

- 「履歴/ファイル切り替え」ボタン → `:aria-label="showHistory ? 'Show file' : 'Show history'"`
- 「隠しファイル表示」ボタン → `:aria-label="showHidden ? 'Hide hidden files' : 'Show hidden files'"`
- 「エディタで開く」ボタン → `aria-label="Open in editor"`
- 「アップロード」ボタン → `aria-label="Upload files"`
- アイコンの `<span>` に `aria-hidden="true"` を追加

### Fix 4: Modal 閉じるボタン — aria-label + focus-visible

**ファイル**: `ui/components/Modal.vue`

- `×` ボタンに `aria-label="Close"` を追加
- `outline: none` を削除し、`:focus-visible` スタイルを追加（accent カラーの 2px outline）

### Fix 5: グローバル focus-visible

**ファイル**: `ui/styles/a11y.css`（新規）、`ui/vue-main.js`

- `:focus:not(:focus-visible) { outline: none }` でマウス操作時の ring を除去
- `:focus-visible { outline: 2px solid var(--accent) }` でキーボード操作時の ring を追加
- `vue-main.js` で import

---

## 今後の TODO

| 優先度 | 問題 | 対応方針 |
|--------|------|---------|
| ~~Medium~~ 完了 | ~~タブバーに `role="tablist"` / `role="tab"` / `aria-selected` が未実装~~ → `TabBar.vue` に `role="tablist"`、`TabItem.vue` に `role="tab"` / `aria-selected` / 選択中タブの `tabindex="0"` を追加（`test_a11y.js` で担保） | — |
| ~~Medium~~ 完了 | ~~WorkspaceJobsPane のジョブ行（`<div>`）に `role="button"` 等が未実装~~ → ジョブ行を「実行 `<button>` + 編集 `<button>` の兄弟」構造に変更（操作要素のネストを避けつつキーボード操作可能化、`test_WorkspaceJobsPane.js` で担保） | — |
| ~~Medium~~ 完了 | ~~GitActionBtn の `title` prop を `aria-label` として使用するよう修正~~ → `aria-label` を併設済み（自動検査で担保） | — |
| ~~Low~~ 完了 | ~~FileBrowser の Loading / Error メッセージに `role="status"` / `role="alert"` を追加~~ → Loading に `role="status"` + `aria-live="polite"`、エラーに `role="alert"` を付与（`test_a11y.js` で担保） | — |
| ~~Low~~ 完了 | ~~`--text-muted` のコントラスト比を WCAG AA（4.5:1）で検証~~ → `#6e7599` は `--bg-primary` 上 3.80:1 / `--bg-secondary` 上 3.24:1 のため、`#919bc4`（primary 6.26:1 / secondary 5.33:1 / tertiary 4.56:1）へ調整 | — |
| ~~Low~~ 完了 | ~~PromptDialog のフォーカストラップ実装（useModal の trapFocus を適用）~~ → `BaseDialog` 経由で Esc / フォーカストラップ / フォーカス復元を適用済み（`test_a11y.js` で担保） | — |

---

## 追加で確立した規約

監査後に CLAUDE.md（UIルール → アクセシビリティ）に追記したルール:

- アイコンのみのボタンには `aria-label` に加え、**`data-tooltip` も併設**して PC では hover でヒント表示する（**SHOULD**）
- `data-tooltip` と `aria-label` は同じ文言を使う（ネイティブ `title` は表示が小さく遅いため使わず、`ui/utils/tooltip.ts` の共通ツールチップを使う — 当初は `title` 併設ルールだったが後日変更）

---

## 自動検査（導入済み）

手動監査に加え、**axe-core を Vitest + happy-dom に統合した自動検査**を導入済み。
CI（`npm run test:coverage`）で毎回実行され、構造的な a11y 違反の再混入を継続的に担保する。

- 共通ヘルパー: `tests/ui/components/axe-helper.js`（`expectNoA11yViolations(element)`）
- テスト: `tests/ui/components/test_a11y.js` / `test_WorkspaceJobsPane.js`
- 対象ルール: WCAG 2.0 / 2.1 の A・AA タグ
- **除外**: `color-contrast`（happy-dom はレイアウト/描画を持たず計測不能）
- **検査済みコンポーネント**: `tests/ui/components/test_a11y.js` の `describe` 一覧を参照（個別列挙は陳腐化するためやめた。導入時は 7 件、以後順次拡張）

自動検査で新たに検出・修正した違反:

- **PromptDialog**: 入力 `<input>` にラベルが無い（critical / `label`）→ `aria-label` を追加
- **GitActionBtn**: アイコンボタンにアクセシブルネームが無い（critical / `button-name`、TODO #8）→ `aria-label` を追加
- **SplitModeSelector**: アイコンのみの分割モードボタンにアクセシブルネームが無い（critical / `button-name`）→ `aria-label` + `title` + `aria-pressed` を追加
- **WorkspaceJobsPane**: ジョブ行のクリッカブル `<div>` がキーボード操作不可（TODO #7）→ 実行 `<button>` + 編集 `<button>` の兄弟構造に変更

### 自動検査でカバーできない範囲（引き続き手動 / 別ツール）

- **色コントラスト** — `color-contrast` は happy-dom で計測不能。Lighthouse / DevTools / 手動で検証する
- **実機スクリーンリーダー** — VoiceOver / TalkBack / NVDA での確認
- **未カバーのコンポーネント** — `test_a11y.js` の対象を順次拡張する

### 検査対象の追加方法

`tests/ui/components/test_a11y.js` に対象コンポーネントを mount し、
`expectNoA11yViolations(wrapper.element)` を呼ぶテストを追記する。

---

## 当初監査（2026-05）時点の限界

- **自動ツール未使用**: 色コントラスト比は数値計測なし（→ 後日数値計測し `--text-muted` を調整済み。上記 TODO 参照。axe-core では引き続き計測不可）
- **スクリーンリーダー実機テスト未実施**: VoiceOver / TalkBack / NVDA での動作確認なし
- **キーボード実機テスト未実施**: Tab 順序は静的解析のみ
- **カバレッジ**: 主要コンポーネントのみ。全コンポーネントの網羅的な検査は未実施（自動検査の対象は `test_a11y.js` で順次拡張中）
