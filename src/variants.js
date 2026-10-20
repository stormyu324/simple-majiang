// 各地玩法：用哪些牌、几个人、能不能吃、赖子怎么定、怎样算胡、怎样算分。
// 地方规则各地差别很大，这里按最常见的打法来做，每个玩法的 rules 写清楚了具体规则，网页上可以查看。
import { ALL_KINDS, SUITED_KINDS, isHonor, rankOf, suitOf, tileName, toCounts, SUIT_NAMES } from './tiles.js';
import { standardWin, sevenPairs } from './hand.js';

const HZ = 31; // 红中
const FA = 32;
const BAI = 33;
const is258 = (t) => !isHonor(t) && [2, 5, 8].includes(rankOf(t));
const pow2 = (n) => 2 ** n;

// 胡牌时的完整手牌（含胡的那张）
function fullHand(p, tile, ctx) {
  if (ctx.hand) return [...ctx.hand, tile];
  return ctx.self ? [...p.hand] : [...p.hand, tile];
}

// 一手牌的各种特征，供各玩法判断番型
function analyze(e, p, h) {
  const counts = new Array(34).fill(0);
  let w = 0;
  for (const t of h) (e.isWild(t) ? w++ : counts[t]++);
  const meldTiles = p.melds.flatMap((m) => m.tiles);
  const real = [...h.filter((t) => !e.isWild(t)), ...meldTiles];
  const suits = new Set(real.map(suitOf));
  const noChi = p.melds.every((m) => m.type !== 'chi');
  return {
    h,
    counts,
    w,
    std: standardWin(counts, w),
    pung: noChi && standardWin(counts, w, { pungOnly: true }),
    seven: p.melds.length === 0 ? sevenPairs(counts, w) : null,
    qing: suits.size === 1 && !suits.has(3),
    allHonor: real.every(isHonor),
    all258: real.every(is258),
    // 所有牌（手牌 + 亮出的牌）每种几张，算"根"、"四归一"用
    total: toCounts([...h, ...meldTiles]),
  };
}

// 翻一张牌定赖子：数牌 9 的下一张是 1，字牌按 order 循环
function flipLaizi(e, order, skip = []) {
  let f;
  for (let i = 0; i < e.wall.length; i++) {
    f = e.wall[e.wall.length - 1 - i];
    if (!skip.includes(f)) {
      e.wall.splice(e.wall.length - 1 - i, 1);
      break;
    }
  }
  e.flip = f;
  if (isHonor(f)) e.laizi = order[(order.indexOf(f) + 1) % order.length];
  else e.laizi = f - (f % 9) + ((f % 9) + 1) % 9;
}

function newDeltas(e) {
  return new Array(e.n).fill(0);
}

function pay(deltas, from, to, amount) {
  deltas[from] -= amount;
  deltas[to] += amount;
}

function fanText(fans) {
  return fans.map((f) => (f.text ? `${f.name}${f.text}` : f.name)).join(' · ');
}

// 杠钱即时结算（红中麻将、卡五星、血战到底）：明杠放杠的人付，补杠/暗杠没胡的人都付
function gangPayments(e, deltas, lines, { ming, bu, an }) {
  const income = e.players.map(() => []); // 每人收到的杠钱 [{ from, amount }]，血战退税用
  for (const g of e.gangLog) {
    const payers = g.type === 'gang' ? [g.from] : g.unwon;
    const amount = g.type === 'gang' ? ming : g.type === 'bugang' ? bu : an;
    for (const f of payers) {
      pay(deltas, f, g.seat, amount);
      income[g.seat].push({ from: f, amount });
    }
  }
  const total = income.map((list) => list.reduce((a, b) => a + b.amount, 0));
  total.forEach((t, i) => t && lines.push(`${e.players[i].name} 杠钱 +${t}`));
  return income;
}

// ---------- 新手简单玩法 ----------

