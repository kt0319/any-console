// QWERTY パネルのキーラベル表示とフリック判定の純粋関数。
import { QWERTY_FLICK_THRESHOLD } from "./constants.ts";

type QwertyKeyDef = {
  label?: string;
  key: string;
  flickUp?: string;
  flickUpLabel?: string;
  flickDown?: string;
  noSymbol?: boolean;
};

// shift 中は 1 文字キーを大文字で表示する。
export function qwertyDisplayLabel(keyDef: QwertyKeyDef, shift: boolean) {
  if (shift && keyDef.key?.length === 1) return keyDef.key.toUpperCase();
  return keyDef.label || keyDef.key;
}

// 記号ビュー中は flickUp の記号を表示する (noSymbol キーは除く)。
export function qwertySymbolLabel(keyDef: QwertyKeyDef, shift: boolean, symbolView: boolean) {
  if (symbolView && keyDef.flickUp && !keyDef.noSymbol) return keyDef.flickUp;
  return qwertyDisplayLabel(keyDef, shift);
}

export function qwertyHasFlick(keyDef: QwertyKeyDef) {
  return !!keyDef.flickUp || !!keyDef.flickDown;
}

export function qwertyFlickUpLabel(keyDef: QwertyKeyDef) {
  return keyDef.flickUpLabel || keyDef.flickUp || "";
}

// 縦フリックの判定。{ key } を返したらフリックとして処理済み
// (key が falsy の場合は何も送らない)。null ならタップ扱い。
export function resolveQwertyVerticalFlick(dy: number, keyDef: QwertyKeyDef) {
  if (qwertyHasFlick(keyDef) && dy < -QWERTY_FLICK_THRESHOLD) {
    return { key: keyDef.flickUp || null };
  }
  if (keyDef.flickDown && dy > QWERTY_FLICK_THRESHOLD) {
    return { key: keyDef.flickDown };
  }
  return null;
}

// fn ビューの数字キー: 上フリックで F1〜F10、それ以外は数字キーを返す。
export function resolveFnNumberKey(dy: number, keyDef: QwertyKeyDef) {
  if (keyDef.flickUp && dy < -QWERTY_FLICK_THRESHOLD) return keyDef.flickUp;
  return keyDef.key;
}
