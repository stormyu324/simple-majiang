// 一个房间 = 一个 Durable Object。保存座位、观战者和正在进行的对局，
// 所有牌局判定都在这里做；每个连接只收到它有权看到的内容：
//   - 玩家：自己的手牌 + 所有明牌（打出的、碰出的、每家张数）
//   - 观战者：只有明牌，局结束后才能看到所有人的手牌
import { Game } from '../src/game.js';
import { chooseDiscard } from '../src/ai.js';

const WINDS = ['东', '南', '西', '北'];
const DISCARD_TIMEOUT = 30_000; // 出牌限时，超时自动打出建议的牌
const CHOICE_TIMEOUT = 15_000; // 胡/碰 限时，超时：能胡就胡，碰就算了
const DISCONNECTED_DELAY = 600; // 掉线的玩家由电脑代打，稍等一下让大家看清
const ROOM_TTL = 6 * 60 * 60 * 1000; // 房间号空闲 6 小时后可以被重新分配
const MAX_NAME = 12;
const MAX_LOG = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanName = (name) => String(name ?? '').trim().slice(0, MAX_NAME) || '玩家';
const forever = () => new Promise(() => {});

class ServerGame extends Game {
  constructor(room, names, humans) {
    super({ log: (msg) => room.log(msg), ask: () => Promise.reject(new Error('unused')) }, Math.random, names, humans);
    this.room = room;
    this.lastDiscard = null;
    this.revealed = false;
    this.result = null;
  }

  isCurrent() {
    return this.room.game === this;
  }

  deal() {
    super.deal();
    this.room.broadcast();
  }

  showTable() {}

  // 摸到的牌只出现在这个玩家自己的画面里，不写进公开记录
  showDrawn() {
    this.room.broadcast();
  }

  async afterDiscard(seat, tile) {
    this.lastDiscard = { seat, tile };
    this.room.broadcast();
    await sleep(this.players[seat].isHuman ? 300 : 800);
    if (!this.isCurrent()) await forever();
  }

  async checkClaims(fromSeat, tile) {
    const claim = await super.checkClaims(fromSeat, tile);
    if (claim?.type === 'peng') this.lastDiscard = null;
    return claim;
  }

  humanDiscard(player) {
    const seat = this.players.indexOf(player);
    return this.room.ask(seat, { type: 'discard' }, () => chooseDiscard(player.hand));
  }

  confirm(question, action, player) {
    const seat = this.players.indexOf(player);
    // 超时或掉线时：能胡就替他胡，碰就不碰
    return this.room.ask(seat, { type: 'choice', question, action }, () => action !== '碰');
  }

  announceWin(player, how) {
    super.announceWin(player, how);
    this.result = { seat: this.players.indexOf(player), how };
  }
}