const simple = {
  id: 'simple',
  name: '新手简单玩法',
  short: '简单',
  players: 4,
  kinds: ALL_KINDS,
  chi: false,
  sevenPairs: true,
  rules: [
    '136 张牌（万条筒 + 东南西北中发白），4 人。',
    '只能碰、杠，不能吃。没有赖子。',
    '胡牌：4 组面子 + 1 对将，或者 7 个对子。',
    '算分（各项相乘）：平胡 1，七对 ×2，碰碰胡 ×2，清一色 ×4，自摸 ×2。',
    '点炮由放炮的人付分；自摸三家都付。',
  ],
  checkWin(e, p, tile, ctx) {
    const a = analyze(e, p, fullHand(p, tile, ctx));
    if (!a.std && !a.seven) return null;
    const fans = [];
    if (a.seven) fans.push({ name: '七对', mult: 2 });
    else if (a.pung) fans.push({ name: '碰碰胡', mult: 2 });
    if (a.qing) fans.push({ name: '清一色', mult: 4 });
    if (ctx.self) fans.push({ name: '自摸', mult: 2 });
    if (!fans.length) fans.push({ name: '平胡', mult: 1 });
    const points = fans.reduce((m, f) => m * f.mult, 1);
    fans.forEach((f) => { f.text = f.mult > 1 ? `×${f.mult}` : ''; });
    return { fans, points, title: fanText(fans) };
  },
  settle(e) {
    const deltas = newDeltas(e);
    const lines = [];
    for (const w of e.wins) {
      const payers = w.from === null ? w.unwon : [w.from];
      for (const f of payers) pay(deltas, f, w.seat, w.info.points);
      lines.push(`${e.players[w.seat].name} 赢 ${w.info.points * payers.length} 分（${w.info.title}）`);
    }
    return { deltas, lines };
  },
};

// ---------- 武汉麻将：红中赖子杠（开口翻 / 口口翻） ----------

