// 通用牌局流程：摸牌、出牌、吃碰杠、各种特殊杠、换三张、定缺、亮倒、血战到底。
// 各地规则的差别都放在 variants.js 里，这里只管流程。
//
// 需要玩家做选择时调用 decide(seat, request)，request 的几种 kind：
//   turn    轮到自己：{ actions: [胡/杠...], discards: [能打的牌], liang: [打出后能亮倒的牌] | null }
//           回答 { type: 'discard' | 'liang', tile } 或 actions 里的一项
//   claim   别人打出牌：{ tile, from, actions: [胡/碰/杠/吃...] }，回答其中一项或 { type: 'pass' }
//   swap    换三张：回答 { tiles: [三张同花色的牌] }
//   dingque 定缺：回答 { suit: 0 | 1 | 2 }
// 回答不合法（或者超时、掉线）就由电脑代替。
import { createWall, sortTiles, suitOf, tileName, SUIT_NAMES } from './tiles.js';
import { botDecide } from './bot.js';

const OPEN_TYPES = new Set(['chi', 'peng', 'gang', 'bugang']);
const DIRS = [['下家', 1], ['对家', 2], ['上家', -1]];

function removeTiles(hand, tile, n = 1) {
  for (let i = 0; i < n; i++) {
    const at = hand.indexOf(tile);
    if (at !== -1) hand.splice(at, 1);
  }
}

const count = (hand, tile) => hand.filter((t) => t === tile).length;

export class Engine {
  // names / humans：每个座位的名字、是否真人；decide(seat, request) 只对真人调用
  constructor(variant, { names, humans, decide, random = Math.random, log = () => {}, onChange = () => {}, pause = async () => {}, dealer = 0 }) {
    this.v = variant;
    this.n = variant.players;
    this.random = random;
    this.decide = decide;
    this.log = log;
    this.onChange = onChange;
    this.pause = pause;
    this.dealer = dealer % this.n;
    this.players = Array.from({ length: this.n }, (_, i) => ({
      name: names[i],
      isHuman: Boolean(humans[i]),
      hand: [],
      melds: [], // { type: chi | peng | gang | bugang | angang, tiles, from }
      discards: [],
      specials: [], // 打出去当杠的牌（红中杠、皮子杠、赖子杠）
      drawn: null,
      que: null,
      liang: false,
      won: null,
    }));
    this.wall = [];
    this.laizi = null; // 赖子（万能牌）
    this.flip = null; // 翻出来定赖子的那张牌
    this.pizi = []; // 必须杠掉的牌（皮子、红中）
    this.turn = this.dealer;
    this.lastDiscard = null;
    this.phase = 'deal';
    this.wins = []; // { seat, from, tile, info, unwon }
    this.gangLog = []; // { seat, type, from, unwon }
    this.result = null;
  }

  isWild(tile) {
    return this.laizi !== null && tile === this.laizi;
  }

  isPizi(tile) {
    return this.pizi.includes(tile);
  }

  opened(p) {
    return p.melds.some((m) => OPEN_TYPES.has(m.type));
  }

  // 还没胡的玩家（血战到底里胡了的人不再参与）
  unwon(except = -1) {
    return this.players.map((_, i) => i).filter((i) => i !== except && !this.players[i].won);
  }

  next(seat) {
    let s = (seat + 1) % this.n;
    while (this.players[s].won && s !== seat) s = (s + 1) % this.n;
    return s;
  }

  changed() {
    this.onChange(this);
  }

  // ---------- 主流程 ----------

