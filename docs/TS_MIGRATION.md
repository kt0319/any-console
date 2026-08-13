# フロントエンド TypeScript 移行計画

> **Note (2026-08)**: 本移行は P7（仕上げ）まで**完了済み**。`ui/` の実装は
> `.ts` / `<script setup lang="ts">` に統一され、`npm run typecheck`（vue-tsc）が
> テンプレート含めて型検査する。このドキュメントは計画・実施記録として保存している。
> 残フォローアップ: `noImplicitAny` の有効化（試行時点で 356 件 — 元々 JSDoc 注釈が
> 無かった箇所の暗黙 any。段階的に注釈を足してから有効化する）。

フロントエンド（`ui/` 配下の Vue 3 アプリ）を JavaScript + JSDoc 型注釈から TypeScript へ移行するための計画・実施記録。

- 対象規模: `ui/**/*.js` 179 ファイル + `.vue` SFC 76 ファイル
- 挙動・API 契約・UI は**変更しない**。リネームと型注釈の書き換えのみ（ロジック変更禁止）
- 既存のフロントエンドテスト（Vitest 1,100+ 件）と E2E（Playwright）を回帰検証の要とする

---

## 1. 目的と期待効果

| 項目 | 現状 (JS + JSDoc) | 移行後 (TS) |
|------|-------------------|-------------|
| 型注釈 | JSDoc コメント（冗長・エディタ支援が弱い） | ネイティブ構文。リファクタ・補完が強くなる |
| `.vue` の型検査 | 対象外（`jsconfig.json` は `.js` のみ） | `vue-tsc` で `<script setup lang="ts">` + template を検査 |
| 検査の厳しさ | `checkJs` + `strictNullChecks`（`noImplicitAny` は無効） | 同等以上を維持し、移行完了後に段階的に強化 |

## 2. 移行戦略: 下層から段階的に変換

依存の向きは `utils/data` ← `stores` ← `composables` ← エントリ ← `components`（逆依存なし）なので、
下層のディレクトリから順に丸ごと `.ts` 化する。各フェーズは
**`npm run typecheck` / `npm test` / `npm run build` がすべて green の状態でコミット**する。

| フェーズ | 対象 | 内容 |
|---------|------|------|
| P1 | 基盤 | `jsconfig.json` → `tsconfig.json`（`allowJs`/`checkJs` で JS/TS 共存）、`vue-tsc` 導入、`ui/env.d.ts` 追加 |
| P2 | `ui/utils` + `ui/data` | 73 ファイルを `.ts` 化。coverage include も更新 |
| P3 | `ui/stores` | 8 ファイルを `.ts` 化 |
| P4 | `ui/composables` | 95 ファイルを `.ts` 化 |
| P5 | エントリ | `vue-main` / `app-bridge` を `.ts` 化(jsconfig 時代の exclude を解除)、`index.html` 更新。`ui/` の `.js` が sw.js のみになったため `checkJs` を無効化(未変換 `.vue` の JS script が import 経由で検査対象に入るのを防ぐ。従来どおり P6 の `lang="ts"` 化で検査対象になる) |
| P6 | `ui/components` | 全 SFC を `<script setup lang="ts">` 化し、`tsconfig` の include に `ui/**/*.vue` を追加 |
| P7 | 仕上げ | `noImplicitAny` 有効化、ドキュメント更新、最終検証 |

## 3. 変換ルール

- **リネームは `git mv`** で行い、履歴の追跡性を保つ。
- **JSDoc の型注釈は TS ネイティブ注釈へ変換する**（`.ts` ファイル内の JSDoc 型は検査に使われないため、
  放置すると暗黙 any 化して現状より弱くなる）。説明文としての JSDoc コメントは残す。
- **import 指定子は既存規約（拡張子明示）を踏襲**し、`./foo.js` → `./foo.ts` に更新する
  （`allowImportingTsExtensions` + Vite で解決。テスト側 `tests/ui` の import も同時に更新する）。
- テストファイル（`tests/ui/**/*.js`）自体の TS 化は本移行のスコープ外（import パス更新のみ）。
- `ui/sw.js` は Vite バンドルを通らない生コピー配信（`vite.config.js` の `copy-static`）のため **JS のまま残す**。

## 4. 検証

- 各フェーズ: `npm run typecheck` / `npm test` / `npm run build`
- 最終フェーズ: 上記に加えて E2E スモーク（`npm run test:e2e:smoke`）