function wuhan({ id, name, short, koukou }) {
  const cap = koukou ? 1024 : 256;
  const jin = koukou ? 1500 : 300;

  // 某个玩家自己的番：开口、各种杠
  function ownFans(e, i) {
    const p = e.players[i];
    const fans = [];
    const opens = p.melds.filter((m) => m.type !== 'angang').length;
    if (koukou && opens) fans.push({ name: `开口×${opens}`, fan: opens });
    if (!koukou && opens) fans.push({ name: '开口', fan: 1 });
    for (const m of p.melds) {
      if (m.type === 'gang' || m.type === 'bugang') fans.push({ name: '明杠', fan: 1 });
      if (m.type === 'angang') fans.push({ name: '暗杠', fan: 2 });
    }
    for (const t of p.specials) {
      if (t === e.laizi) fans.push({ name: '赖子杠', fan: 2 });
      else fans.push({ name: t === HZ ? '红中杠' : '皮子杠', fan: 1 });
    }
    return fans;
  }

  return {
    id,
    name,
    short,
    players: 4,
    kinds: ALL_KINDS,
    chi: true,
    requireOpen: true,
    rules: [
      '136 张牌，4 人，可以吃（只能吃上家）、碰、杠。',
      '开局翻一张牌，它的下一张是【赖子】（万能牌，翻到九万则一万是赖子；字牌按东南西北发白循环，跳过红中）。翻出的牌（剩下 3 张）和 4 张红中是【皮子】。',
      '皮子不能留在手里胡牌，要单张打出去当杠：红中杠、皮子杠各 1 番；赖子也可以单张杠出去，赖子杠 2 番。这几种杠都要补一张牌，但不算开口。',
      '必须开口（吃、碰、明杠）才能胡。',
      '小胡：4 组面子 + 将，将必须是 2、5、8；手里最多 1 张赖子。',
      '大胡（不要求 258 将，赖子不限）：清一色、碰碰胡、将一色（全是 2/5/8，不用成牌型）、风一色（全是字牌，不用成牌型）、全求人、杠上开花、海底捞月、抢杠。没有七对。',
      '番数：' + (koukou ? '每开一次口 1 番（口口翻）' : '开口 1 番（不管开几次）') + '，明杠 1 番，暗杠 2 番，自摸 1 番，硬胡（没用赖子当万能牌）1 番，小胡时庄家 1 番，放冲的人 1 番，没开口也没杠的人罚 1 番。',
      `算分：每个输家付 底分 × 2^(赢家番数 + 输家自己的番数)。小胡底分 1，大胡底分 10，几个大胡就乘几。三家都要付（不只是放冲的人）。每家最多付 ${cap}，三家都封顶则每家付 ${jin}（金顶）。`,
      '一炮单响：几家都能胡时，离放冲的人最近的下家胡。',
    ],
    setup(e) {
      flipLaizi(e, [27, 28, 29, 30, FA, BAI], [HZ]);
      e.pizi = [e.flip, HZ];
      e.log(`翻出 ${tileName(e.flip)}：赖子是 ${tileName(e.laizi)}，皮子是 ${tileName(e.flip)} 和 红中`);
    },
    specialGangs(e, p) {
      const out = [];
      for (const t of new Set(p.hand)) {
        if (e.isPizi(t)) out.push({ type: 'pigang', tile: t, label: t === HZ ? '红中杠' : '皮子杠' });
        else if (e.isWild(t)) out.push({ type: 'laigang', tile: t, label: '赖子杠' });
      }
      return out;
    },
    allowedDiscards(e, p) {
      return [...new Set(p.hand)].filter((t) => !e.isPizi(t) && !e.isWild(t));
    },
    canClaimTile(e, p, t) {
      return !e.isWild(t) && !e.isPizi(t);
    },
    checkWin(e, p, tile, ctx) {
      const h = fullHand(p, tile, ctx);
      if (h.some((t) => e.isPizi(t))) return null;
      if (!e.opened(p)) return null;
      const a = analyze(e, p, h);
      const bigs = [];
      if (a.qing && a.std) bigs.push('清一色');
      if (a.pung) bigs.push('碰碰胡');
      if (a.all258) bigs.push('将一色');
      if (a.allHonor) bigs.push('风一色');
      if (h.length === 2 && !ctx.self && a.std) bigs.push('全求人');
      const formOk = a.std || a.all258 || a.allHonor;
      if (formOk) {
        if (ctx.self && ctx.gangDraw) bigs.push('杠上开花');
        if (ctx.self && ctx.last) bigs.push('海底捞月');
        if (ctx.robbing) bigs.push('抢杠');
      }
      if (!bigs.length) {
        if (a.w > 1 || !standardWin(a.counts, a.w, { pairOk: is258 })) return null;
      }
      // 硬胡：赖子当它本来的牌也能胡（或者没有赖子）
      const natural = toCounts(h);
      const hard = a.w === 0 || (bigs.length ? standardWin(natural, 0) : standardWin(natural, 0, { pairOk: is258 }));
      const title = bigs.length ? bigs.join(' · ') : '小胡';
      return { big: bigs.length, bigs, hard, fans: bigs.length ? bigs.map((name) => ({ name })) : [{ name: '小胡' }], title };
    },
    settle(e) {
      const deltas = newDeltas(e);
      const lines = [];
      const win = e.wins[0];
      if (!win) return { deltas, lines };
      const { info } = win;
      const small = !info.big;
      const wf = ownFans(e, win.seat);
      if (win.from === null && !info.bigs?.includes('杠上开花')) wf.push({ name: '自摸', fan: 1 });
      if (info.hard) wf.push({ name: '硬胡', fan: 1 });
      if (small && win.seat === e.dealer) wf.push({ name: '庄家', fan: 1 });
      const wTotal = wf.reduce((s, f) => s + f.fan, 0);
      const base = small ? 1 : 10 * info.big;

      const owed = [];
      for (const i of e.players.keys()) {
        if (i === win.seat) continue;
        const lf = ownFans(e, i);
        if (i === win.from) lf.push({ name: '放冲', fan: 1 });
        if (small && i === e.dealer) lf.push({ name: '庄家', fan: 1 });
        const p = e.players[i];
        if (!p.melds.length && !p.specials.length) lf.push({ name: '没开口', fan: 1 });
        const lTotal = lf.reduce((s, f) => s + f.fan, 0);
        owed.push({ i, amount: Math.min(cap, base * pow2(wTotal + lTotal)), lTotal });
      }
      const allCapped = owed.every((o) => o.amount >= cap);
      for (const o of owed) {
        const amount = allCapped ? jin : o.amount;
        pay(deltas, o.i, win.seat, amount);
        lines.push(`${e.players[o.i].name} 付 ${amount}（${o.lTotal} 番）`);
      }
      lines.unshift(`${e.players[win.seat].name}：${info.title}，底分 ${base}，${wTotal} 番（${wf.map((f) => f.name).join('、') || '无'}）${allCapped ? '，金顶！' : ''}`);
      return { deltas, lines };
    },
  };
}

