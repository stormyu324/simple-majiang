// 电脑玩家：用向听数（还差几步听牌）挑出牌，碰/吃前比较碰完会不会更接近听牌
import { isHonor, suitOf, toCounts } from './tiles.js';
import { shanten } from './hand.js';

// 一张牌在手里的"有用程度"：对子和相邻的牌越多越有用（向听数相同时用来挑）
function tileValue(tile, counts) {
  let value = (counts[tile] - 1) * 4;
  if (!isHonor(tile)) {
    const pos = tile % 9;
    for (const d of [-2, -1, 1, 2]) {
      const q = pos + d;
      if (q < 0 || q > 8) continue;
      if (counts[tile + d] > 0) value += Math.abs(d) === 1 ? 2 : 1;
    }
    if (pos >= 2 && pos <= 6) value += 0.5;
  }
  return value;
}

function without(hand, ...tiles) {
  const rest = [...hand];
  for (const t of tiles) {
    const at = rest.indexOf(t);
    if (at !== -1) rest.splice(at, 1);
  }
  return rest;
}

function shantenOf(e, p, hand, openMelds = p.melds.length) {
  // 必须杠掉的牌（皮子、红中）和缺门的牌不算进牌型
  const usable = hand.filter((t) => !e.isPizi(t) && suitOf(t) !== p.que);
  const junk = hand.length - usable.length;
  return shanten(usable, { wild: (t) => e.isWild(t), openMelds, allowSevenPairs: e.v.sevenPairs }) + junk;
}

// 亮倒玩家在等的牌：尽量不打给他们
function dangerous(e, seat) {
  const danger = new Set();
  e.players.forEach((q, i) => {
    if (i !== seat && q.liang && !q.won) for (const t of e.waits(q)) danger.add(t);
  });
  return danger;
}

function bestDiscard(e, seat, choices) {
  const p = e.players[seat];
  const counts = toCounts(p.hand);
  const danger = dangerous(e, seat);
  let best = choices[0];
  let bestScore = Infinity;
  for (const t of choices) {
    let score = shantenOf(e, p, without(p.hand, t)) * 100 - tileValue(t, counts);
    if (e.isWild(t)) score += 1000;
    if (danger.has(t)) score += 500;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

// 碰/吃之后要打一张，看打完最好能到几向听
function shantenAfterClaim(e, p, rest) {
  let best = Infinity;
  for (const t of new Set(rest)) best = Math.min(best, shantenOf(e, p, without(rest, t), p.melds.length + 1));
  return best;
}

function decideClaim(e, seat, req) {
  const p = e.players[seat];
  const find = (type) => req.actions.find((a) => a.type === type);
  if (find('hu')) return { type: 'hu' };
  if (find('gang')) return { type: 'gang' };
  const now = shantenOf(e, p, p.hand);
  // 必须开口才能胡的玩法（武汉麻将），还没开口时更愿意碰/吃
  const eager = e.v.requireOpen && !e.opened(p);
  const worth = (after) => after < now || (eager && after <= now);
  if (find('peng') && worth(shantenAfterClaim(e, p, without(p.hand, req.tile, req.tile)))) return { type: 'peng' };
  for (const a of req.actions.filter((x) => x.type === 'chi')) {
    if (worth(shantenAfterClaim(e, p, without(p.hand, ...a.tiles)))) return a;
  }
  return { type: 'pass' };
}

function decideTurn(e, seat, req) {
  const p = e.players[seat];
  const find = (type) => req.actions.find((a) => a.type === type);
  if (find('hu')) return { type: 'hu' };
  // 皮子、红中留在手里不能胡，马上杠掉
  const pi = find('pigang');
  if (pi) return pi;
  // 赖子：两张以上不能胡小胡，多的杠掉
  const lai = find('laigang');
  if (lai && p.hand.filter((t) => e.isWild(t)).length >= 2) return lai;
  for (const type of ['angang', 'bugang']) {
    const g = req.actions.find((a) => a.type === type && !e.isWild(a.tile));
    if (g) return g;
  }
  if (req.liang) {
    // 能亮倒就亮：挑亮倒后听的牌最多的那张打
    let best = null;
    let most = 0;
    for (const t of req.liang) {
      const n = e.waits(p, without(p.hand, t)).length;
      if (n > most) {
        most = n;
        best = t;
      }
    }
    if (best !== null) return { type: 'liang', tile: best };
  }
  return { type: 'discard', tile: bestDiscard(e, seat, req.discards) };
}

export function botDecide(e, seat, req) {
  const p = e.players[seat];
  switch (req.kind) {
    case 'turn':
      return decideTurn(e, seat, req);
    case 'claim':
      return decideClaim(e, seat, req);
    case 'dingque': {
      // 缺最少的那门
      const n = [0, 1, 2].map((s) => p.hand.filter((t) => suitOf(t) === s).length);
      return { suit: n.indexOf(Math.min(...n)) };
    }
    case 'swap': {
      // 换掉张数最少（至少 3 张）的那门里最没用的 3 张
      const bySuit = [0, 1, 2].map((s) => p.hand.filter((t) => suitOf(t) === s)).filter((s) => s.length >= 3);
      const suit = bySuit.sort((a, b) => a.length - b.length)[0];
      const counts = toCounts(p.hand);
      return { tiles: [...suit].sort((a, b) => tileValue(a, counts) - tileValue(b, counts)).slice(0, 3) };
    }
  }
  return null;
}

// 给"提示"用：建议打哪张
export function suggestDiscard(e, seat, choices) {
  return bestDiscard(e, seat, choices);
}
