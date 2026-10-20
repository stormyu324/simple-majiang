// 手牌分析：支持赖子（万能牌）的胡牌判定、听牌、向听数
// counts 是长度 34 的数组（每种牌几张），w 是手里赖子的张数（赖子不计入 counts）
import { TILE_KINDS, isHonor, toCounts } from './tiles.js';

const suitStart = (t) => t - (t % 9);

// 剩下的牌（含 w 张赖子）能否全部组成面子（刻子/顺子）
export function canMelds(counts, w, pungOnly = false) {
  let i = 0;
  while (i < TILE_KINDS && counts[i] === 0) i++;
  if (i === TILE_KINDS) return w % 3 === 0;

  // 刻子：用 k 张真牌 + (3-k) 张赖子
  for (let k = Math.min(3, counts[i]); k >= 1; k--) {
    if (3 - k > w) break;
    counts[i] -= k;
    const ok = canMelds(counts, w - (3 - k), pungOnly);
    counts[i] += k;
    if (ok) return true;
  }
  if (pungOnly || isHonor(i)) return false;

  // 顺子：i 是剩下的最小一张，可以是顺子的第 1、2、3 张（比它小的位置只能用赖子）
  const base = suitStart(i);
  for (let s = Math.max(base, i - 2); s <= i && s <= base + 6; s++) {
    let need = 0;
    const used = [];
    for (let m = s; m < s + 3; m++) {
      if (m === i || (m > i && counts[m] > 0)) used.push(m);
      else need++;
    }
    if (need > w) continue;
    for (const m of used) counts[m]--;
    const ok = canMelds(counts, w - need, pungOnly);
    for (const m of used) counts[m]++;
    if (ok) return true;
  }
  return false;
}

// 标准胡：一对将 + 若干面子。pairOk(tile) 限制哪些牌能做将（如 258 将）
export function standardWin(counts, w, { pairOk = () => true, pungOnly = false } = {}) {
  const total = counts.reduce((a, b) => a + b, 0) + w;
  if (total % 3 !== 2) return false;
  for (let p = 0; p < TILE_KINDS; p++) {
    if (!counts[p] || !pairOk(p)) continue;
    const real = Math.min(2, counts[p]);
    if (2 - real > w) continue;
    counts[p] -= real;
    const ok = canMelds(counts, w - (2 - real), pungOnly);
    counts[p] += real;
    if (ok) return true;
  }
  // 两张赖子做将
  return w >= 2 && canMelds(counts, w - 2, pungOnly);
}

// 七对：返回 null（不是七对）或 { dragons }（几个四张一样的，龙七对用）
export function sevenPairs(counts, w) {
  const total = counts.reduce((a, b) => a + b, 0) + w;
  if (total !== 14) return null;
  let singles = 0;
  let dragons = 0;
  for (const c of counts) {
    if (c % 2) singles++;
    if (c === 4) dragons++;
  }
  if (singles > w) return null;
  // 剩下的赖子两两成对，也可以和已有的对子凑成四张
  return { dragons };
}

// ---------- 给电脑用：向听数（还差几步听牌，-1 表示已经胡了） ----------

function meldShanten(counts, open) {
  // 经典递归：数面子和搭子
  let best = 8;
  const scan = (i, melds, partials, pair) => {
    while (i < TILE_KINDS && counts[i] === 0) i++;
    if (i === TILE_KINDS) {
      const m = Math.min(melds + open, 4);
      const p = Math.min(partials, 4 - m);
      let s = 8 - 2 * m - p - (pair ? 1 : 0);
      best = Math.min(best, s);
      return;
    }
    if (counts[i] >= 3) {
      counts[i] -= 3; scan(i, melds + 1, partials, pair); counts[i] += 3;
    }
    if (!isHonor(i) && i % 9 <= 6 && counts[i + 1] && counts[i + 2]) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--;
      scan(i, melds + 1, partials, pair);
      counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
    if (counts[i] >= 2) {
      counts[i] -= 2;
      if (!pair) scan(i, melds, partials, true);
      scan(i, melds, partials + 1, pair);
      counts[i] += 2;
    }
    if (!isHonor(i)) {
      for (const d of [1, 2]) {
        if (i % 9 + d <= 8 && counts[i + d]) {
          counts[i]--; counts[i + d]--;
          scan(i, melds, partials + 1, pair);
          counts[i]++; counts[i + d]++;
        }
      }
    }
    counts[i]--; scan(i + 1, melds, partials, pair); counts[i]++;
  };
  scan(0, 0, 0, false);
  return best;
}

// tiles 为手牌（不含已经碰/杠出的牌），openMelds 为已经亮出的面子数
export function shanten(tiles, { wild = () => false, openMelds = 0, allowSevenPairs = false } = {}) {
  const counts = new Array(TILE_KINDS).fill(0);
  let w = 0;
  for (const t of tiles) (wild(t) ? w++ : counts[t]++);
  let s = meldShanten(counts, openMelds) - w;
  if (allowSevenPairs && openMelds === 0) {
    let pairs = 0;
    let kinds = 0;
    for (const c of counts) {
      if (c >= 2) pairs++;
      if (c) kinds++;
    }
    const sp = 6 - pairs + Math.max(0, 7 - kinds) - w;
    s = Math.min(s, sp);
  }
  return Math.max(s, -1);
}

export { toCounts };