// ---------- 武汉晃晃 ----------

const huanghuang = {
  id: 'huanghuang',
  name: '武汉晃晃',
  short: '晃晃',
  players: 4,
  kinds: [...SUITED_KINDS, HZ, FA, BAI],
  chi: false,
  sevenPairs: true,
  rules: [
    '120 张牌（万条筒 + 中发白），4 人，只能碰、杠，不能吃，不用开口。',
    '开局翻一张牌，它的下一张是【赖子】（万能牌，跳过红中；发财和白板互为下一张）。',
    '红中不能留在手里胡牌，要单张打出去当【红中杠】（1 番）；赖子也可以单张杠出去，【赖子杠】2 番。',
    '任意一对都可以做将。手里有 2 张以上赖子时不能胡小胡。',
    '大胡：清一色、碰碰胡、七对、龙七对（算 2 个大胡）、杠上开花、抢杠。',
    '番数：硬胡（没用赖子当万能牌）1 番，自摸 1 番，明杠/补杠 1 番，暗杠 2 番；放炮的人 1 番。',
    '算分：三家都付，每家付 底分 × 2^(赢家番数 + 输家自己的番数)，小胡底分 1，大胡底分 10（几个大胡就乘几），每家最多付 256。',
  ],
  setup(e) {
    flipLaizi(e, [FA, BAI], [HZ]);
    e.pizi = [HZ];
    e.log(`翻出 ${tileName(e.flip)}：赖子是 ${tileName(e.laizi)}`);
  },
  specialGangs(e, p) {
    const out = [];
    if (p.hand.includes(HZ)) out.push({ type: 'pigang', tile: HZ, label: '红中杠' });
    if (p.hand.includes(e.laizi)) out.push({ type: 'laigang', tile: e.laizi, label: '赖子杠' });
    return out;
  },
  allowedDiscards(e, p) {
    return [...new Set(p.hand)].filter((t) => t !== HZ && !e.isWild(t));
  },
  canClaimTile(e, p, t) {
    return !e.isWild(t) && t !== HZ;
  },
  checkWin(e, p, tile, ctx) {
    const h = fullHand(p, tile, ctx);
    if (h.includes(HZ)) return null;
    const a = analyze(e, p, h);
    if (!a.std && !a.seven) return null;
    const bigs = [];
    if (a.qing) bigs.push('清一色');
    if (a.pung) bigs.push('碰碰胡');
    if (a.seven) bigs.push(a.seven.dragons ? '龙七对' : '七对');
    if (ctx.self && ctx.gangDraw) bigs.push('杠上开花');
    if (ctx.robbing) bigs.push('抢杠');
    if (!bigs.length && a.w > 1) return null;
    const big = bigs.length + (bigs.includes('龙七对') ? 1 : 0);
    const natural = toCounts(h);
    const hard = a.w === 0 || standardWin(natural, 0) || Boolean(sevenPairs(natural, 0));
    return { big, bigs, hard, fans: (bigs.length ? bigs : ['小胡']).map((name) => ({ name })), title: bigs.join(' · ') || '小胡' };
  },
  settle(e) {
    const deltas = newDeltas(e);
    const lines = [];
    const win = e.wins[0];
    if (!win) return { deltas, lines };
    const own = (i) => {
      const p = e.players[i];
      let f = 0;
      for (const m of p.melds) f += m.type === 'angang' ? 2 : m.type === 'gang' || m.type === 'bugang' ? 1 : 0;
      for (const t of p.specials) f += t === HZ ? 1 : 2;
      return f;
    };
    const { info } = win;
    let wf = own(win.seat) + (info.hard ? 1 : 0) + (win.from === null ? 1 : 0);
    const base = info.big ? 10 * info.big : 1;
    for (const i of e.players.keys()) {
      if (i === win.seat) continue;
      const lf = own(i) + (i === win.from ? 1 : 0);
      const amount = Math.min(256, base * pow2(wf + lf));
      pay(deltas, i, win.seat, amount);
      lines.push(`${e.players[i].name} 付 ${amount}`);
    }
    lines.unshift(`${e.players[win.seat].name}：${info.title}${info.hard ? ' · 硬胡' : ''}${win.from === null ? ' · 自摸' : ''}，底分 ${base}，${wf} 番`);
    return { deltas, lines };
  },
};

