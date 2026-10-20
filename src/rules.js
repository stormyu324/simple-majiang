import { TILE_KINDS, isHonor, toCounts } from './tiles.js';

// 判断剩余的牌能否全部组成顺子或刻子
function canFormMelds(counts) {
  let i = 0;
  while (i < TILE_KINDS && counts[i] === 0) i++;
  if (i === TILE_KINDS) return true;

  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = canFormMelds(counts);
    counts[i] += 3;
    if (ok) return true;
  }

  // 顺子（字牌不能组顺子，且不能跨花色）
  if (!isHonor(i) && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    const ok = canFormMelds(counts);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
    if (ok) return true;
  }

  return false;
}

function isSevenPairs(counts, total) {
  return total === 14 && counts.every((c) => c === 0 || c === 2);
}

// hand 为手牌（不含已碰出的牌），张数应为 3n+2
export function canWin(hand) {
  if (hand.length % 3 !== 2) return false;
  const counts = toCounts(hand);
  if (isSevenPairs(counts, hand.length)) return true;

  for (let i = 0; i < TILE_KINDS; i++) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      const ok = canFormMelds(counts);
      counts[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

// 听牌：hand 为 3n+1 张时，再来哪些牌就能胡。
// visible 是自己能看到的所有牌（手牌 + 碰出的牌），已经用满 4 张的牌不算
export function waitingTiles(hand, visible = hand) {
  if (hand.length % 3 !== 1) return [];
  const counts = toCounts(visible);
  const waits = [];
  for (let t = 0; t < TILE_KINDS; t++) {
    if (counts[t] < 4 && canWin([...hand, t])) waits.push(t);
  }
  return waits;
}

export function canPeng(hand, tile) {
  return hand.filter((t) => t === tile).length >= 2;
}
