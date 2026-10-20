import { isHonor, toCounts } from './tiles.js';
import { canWin } from './rules.js';

// 一张牌在手牌中的"有用程度"：对子/刻子和相邻的牌越多越有用
function tileValue(tile, counts) {
  let value = (counts[tile] - 1) * 4;
  if (!isHonor(tile)) {
    const pos = tile % 9;
    for (const d of [-2, -1, 1, 2]) {
      const p = pos + d;
      if (p < 0 || p > 8) continue;
      if (counts[tile + d] > 0) value += Math.abs(d) === 1 ? 2 : 1;
    }
    // 中张比边张更容易组顺子
    if (pos >= 2 && pos <= 6) value += 0.5;
  }
  return value;
}

// 选择打出价值最低的牌
export function chooseDiscard(hand) {
  const counts = toCounts(hand);
  let best = hand[0];
  let bestValue = Infinity;
  for (const t of new Set(hand)) {
    const v = tileValue(t, counts);
    if (v < bestValue) {
      bestValue = v;
      best = t;
    }
  }
  return best;
}

// 碰了之后不会拆掉已有的顺子搭子才碰：简单起见，字牌和孤立的对子就碰
export function shouldPeng(hand, tile) {
  const counts = toCounts(hand);
  if (isHonor(tile)) return true;
  const pos = tile % 9;
  const neighbor = (d) => pos + d >= 0 && pos + d <= 8 && counts[tile + d] > 0;
  return !(neighbor(-1) || neighbor(1));
}

export function shouldWin(hand) {
  return canWin(hand);
}