// ---------- 红中麻将 ----------

const hongzhong = {
  id: 'hongzhong',
  name: '红中麻将',
  short: '红中',
  players: 4,
  kinds: [...SUITED_KINDS, HZ],
  chi: false,
  sevenPairs: true,
  rules: [
    '112 张牌（万条筒 + 4 张红中），4 人，只能碰、杠，不能吃。',
    '【红中是万能牌】，可以当任何牌用。别人打出的红中不能碰。',
    '只能自摸胡，不能胡别人打出的牌（抢杠胡除外，由被抢的人全付）。',
    '胡牌：4 组面子 + 将，或者 7 个对子；手里有 4 张红中直接胡。',
    '算分：每家付 2 分，七对 ×2，无红中 ×2，杠上开花 ×2，四红中 ×2。',
    '抓码：胡牌后从牌墙翻 2 张，是 1、5、9 或红中就算中码，每中一个每家多付 2 分。',
    '杠钱：明杠放杠的人付 3 分，补杠每家付 1 分，暗杠每家付 2 分。',
  ],
  setup(e) {
    e.laizi = HZ;
  },
  canClaimTile(e, p, t) {
    return t !== HZ;
  },
  checkWin(e, p, tile, ctx) {
    if (!ctx.self && !ctx.robbing) return null;
    const h = fullHand(p, tile, ctx);
    const a = analyze(e, p, h);
    const four = a.w === 4;
    if (!four && !a.std && !a.seven) return null;
    const fans = [];
    if (four) fans.push({ name: '四红中', mult: 2 });
    if (a.seven) fans.push({ name: '七对', mult: 2 });
    if (a.w === 0) fans.push({ name: '无红中', mult: 2 });
    if (ctx.gangDraw) fans.push({ name: '杠上开花', mult: 2 });
    if (ctx.robbing) fans.push({ name: '抢杠', mult: 1 });
    if (!fans.length) fans.push({ name: '平胡', mult: 1 });
    const mult = fans.reduce((m, f) => m * f.mult, 1);
    return { mult, fans, title: fans.map((f) => f.name).join(' · ') };
  },
  settle(e) {
    const deltas = newDeltas(e);
    const lines = [];
    const win = e.wins[0];
    if (win) {
      const codes = e.wall.slice(-2);
      const hits = codes.filter((t) => t === HZ || [1, 5, 9].includes(rankOf(t))).length;
      const each = 2 * win.info.mult + 2 * hits;
      const others = [...e.players.keys()].filter((i) => i !== win.seat);
      if (win.from !== null) pay(deltas, win.from, win.seat, each * others.length);
      else for (const i of others) pay(deltas, i, win.seat, each);
      lines.push(`${e.players[win.seat].name}：${win.info.title}，抓码 ${codes.map(tileName).join(' ') || '无'}（中 ${hits} 个），每家 ${each} 分${win.from !== null ? `，由 ${e.players[win.from].name} 全付` : ''}`);
    }
    gangPayments(e, deltas, lines, { ming: 3, bu: 1, an: 2 });
    return { deltas, lines };
  },
};

