# Architecture

## 設計上の決定事項

- **単一プロセス強制** — `_acquire_singleton_lock` により `uvicorn --workers > 1` を拒否。ターミナルセッション・レートリミッタ・TTLキャッシュをプロセス内状態で保持するため
- **Git操作は subprocess のみ** — Git ライブラリを使わない
- **tmux** をセッション永続化の基盤に使用。ブラウザを閉じてもセッションが残る
- **認証は単一トークン** — ユーザー区別なし。初回起動時に自動生成、`data/auth.json` に保存

## 変更時の注意

| 対象 | 注意点 |
|------|--------|
| `stores/*.js` | 複数コンポーネントから参照。export 名変更は広範囲に影響 |
| `composables/useApi.js` | API通信の共通層。レスポンス形式の変更は全呼び出し元に影響 |
| `utils/constants.js` | 参照元を grep で確認してから変更 |
| `app-bridge.js` | イベントバス。イベント名変更は emit/on 両側を確認 |
