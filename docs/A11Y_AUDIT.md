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
| Medium | タブバーに `role="tablist"` / `role="tab"` / `aria-selected` が未実装 | ScreenMain.vue のタブ要素に追加 |
| Medium | WorkspaceJobsPane のジョブ行（`<div>`）に `role="button"` / `tabindex="0"` / キーボードハンドラが未実装 | クリッカブル div を button に変更するか role を付与 |
| Medium | GitActionBtn の `title` prop を `aria-label` として使用するよう修正 | `title` を `aria-label` に変更、または両方設定 |
| Low | FileBrowser の Loading / Error メッセージに `role="status"` / `role="alert"` を追加 | v-if 切り替えの要素に role を付与 |
| Low | `--text-muted` のコントラスト比を WCAG AA（4.5:1）で検証 | ブラウザの DevTools または axe-core で計測 |
| Low | PromptDialog のフォーカストラップ実装（useModal の trapFocus を適用） | useConfirm と同様に対応 |

---

## ツール導入提案

現在の監査は手動コードレビューのみで実施。以下のツール導入を別タスクとして検討：

- **axe-core** — DOM ベースの自動監査。Vitest + happy-dom 環境に統合可能
- **@axe-core/vue** — Vue コンポーネント向けのランタイム検査（開発モードのみ）
- **Lighthouse** — ブラウザでのページ全体コントラスト・セマンティクス検査

ツール導入は実装コストが低く、継続的な監査自動化に有効。

---

## 監査の限界

- **自動ツール未使用**: 色コントラスト比は数値計測なし（目視のみ）
- **スクリーンリーダー実機テスト未実施**: VoiceOver / TalkBack / NVDA での動作確認なし
- **キーボード実機テスト未実施**: Tab 順序は静的解析のみ
- **カバレッジ**: 主要コンポーネント（Modal, ConfirmDialog, FileBrowser, AppToast, WorkspaceJobsPane, GitActionBtn）のみ。全コンポーネント（約40件）の網羅的な検査は未実施