// ---------- 卡五星 ----------

const kawuxing = {
  id: 'kawuxing',
  name: '卡五星',
  short: '卡五星',
  players: 3,
  kinds: [...SUITED_KINDS.slice(9), HZ, FA, BAI],
  chi: false,
  sevenPairs: true,
  liang: true,
  rules: [
    '84 张牌（条、筒 + 中发白），3 人，只能碰、杠，不能吃。没有赖子。',
    '【亮倒】：听牌时，打出一张牌的同时可以亮倒，把手牌亮给大家看。之后自动摸打，胡牌 ×2；别人放炮给亮倒的人要按自摸的分全付。',
    '胡牌：4 组面子 + 任意一对将，或者 7 个对子。',
    '番数（相乘，最多 8 倍）：碰碰胡 ×2，卡五星（用 4、6 夹胡 5）×2，明四归一 ×2，杠上开花 ×2，杠上炮 ×2，海底捞月 ×2，亮倒 ×2；暗四归一 ×4，七对 ×4，清一色 ×4，手抓一 ×4，小三元 ×4；龙七对 ×8，大三元 ×8。',
    '算分：点炮由放炮的人付；自摸另外两家都付。',
    '杠钱：明杠放杠的人付 2 分，补杠每家付 1 分，暗杠每家付 2 分。',
  ],
  canClaimTile() {
    return true;
  },
  checkWin(e, p, tile, ctx) {
    const h = fullHand(p, tile, ctx);
    const a = analyze(e, p, h);
    if (!a.std && !a.seven) return null;
    const fans = [];
    if (a.seven) fans.push(a.seven.dragons ? { name: '龙七对', mult: 8 } : { name: '七对', mult: 4 });
    else if (a.pung) fans.push({ name: '碰碰胡', mult: 2 });
    if (a.qing) fans.push({ name: '清一色', mult: 4 });
    if (!a.seven && rankOf(tile) === 5 && a.counts[tile - 1] && a.counts[tile + 1]) {
      const c = [...a.counts];
      c[tile - 1]--; c[tile]--; c[tile + 1]--;
      if (standardWin(c, 0)) fans.push({ name: '卡五星', mult: 2 });
    }
    if (a.total[tile] === 4) {
      if (p.melds.some((m) => m.type === 'peng' && m.tiles[0] === tile)) fans.push({ name: '明四归一', mult: 2 });
      else if (!a.seven) fans.push({ name: '暗四归一', mult: 4 });
    }
    if (h.length === 2) fans.push({ name: '手抓一', mult: 4 });
    const dragonSets = [HZ, FA, BAI].filter((t) => a.total[t] >= 3).length;
    const dragonPair = [HZ, FA, BAI].some((t) => a.total[t] === 2);
    if (dragonSets === 3) fans.push({ name: '大三元', mult: 8 });
    else if (dragonSets === 2 && dragonPair) fans.push({ name: '小三元', mult: 4 });
    if (ctx.self && ctx.gangDraw) fans.push({ name: '杠上开花', mult: 2 });
    if (!ctx.self && ctx.afterGang) fans.push({ name: '杠上炮', mult: 2 });
    if (ctx.self && ctx.last) fans.push({ name: '海底捞月', mult: 2 });
    if (p.liang) fans.push({ name: '亮倒', mult: 2 });
    if (!fans.length) fans.push({ name: '平胡', mult: 1 });
    const mult = Math.min(8, fans.reduce((m, f) => m * f.mult, 1));
    fans.forEach((f) => { f.text = f.mult > 1 ? `×${f.mult}` : ''; });
    return { mult, fans, title: fanText(fans) };
  },
  settle(e) {
    const deltas = newDeltas(e);
    const lines = [];
    const win = e.wins[0];
    if (win) {
      const { mult } = win.info;
      const w = e.players[win.seat];
      if (win.from === null) {
        for (const i of e.players.keys()) if (i !== win.seat) pay(deltas, i, win.seat, mult);
        lines.push(`${w.name} 自摸，两家各付 ${mult}`);
      } else {
        const amount = w.liang ? mult * 2 : mult;
        pay(deltas, win.from, win.seat, amount);
        lines.push(`${e.players[win.from].name} 放炮${w.liang ? '给亮倒的人，按自摸全付' : ''}，付 ${amount}`);
      }
    }
    gangPayments(e, deltas, lines, { ming: 2, bu: 1, an: 2 });
    return { deltas, lines };
  },
};

