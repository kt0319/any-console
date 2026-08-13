// 円形キーパッドの幾何計算（純粋関数）。useCircleKeyPad から分離してテスト可能にする。

const SPECIAL_WIDTH = 80;
const SPECIAL_HEIGHT = 34;
const SPECIAL_OFFSET = 100;
const CIRCLE_KEYPAD_DEADZONE_PX = 40;
// 各セクターの中心 ±SECTOR_HALF° のみキー判定。隙間（中心から ±18°超〜±22.5°）はキャンセル。
const SECTOR_HALF_DEG = 18;

// N から時計回り 45° 刻みで 8 セクター。
export const CIRCLE_KEYPAD_ANGLES = [-90, -45, 0, 45, 90, 135, 180, -135];

// 四隅の配置順: 左上 / 右上 / 左下 / 右下（store の specials と同じ順）。
export const SPECIAL_POSITIONS = [
  { offsetX: -SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET },
  { offsetX:  SPECIAL_OFFSET, offsetY: -SPECIAL_OFFSET },
  { offsetX: -SPECIAL_OFFSET, offsetY:  SPECIAL_OFFSET },
  { offsetX:  SPECIAL_OFFSET, offsetY:  SPECIAL_OFFSET },
];

export const SPECIAL_BUTTON_SIZE = { width: SPECIAL_WIDTH, height: SPECIAL_HEIGHT };

/**
 * 起点からの相対座標 (dx, dy) が四隅スペシャルボタンの矩形内なら "special:i" を返す。
 */
export function specialIdAt(dx: number, dy: number): string | null {
  const halfW = SPECIAL_WIDTH / 2;
  const halfH = SPECIAL_HEIGHT / 2;
  for (let i = 0; i < SPECIAL_POSITIONS.length; i++) {
    const p = SPECIAL_POSITIONS[i];
    if (dx >= p.offsetX - halfW && dx <= p.offsetX + halfW
      && dy >= p.offsetY - halfH && dy <= p.offsetY + halfH) {
      return `special:${i}`;
    }
  }
  return null;
}

/**
 * 起点からの相対座標 (dx, dy) からセクター index を判定する。
 * デッドゾーン内、またはどのセクター中心からも SECTOR_HALF_DEG 以上離れていれば null。
 */
export function sectorIndexFromDelta(dx: number, dy: number): number | null {
  const dist = Math.hypot(dx, dy);
  if (dist < CIRCLE_KEYPAD_DEADZONE_PX) return null;
  const deg = Math.atan2(dy, dx) * (180 / Math.PI);
  for (let i = 0; i < CIRCLE_KEYPAD_ANGLES.length; i++) {
    let diff = deg - CIRCLE_KEYPAD_ANGLES[i];
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    if (Math.abs(diff) < SECTOR_HALF_DEG) return i;
  }
  return null;
}