  async play() {
    const { v } = this;
    this.wall = createWall(this.random, v.kinds);
    for (let k = 0; k < this.n; k++) {
      const p = this.players[(this.dealer + k) % this.n];
      p.hand = this.wall.splice(0, 13);
    }
    v.setup?.(this);
    this.phase = v.swap3 ? 'swap' : v.dingque ? 'dingque' : 'play';
    this.log(`${v.name}开始！${this.players[this.dealer].name}坐庄。`);
    this.changed();

    if (v.swap3) await this.swapPhase();
    if (v.dingque) await this.dingquePhase();
    this.phase = 'play';
    this.changed();

    let seat = this.dealer;
    let draw = 'front'; // 'front' 正常摸牌，'back' 杠后补牌，null 不摸（碰、吃之后）
    while (!this.finished()) {
      const p = this.players[seat];
      this.turn = seat;
      if (draw) {
        if (!this.wall.length) break;
        this.drawTile(p, draw === 'back');
      }
      const out = await this.takeTurn(seat, { canHu: draw !== null, gangDraw: draw === 'back' });
      if (out.type === 'exhausted') break;
      if (out.type === 'hu' || out.type === 'robbed') {
        seat = this.next(out.lastSeat ?? seat);
        draw = 'front';
        continue;
      }

      // 打出一张牌，看别人要不要
      const tile = out.tile;
      this.lastDiscard = { seat, tile };
      this.log(`${p.name} 打出 ${tileName(tile)}${out.type === 'liang' ? '，亮倒！' : ''}`);
      this.changed();
      await this.pause('discard', seat);

      const claim = await this.claims(seat, tile, { afterGang: out.gangDraw });
      if (!claim) {
        p.discards.push(tile);
        this.lastDiscard = null;
        seat = this.next(seat);
        draw = 'front';
        continue;
      }
      this.lastDiscard = null;
      if (claim.type === 'hu') {
        claim.seats.forEach((w, i) => this.win(w, seat, tile, { afterGang: out.gangDraw }, i > 0));
        seat = this.next(claim.seats[claim.seats.length - 1]);
        draw = 'front';
        continue;
      }
      const c = this.players[claim.seat];
      if (claim.type === 'chi') {
        for (const t of claim.tiles) removeTiles(c.hand, t);
        c.melds.push({ type: 'chi', tiles: sortTiles([...claim.tiles, tile]), from: seat });
        this.log(`${c.name} 吃 ${tileName(tile)}`);
        draw = null;
      } else if (claim.type === 'peng') {
        removeTiles(c.hand, tile, 2);
        c.melds.push({ type: 'peng', tiles: [tile, tile, tile], from: seat });
        this.log(`${c.name} 碰 ${tileName(tile)}！`);
        draw = null;
      } else {
        removeTiles(c.hand, tile, 3);
        c.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile], from: seat });
        this.recordGang(claim.seat, 'gang', seat);
        this.log(`${c.name} 杠 ${tileName(tile)}！`);
        draw = 'back';
      }
      seat = claim.seat;
      this.changed();
      await this.pause('claim', seat);
    }
    return this.finish();
  }

  finished() {
    const won = this.wins.length ? new Set(this.wins.map((w) => w.seat)).size : 0;
    return this.v.bloodBattle ? won >= this.n - 1 : won > 0;
  }

  drawTile(p, fromBack) {
    const tile = fromBack ? this.wall.pop() : this.wall.shift();
    p.hand.push(tile);
    p.drawn = tile;
    this.changed();
    return tile;
  }

  finish() {
    this.phase = 'end';
    this.turn = null;
    const settled = this.v.settle(this);
    if (!this.wins.length) this.log('牌墙摸完了，流局！');
    this.result = {
      draw: this.wins.length === 0,
      wins: this.wins.map((w) => ({ seat: w.seat, from: w.from, tile: w.tile, shared: w.shared, fans: w.info.fans, title: w.info.title })),
      deltas: settled.deltas,
      lines: settled.lines,
      nextDealer: this.wins.length ? this.wins[0].seat : this.dealer,
    };
    for (const line of settled.lines) this.log(line);
    this.changed();
    return this.result;
  }

  // ---------- 换三张、定缺 ----------

  async swapPhase() {
    const picks = await Promise.all(this.players.map((_, i) => this.ask(i, { kind: 'swap' })));
    const [label, step] = DIRS[Math.floor(this.random() * DIRS.length)];
    picks.forEach((c, i) => c.tiles.forEach((t) => removeTiles(this.players[i].hand, t)));
    picks.forEach((c, i) => this.players[(i + step + this.n) % this.n].hand.push(...c.tiles));
    this.log(`换三张：每人把三张牌换给${label}`);
    this.phase = 'dingque';
    this.changed();
  }

  async dingquePhase() {
    const picks = await Promise.all(this.players.map((_, i) => this.ask(i, { kind: 'dingque' })));
    picks.forEach((c, i) => { this.players[i].que = c.suit; });
    this.log(`定缺：${this.players.map((p) => `${p.name}缺${SUIT_NAMES[p.que]}`).join('，')}`);
    this.changed();
  }

  // ---------- 自己的回合 ----------

  async takeTurn(seat, { canHu, gangDraw }) {
    const p = this.players[seat];
    while (true) {
      const req = this.turnRequest(p, { canHu, gangDraw });
      let choice;
      if (p.liang) {
        // 亮倒之后自动打：能胡就胡，否则打出摸到的牌
        choice = req.actions.find((a) => a.type === 'hu') ?? { type: 'discard', tile: req.discards[0] };
      } else {
        choice = await this.ask(seat, req);
      }

      switch (choice.type) {
        case 'hu': {
          this.win(seat, null, p.drawn ?? p.hand[p.hand.length - 1], { gangDraw });
          return { type: 'hu' };
        }
        case 'angang': {
          removeTiles(p.hand, choice.tile, 4);
          p.melds.push({ type: 'angang', tiles: [choice.tile, choice.tile, choice.tile, choice.tile], from: seat });
          this.recordGang(seat, 'angang', null);
          this.log(`${p.name} 暗杠`);
          break;
        }
        case 'bugang': {
          removeTiles(p.hand, choice.tile);
          p.drawn = null;
          this.log(`${p.name} 补杠 ${tileName(choice.tile)}`);
          this.changed();
          const robbers = await this.robbers(seat, choice.tile);
          if (robbers.length) {
            robbers.forEach((r, i) => this.win(r, seat, choice.tile, { robbing: true }, i > 0));
            return { type: 'robbed', lastSeat: robbers[robbers.length - 1] };
          }
          const meld = p.melds.find((m) => m.type === 'peng' && m.tiles[0] === choice.tile);
          meld.type = 'bugang';
          meld.tiles.push(choice.tile);
          this.recordGang(seat, 'bugang', null);
          break;
        }
        case 'pigang':
        case 'laigang': {
          removeTiles(p.hand, choice.tile);
          p.specials.push(choice.tile);
          this.log(`${p.name} ${choice.label}（${tileName(choice.tile)}）`);
          break;
        }
        default: {
          removeTiles(p.hand, choice.tile);
          p.drawn = null;
          if (choice.type === 'liang') p.liang = true;
          return { type: choice.type, tile: choice.tile, gangDraw };
        }
      }
      // 各种杠之后从牌墙尾部补一张
      p.drawn = null;
      this.changed();
      await this.pause('gang', seat);
      if (!this.wall.length) return { type: 'exhausted' };
      this.drawTile(p, true);
      canHu = true;
      gangDraw = true;
    }
  }

  turnRequest(p, { canHu, gangDraw }) {
    const { v } = this;
    const actions = [];
    const last = this.wall.length === 0;
    if (canHu && v.checkWin(this, p, p.drawn, { self: true, gangDraw, last })) actions.push({ type: 'hu' });

    if (p.liang) {
      return { kind: 'turn', actions, discards: [p.drawn ?? p.hand[p.hand.length - 1]], liang: null };
    }
    for (const g of v.specialGangs?.(this, p) ?? []) actions.push(g);
    if (this.wall.length) {
      for (const t of new Set(p.hand)) {
        if (count(p.hand, t) === 4 && v.canClaimTile(this, p, t)) actions.push({ type: 'angang', tile: t });
      }
      for (const m of p.melds) {
        if (m.type === 'peng' && p.hand.includes(m.tiles[0])) actions.push({ type: 'bugang', tile: m.tiles[0] });
      }
    }
    let discards = v.allowedDiscards?.(this, p) ?? [...new Set(p.hand)];
    if (!discards.length) discards = [...new Set(p.hand)];
    discards = sortTiles(discards);

    let liang = null;
    if (v.liang) {
      liang = discards.filter((t) => {
        const rest = [...p.hand];
        removeTiles(rest, t);
        return this.waits(p, rest).length > 0;
      });
      if (!liang.length) liang = null;
    }
    return { kind: 'turn', actions, discards, liang };
  }

  // hand13 再来哪些牌能胡（按这个玩法的规则）
  waits(p, hand13 = p.hand) {
    return this.v.kinds.filter((t) => this.v.checkWin(this, p, t, { self: false, hand: hand13, probe: true }));
  }

  // shared：一炮多响时第二家以后，这张牌是"共用"的
  win(seat, from, tile, ctx, shared = false) {
    const p = this.players[seat];
    const self = from === null;
    if (!self) p.hand.push(tile);
    // 胡的那张牌在手牌最后（自摸是刚摸的，点炮是刚放进去的）
    const info = this.v.checkWin(this, p, tile, {
      self,
      from,
      hand: p.hand.slice(0, -1),
      ...ctx,
      last: this.wall.length === 0,
    });
    p.won = { tile, from };
    p.drawn = null;
    const record = { seat, from, tile, info, shared, unwon: this.unwon(seat) };
    this.wins.push(record);
    const how = self ? '自摸' : `胡了 ${this.players[from].name} 的 ${tileName(tile)}`;
    this.log(`${p.name} ${how}！${info.title ? `【${info.title}】` : ''}`);
    this.v.onWin?.(this, record);
    this.changed();
  }

  recordGang(seat, type, from) {
    this.gangLog.push({ seat, type, from, unwon: this.unwon(seat) });
  }

  // ---------- 别人打出的牌：胡、碰、杠、吃 ----------

  async claims(fromSeat, tile, { afterGang }) {
    const { v } = this;
    const cands = [];
    const last = this.wall.length === 0;
    for (let k = 1; k < this.n; k++) {
      const seat = (fromSeat + k) % this.n;
      const p = this.players[seat];
      if (p.won) continue;
      const actions = [];
      if (v.checkWin(this, p, tile, { self: false, from: fromSeat, afterGang, last })) actions.push({ type: 'hu' });
      if (!p.liang && v.canClaimTile(this, p, tile)) {
        const c = count(p.hand, tile);
        if (c >= 2) actions.push({ type: 'peng' });
        if (c >= 3 && this.wall.length) actions.push({ type: 'gang' });
        if (v.chi && k === 1) actions.push(...this.chiOptions(p, tile));
      }
      if (actions.length) cands.push({ seat, k, actions });
    }
    if (!cands.length) return null;

    const answers = await Promise.all(cands.map((c) => this.ask(c.seat, { kind: 'claim', tile, from: fromSeat, actions: c.actions })));
    const picked = cands.map((c, i) => ({ ...c, choice: answers[i] })).filter((c) => c.choice.type !== 'pass');
    const hu = picked.filter((c) => c.choice.type === 'hu').sort((a, b) => a.k - b.k);
    if (hu.length) return { type: 'hu', seats: (v.multiWin ? hu : hu.slice(0, 1)).map((c) => c.seat) };
    const pg = picked.find((c) => c.choice.type === 'peng' || c.choice.type === 'gang');
    if (pg) return { type: pg.choice.type, seat: pg.seat };
    const chi = picked.find((c) => c.choice.type === 'chi');
    if (chi) return { type: 'chi', seat: chi.seat, tiles: chi.choice.tiles };
    return null;
  }

  chiOptions(p, tile) {
    if (tile >= 27) return [];
    const r = tile % 9;
    const opts = [];
    for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      if (r + a < 0 || r + b > 8) continue;
      const ta = tile + a;
      const tb = tile + b;
      if (this.isWild(ta) || this.isWild(tb)) continue;
      if (p.hand.includes(ta) && p.hand.includes(tb)) opts.push({ type: 'chi', tiles: [ta, tb] });
    }
    return opts;
  }

  // 抢杠胡：有人补杠时，其他人能不能胡这张牌
  async robbers(fromSeat, tile) {
    const cands = [];
    for (let k = 1; k < this.n; k++) {
      const seat = (fromSeat + k) % this.n;
      const p = this.players[seat];
      if (p.won || !this.v.checkWin(this, p, tile, { self: false, from: fromSeat, robbing: true })) continue;
      cands.push(seat);
    }
    if (!cands.length) return [];
    const answers = await Promise.all(cands.map((seat) => this.ask(seat, { kind: 'claim', tile, from: fromSeat, robbing: true, actions: [{ type: 'hu', label: '抢杠胡' }] })));
    const yes = cands.filter((_, i) => answers[i].type === 'hu');
    return this.v.multiWin ? yes : yes.slice(0, 1);
  }

  // ---------- 询问玩家 ----------

  async ask(seat, req) {
    const p = this.players[seat];
    if (p.isHuman && this.decide) {
      let choice = null;
      try {
        choice = await this.decide(seat, req, this);
      } catch {}
      const ok = this.validate(seat, req, choice);
      if (ok) return ok;
    }
    return this.validate(seat, req, botDecide(this, seat, req)) ?? this.fallback(seat, req);
  }

  fallback(seat, req) {
    const p = this.players[seat];
    switch (req.kind) {
      case 'turn': return { type: 'discard', tile: req.discards[req.discards.length - 1] };
      case 'claim': return { type: 'pass' };
      case 'dingque': return { suit: 0 };
      default: {
        const bySuit = [0, 1, 2].map((s) => p.hand.filter((t) => suitOf(t) === s));
        return { tiles: bySuit.find((s) => s.length >= 3).slice(0, 3) };
      }
    }
  }

  validate(seat, req, c) {
    if (!c || typeof c !== 'object') return null;
    const p = this.players[seat];
    const tile = Number(c.tile);
    switch (req.kind) {
      case 'turn':
        if (c.type === 'discard' && req.discards.includes(tile)) return { type: 'discard', tile };
        if (c.type === 'liang' && req.liang?.includes(tile)) return { type: 'liang', tile };
        return req.actions.find((a) => a.type === c.type && (a.tile === undefined || a.tile === tile)) ?? null;
      case 'claim':
        if (c.type === 'pass') return { type: 'pass' };
        return req.actions.find((a) => a.type === c.type &&
          (a.type !== 'chi' || (Array.isArray(c.tiles) && a.tiles.every((t, i) => t === Number(c.tiles[i]))))) ?? null;
      case 'dingque':
        return [0, 1, 2].includes(Number(c.suit)) ? { suit: Number(c.suit) } : null;
      case 'swap': {
        if (!Array.isArray(c.tiles) || c.tiles.length !== 3) return null;
        const tiles = c.tiles.map(Number);
        const suit = suitOf(tiles[0]);
        if (suit > 2 || tiles.some((t) => suitOf(t) !== suit)) return null;
        const rest = [...p.hand];
        for (const t of tiles) {
          const at = rest.indexOf(t);
          if (at === -1) return null;
          rest.splice(at, 1);
        }
        return { tiles };
      }
    }
    return null;
  }

  // ---------- 给画面用的数据 ----------

  // seat 为 null 表示观战者：只能看到明牌，牌局结束后才能看到所有人的手牌
  view(seat) {
    const end = this.phase === 'end';
    const choosing = this.phase === 'swap' || this.phase === 'dingque';
    return {
      variant: this.v.id,
      n: this.n,
      me: seat,
      phase: this.phase,
      dealer: this.dealer,
      turn: this.turn,
      wall: this.wall.length,
      laizi: this.laizi,
      flip: this.flip,
      pizi: this.pizi,
      lastDiscard: this.lastDiscard,
      revealed: end,
      players: this.players.map((p, i) => {
        const mine = i === seat;
        const open = mine || end || p.liang || Boolean(p.won);
        return {
          name: p.name,
          bot: !p.isHuman,
          handCount: p.hand.length,
          hand: open ? sortTiles(p.hand) : null,
          drawn: mine ? p.drawn : null,
          melds: p.melds.map((m) => ({ type: m.type, tiles: m.type === 'angang' && !mine && !end ? null : m.tiles })),
          // 复制一份：画面和音效要拿新旧两次视图做比较，不能和牌局共用同一个数组
          discards: [...p.discards],
          specials: [...p.specials],
          que: choosing && !mine ? null : p.que,
          liang: p.liang,
          won: p.won ? { tile: p.won.tile, self: p.won.from === null } : null,
        };
      }),
      result: end ? this.result : null,
    };
  }
}

// 用画面数据（view）造一个只读的"牌局"，给提示功能算听牌、建议出牌用。
// 联网时浏览器里没有完整的牌局，只有自己能看到的牌，这样也够用了。
export function probeEngine(variant, view) {
  const e = Object.create(Engine.prototype);
  Object.assign(e, {
    v: variant,
    n: view.n,
    laizi: view.laizi,
    pizi: view.pizi,
    wall: { length: view.wall },
    players: view.players.map((p) => ({
      ...p,
      hand: p.hand ?? [],
      melds: p.melds.map((m) => ({ type: m.type, tiles: m.tiles ?? [] })),
    })),
  });
  return e;
}