// ---------- 四川血战到底 ----------

const XZ_CAP = 4; // 最多 4 番（16 倍）

function xuezhanFan(e, p, h, a, tile, ctx) {
  const fans = [];
  let fan = 0;
  let gen = [...a.total].filter((c) => c === 4).length;
  if (a.seven) {
    if (a.seven.dragons) {
      fans.push({ name: '龙七对', fan: 3 });
      fan += 3;
      gen -= 1;
    } else {
      fans.push({ name: '七对', fan: 2 });
      fan += 2;
    }
  } else if (a.pung) {
    fans.push({ name: '碰碰胡', fan: 1 });
    fan += 1;
  }
  if (a.qing) { fans.push({ name: '清一色', fan: 2 }); fan += 2; }
  if (h.length === 2) { fans.push({ name: '金钩钓', fan: 1 }); fan += 1; }
  if (gen > 0) { fans.push({ name: `根×${gen}`, fan: gen }); fan += gen; }
  if (ctx.self) { fans.push({ name: '自摸', fan: 1 }); fan += 1; }
  if (ctx.self && ctx.gangDraw) { fans.push({ name: '杠上花', fan: 1 }); fan += 1; }
  if (!ctx.self && ctx.afterGang) { fans.push({ name: '杠上炮', fan: 1 }); fan += 1; }
  if (ctx.robbing) { fans.push({ name: '抢杠', fan: 1 }); fan += 1; }
  if (ctx.last) { fans.push({ name: '海底', fan: 1 }); fan += 1; }
  if (!fans.length) fans.push({ name: '平胡', fan: 0 });
  return { fans, fan, points: pow2(Math.min(fan, XZ_CAP)) };
}