export class MajiangRoom {
  constructor(state) {
    this.state = state;
    this.seats = [null, null, null, null]; // { name, token, ws, connected, joinOrder }
    this.conns = new Map(); // ws -> { seat: number|null, role: 'player'|'spectator'|null }
    this.phase = 'lobby'; // lobby | playing | ended
    this.game = null;
    this.pending = [null, null, null, null]; // 正在等某个座位的玩家操作
    this.logs = [];
    this.joinCounter = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/claim') {
      // 创建房间：没人在用、并且很久没被创建过的房间号才能分配出去
      const claimed = await this.state.storage.get('claimed');
      if (this.conns.size > 0 || (claimed && Date.now() - claimed < ROOM_TTL)) {
        return new Response('taken', { status: 409 });
      }
      await this.state.storage.put('claimed', Date.now());
      this.reset();
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('需要 WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const claimed = await this.state.storage.get('claimed');
    if (!claimed) {
      server.send(JSON.stringify({ t: 'error', fatal: true, msg: '房间不存在，请检查房间号' }));
      server.close(4004, 'no such room');
    } else {
      this.attach(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  reset() {
    this.seats = [null, null, null, null];
    this.phase = 'lobby';
    this.game = null;
    this.pending = [null, null, null, null];
    this.logs = [];
  }

  attach(ws) {
    this.conns.set(ws, { seat: null, role: null });
    ws.addEventListener('message', (e) => {
      try {
        this.onMessage(ws, JSON.parse(e.data));
      } catch (err) {
        this.send(ws, { t: 'error', msg: '消息格式不对' });
      }
    });
    const close = () => this.onClose(ws);
    ws.addEventListener('close', close);
    ws.addEventListener('error', close);
  }

  // ---------- 消息处理 ----------

  onMessage(ws, msg) {
    const conn = this.conns.get(ws);
    if (!conn) return;

    switch (msg.t) {
      case 'join':
        return this.join(ws, conn, msg);
      case 'sit':
        return this.sit(ws, conn, msg);
      case 'start':
        if (conn.seat !== this.hostSeat() || this.phase === 'playing') return;
        return this.startGame();
      case 'discard': {
        const p = this.pending[conn.seat];
        const tile = Number(msg.tile);
        if (!p || p.type !== 'discard' || !this.game.players[conn.seat].hand.includes(tile)) return;
        return p.done(tile);
      }
      case 'choice': {
        const p = this.pending[conn.seat];
        if (!p || p.type !== 'choice') return;
        return p.done(Boolean(msg.yes));
      }
      case 'ping':
        return this.send(ws, { t: 'pong' });
    }
  }

  // 观战者在开局前、或两局之间坐到空位上
  sit(ws, conn, msg) {
    if (conn.role !== 'spectator') return;
    if (this.phase === 'playing') return this.send(ws, { t: 'error', msg: '对局进行中，这局结束后才能入座' });
    const seat = this.seats.findIndex((s) => s === null);
    if (seat === -1) return this.send(ws, { t: 'error', msg: '没有空座位了' });
    const name = cleanName(msg.name);
    this.seats[seat] = { name, token: crypto.randomUUID(), ws, connected: true, joinOrder: ++this.joinCounter };
    conn.seat = seat;
    conn.role = 'player';
    this.send(ws, { t: 'welcome', role: 'player', seat, token: this.seats[seat].token, notice: '已入座', logs: this.logs });
    this.log(`${name} 入座了`);
    this.broadcast();
  }

  join(ws, conn, msg) {
    if (conn.role) return; // 每个连接只能 join 一次
    const name = cleanName(msg.name);

    let seat = null;
    let notice = null;
    if (msg.role === 'player') {
      // 断线重连：凭 token 回到原来的座位
      const back = this.seats.findIndex((s) => s && msg.token && s.token === msg.token);
      if (back !== -1) {
        seat = back;
        const s = this.seats[seat];
        if (s.ws && s.ws !== ws) {
          this.conns.delete(s.ws);
          try { s.ws.close(4000, 'replaced'); } catch {}
        }
        s.ws = ws;
        s.connected = true;
      } else if (this.phase !== 'playing') {
        // 开局前、或者一局打完等下一局时，可以坐空位
        seat = this.seats.findIndex((s) => s === null);
        if (seat !== -1) {
          this.seats[seat] = { name, token: crypto.randomUUID(), ws, connected: true, joinOrder: ++this.joinCounter };
        } else {
          seat = null;
          notice = '房间已满，你正在观战';
        }
      } else {
        notice = '对局已经开始，你正在观战，下一局开始前可以入座';
      }
    }

    conn.seat = seat;
    conn.role = seat === null ? 'spectator' : 'player';
    this.send(ws, {
      t: 'welcome',
      role: conn.role,
      seat,
      token: seat === null ? null : this.seats[seat].token,
      notice,
      logs: this.logs,
    });
    if (seat !== null) this.log(`${this.seats[seat].name} ${this.phase === 'playing' ? '回来了' : '进入了房间'}`);
    this.broadcast();
  }

  onClose(ws) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    const seat = conn.seat;
    if (seat !== null && this.seats[seat]?.ws === ws) {
      const s = this.seats[seat];
      if (this.phase === 'lobby') {
        this.seats[seat] = null; // 还没开局就直接空出座位
        this.log(`${s.name} 离开了房间`);
      } else {
        s.connected = false;
        s.ws = null;
        this.log(`${s.name} 掉线了，电脑先替他打`);
        // 正在等他操作的话，马上交给电脑
        const p = this.pending[seat];
        if (p) p.done(p.auto());
      }
    }
    this.broadcast();
  }

  // 等某个座位的真人操作；掉线或超时就用 auto() 代替
  ask(seat, prompt, auto) {
    const s = this.seats[seat];
    if (!s || !s.connected) return sleep(DISCONNECTED_DELAY).then(auto);
    const timeout = prompt.type === 'discard' ? DISCARD_TIMEOUT : CHOICE_TIMEOUT;
    return new Promise((resolve) => {
      const p = {
        ...prompt,
        auto,
        deadline: Date.now() + timeout,
        done: (value) => {
          if (this.pending[seat] !== p) return;
          clearTimeout(p.timer);
          this.pending[seat] = null;
          resolve(value);
        },
      };
      p.timer = setTimeout(() => p.done(auto()), timeout);
      this.pending[seat] = p;
      this.broadcast();
    });
  }

  hostSeat() {
    let host = null;
    this.seats.forEach((s, i) => {
      if (s?.connected && (host === null || s.joinOrder < this.seats[host].joinOrder)) host = i;
    });
    return host;
  }

  startGame() {
    // 上一局掉线没回来的玩家让出座位，空座位都由电脑来打
    this.seats = this.seats.map((s) => (s?.connected ? s : null));
    this.pending.forEach((p) => p && clearTimeout(p.timer));
    this.pending = [null, null, null, null];
    const names = this.seats.map((s, i) => s?.name ?? `电脑·${WINDS[i]}`);
    const humans = this.seats.map((s) => s !== null);

    this.logs = [];
    this.phase = 'playing';
    const game = new ServerGame(this, names, humans);
    this.game = game;
    game.play().then((winner) => {
      if (!game.isCurrent()) return;
      game.revealed = true;
      game.winner = winner;
      this.phase = 'ended';
      this.broadcast();
    }).catch((err) => {
      this.log(`出错了：${err.message}`);
    });
  }

  // ---------- 发送 ----------

  log(msg) {
    const text = String(msg).trim();
    if (!text || /^[-=]+$/.test(text)) return;
    this.logs.push(text);
    if (this.logs.length > MAX_LOG) this.logs.shift();
    for (const ws of this.conns.keys()) this.send(ws, { t: 'log', msg: text });
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch {}
  }

  broadcast() {
    for (const [ws, conn] of this.conns) {
      if (conn.role) this.send(ws, this.stateFor(conn.seat));
    }
  }

  // seat 为 null 表示观战者
  stateFor(seat) {
    const host = this.hostSeat();
    const lobby = {
      phase: this.phase,
      host,
      spectators: [...this.conns.values()].filter((c) => c.role === 'spectator').length,
      seats: this.seats.map((s) => (s ? { name: s.name, connected: s.connected } : null)),
    };
    const g = this.game;
    if (!g) return { t: 'state', me: seat, lobby, view: null, result: null };

    const players = g.players.map((p, i) => {
      const canSeeHand = i === seat || g.revealed;
      return {
        name: p.name,
        bot: !p.isHuman,
        connected: p.isHuman ? Boolean(this.seats[i]?.connected) : true,
        handCount: p.hand.length,
        hand: canSeeHand ? [...p.hand] : null,
        drawn: i === seat ? (p.drawn ?? null) : null,
        melds: p.melds,
        discards: p.discards,
      };
    });
    const mine = seat !== null ? this.pending[seat] : null;
    const pending = mine
      ? { type: mine.type, question: mine.question, action: mine.action, remainingMs: Math.max(0, mine.deadline - Date.now()) }
      : null;

    let result = null;
    if (this.phase === 'ended') {
      result = g.winner === -1 || !g.result ? { draw: true } : g.result;
    }

    return {
      t: 'state',
      me: seat,
      lobby,
      view: { players, wall: g.wall.length, turn: g.turn, lastDiscard: g.lastDiscard, revealed: g.revealed, pending },
      result,
    };
  }
}