const xuezhan = {
  id: 'xuezhan',
  name: '四川血战到底',
  short: '血战',
  players: 4,
  kinds: SUITED_KINDS,
  chi: false,
  sevenPairs: true,
  multiWin: true,
  bloodBattle: true,
  swap3: true,
  dingque: true,
  rules: [
    '108 张牌（只有万条筒），4 人，只能碰、杠，不能吃。没有赖子。',
    '【换三张】：开局每人选 3 张同花色的牌，随机换给下家、对家或上家。',
    '【定缺】：每人选一门花色不要。手里有缺门的牌时必须先打缺门，缺门的牌不能碰、杠，手里有缺门的牌不能胡。',
    '【血战到底】：一家胡了牌局不结束，其他人接着打，直到 3 家胡牌或牌摸完。一炮多响：几家可以同时胡同一张牌。',
    '番数（相加，最多 4 番）：碰碰胡 1，七对 2，龙七对 3，清一色 2，金钩钓 1，每个根（4 张一样的）1，自摸 1，杠上花 1，杠上炮 1，抢杠 1，海底 1。得分 = 2 的番数次方。',
    '点炮由放炮的人付；自摸由还没胡的人都付。',
    '刮风下雨（杠钱当场结算）：明杠放杠的人付 2 分，补杠没胡的人每家付 1 分，暗杠没胡的人每家付 2 分。',
    '流局时：手里还有三门花色的【花猪】赔每个非花猪玩家 16 分；没听牌的人赔听牌的人他能胡的最大分（查大叫），并且退还自己收到的杠钱（退税）。',
  ],
  allowedDiscards(e, p) {
    const que = p.hand.filter((t) => suitOf(t) === p.que);
    return [...new Set(que.length ? que : p.hand)];
  },
  canClaimTile(e, p, t) {
    return suitOf(t) !== p.que;
  },
  checkWin(e, p, tile, ctx) {
    const h = fullHand(p, tile, ctx);
    if (p.que === null || h.some((t) => suitOf(t) === p.que)) return null;
    const a = analyze(e, p, h);
    if (!a.std && !a.seven) return null;
    const r = xuezhanFan(e, p, h, a, tile, ctx);
    return { ...r, title: `${r.fans.map((f) => f.name).join(' · ')}（${r.points} 分）` };
  },
  settle(e) {
    const deltas = newDeltas(e);
    const lines = [];
    for (const w of e.wins) {
      const payers = w.from === null ? w.unwon : [w.from];
      for (const f of payers) pay(deltas, f, w.seat, w.info.points);
      lines.push(`${e.players[w.seat].name}：${w.info.title}${payers.length > 1 ? ` × ${payers.length} 家` : ''}`);
    }
    const income = gangPayments(e, deltas, lines, { ming: 2, bu: 1, an: 2 });

    // 流局（还有 2 家以上没胡）：查花猪、查大叫、退税
    const left = e.unwon();
    if (left.length >= 2) {
      const pig = left.filter((i) => e.players[i].hand.some((t) => suitOf(t) === e.players[i].que));
      const best = new Map(); // 听牌的人能胡的最大分
      for (const i of left) {
        if (pig.includes(i)) continue;
        const p = e.players[i];
        let max = 0;
        for (const t of e.v.kinds) {
          const info = this.checkWin(e, p, t, { self: false, hand: p.hand, probe: true });
          if (info) max = Math.max(max, info.points);
        }
        if (max) best.set(i, max);
      }
      for (const i of pig) {
        for (const j of left) {
          if (!pig.includes(j)) pay(deltas, i, j, 16);
        }
        lines.push(`${e.players[i].name} 是花猪，赔每家 16 分`);
      }
      for (const i of left) {
        if (best.has(i)) continue;
        for (const [j, pts] of best) pay(deltas, i, j, pts);
        if (best.size) lines.push(`${e.players[i].name} 没听牌，赔听牌的人`);
        for (const g of income[i]) pay(deltas, i, g.from, g.amount);
        if (income[i].length) lines.push(`${e.players[i].name} 没听牌，退还杠钱`);
      }
    }
    return { deltas, lines };
  },
};

const base = {
  sevenPairs: false,
  multiWin: false,
  bloodBattle: false,
  swap3: false,
  dingque: false,
  liang: false,
  canClaimTile: () => true,
};

export const VARIANTS = Object.fromEntries([
  wuhan({ id: 'wuhan', name: '武汉麻将（红中赖子杠·开口翻）', short: '开口翻', koukou: false }),
  wuhan({ id: 'koukou', name: '武汉麻将（口口翻）', short: '口口翻', koukou: true }),
  kawuxing,
  huanghuang,
  hongzhong,
  xuezhan,
  simple,
].map((v) => [v.id, { ...base, ...v }]));

export const VARIANT_IDS = Object.keys(VARIANTS);
export const DEFAULT_VARIANT = 'wuhan';

export function getVariant(id) {
  return VARIANTS[id] ?? VARIANTS[DEFAULT_VARIANT];
}

export { SUIT_NAMES };
