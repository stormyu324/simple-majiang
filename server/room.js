// 一个房间 = 一个 Durable Object。保存座位、观战者、玩法、累计积分和正在进行的对局，
// 所有牌局判定都在这里做；每个连接只收到它有权看到的内容：
//   - 玩家：自己的手牌 + 所有明牌（打出的、碰出的、亮倒的、每家张数）
//   - 观战者：只有明牌，局结束后才能看到所有人的手牌
import { Engine } from '../src/engine.js';
import { DEFAULT_VARIANT, VARIANTS, getVariant } from '../src/variants.js';

const WINDS = ['东', '南', '西', '北'];
const TURN_TIMEOUT = 30_000; // 出牌限时，超时由电脑替他打
const CLAIM_TIMEOUT = 15_000; // 胡/碰/杠/吃 限时
const SETUP_TIMEOUT = 30_000; // 换三张、定缺 限时
const DISCONNECTED_DELAY = 600; // 掉线的玩家由电脑代打，稍等一下让大家看清
const ROOM_TTL = 6 * 60 * 60 * 1000; // 房间号空闲 6 小时后可以被重新分配
const MAX_NAME = 12;
const MAX_LOG = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forever = () => new Promise(() => {});
const cleanName = (name) => String(name ?? '').trim().slice(0, MAX_NAME) || '玩家';

export class MajiangRoom {
  constructor(state) {
    this.state = state;
    this.seats = [null, null, null, null]; // { name, token, ws, connected, joinOrder }
    this.conns = new Map(); // ws -> { seat: number|null, role: 'player'|'spectator'|null }
    this.phase = 'lobby'; // lobby | playing | ended
    this.variant = DEFAULT_VARIANT;
    this.totals = [0, 0, 0, 0];
    this.dealer = 0;
    this.game = null;
    this.pending = [null, null, null, null]; // 正在等某个座位的玩家操作
    this.askCounter = 0;
    this.logs = [];
    this.joinCounter = 0;
  }

  get n() {
    return getVariant(this.variant).players;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/claim') {
      // 创建房间：没人在用、并且很久没被创建过的房间号才能分配出去
      const claimed = await this.state.storage.get('claimed');
      if (this.conns.size > 0 || (claimed && Date.now() - claimed < ROOM_TTL)) {
        return new Response('taken', { status: 409 });
      }
      const body = await request.json().catch(() => ({}));
      await this.state.storage.put('claimed', Date.now());
      this.reset(VARIANTS[body.variant] ? body.variant : DEFAULT_VARIANT);
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

  reset(variant) {
    this.seats = [null, null, null, null];
    this.phase = 'lobby';
    this.variant = variant;
    this.totals = [0, 0, 0, 0];
    this.dealer = 0;
    this.game = null;
    this.pending = [null, null, null, null];
    this.logs = [];
  }

  attach(ws) {
    this.conns.set(ws, { seat: null, role: null });
    ws.addEventListener('message', (e) => {
      try {
        this.onMessage(ws, JSON.parse(e.data));
      } catch {
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
      case 'variant':
        if (conn.seat !== this.hostSeat()) return;
        return this.setVariant(ws, msg.id);
      case 'act': {
        const p = conn.seat === null ? null : this.pending[conn.seat];
        if (!p) return;
        const choice = this.game.validate(conn.seat, p.req, msg.choice);
        if (!choice) return this.send(ws, { t: 'error', msg: '这一步不能这样走' });
        return p.done(choice);
      }
      case 'ping':
        return this.send(ws, { t: 'pong' });
    }
  }

  freeSeat() {
    return this.seats.slice(0, this.n).findIndex((s) => s === null);
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
        seat = this.freeSeat();
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

  // 观战者在开局前、或两局之间坐到空位上
  sit(ws, conn, msg) {
    if (conn.role !== 'spectator') return;
    if (this.phase === 'playing') return this.send(ws, { t: 'error', msg: '对局进行中，这局结束后才能入座' });
    const seat = this.freeSeat();
    if (seat === -1) return this.send(ws, { t: 'error', msg: '没有空座位了' });
    const name = cleanName(msg.name);
    this.seats[seat] = { name, token: crypto.randomUUID(), ws, connected: true, joinOrder: ++this.joinCounter };
    conn.seat = seat;
    conn.role = 'player';
    this.send(ws, { t: 'welcome', role: 'player', seat, token: this.seats[seat].token, notice: '已入座', logs: this.logs });
    this.log(`${name} 入座了`);
    this.broadcast();
  }

  // 房主换玩法：积分清零；换成 3 人玩法时，北家的玩家挪到空位上
  setVariant(ws, id) {
    if (this.phase === 'playing' || !VARIANTS[id] || id === this.variant) return;
    const n = VARIANTS[id].players;
    const extra = this.seats.slice(n).filter(Boolean);
    const free = this.seats.slice(0, n).map((s, i) => (s ? -1 : i)).filter((i) => i !== -1);
    if (extra.length > free.length) {
      return this.send(ws, { t: 'error', msg: `${VARIANTS[id].name}只有 ${n} 个座位，人太多了` });
    }
    for (let i = n; i < 4; i++) {
      const s = this.seats[i];
      if (!s) continue;
      const to = free.shift();
      this.seats[to] = s;
      this.seats[i] = null;
      for (const c of this.conns.values()) if (c.seat === i) c.seat = to;
    }
    this.variant = id;
    this.totals = [0, 0, 0, 0];
    this.dealer = 0;
    this.phase = 'lobby';
    this.game = null;
    this.log(`玩法换成了 ${VARIANTS[id].name}，积分清零`);
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
        this.pending[seat]?.done(null);
      }
    }
    this.broadcast();
  }

  // 等某个座位的真人回答；掉线或超时返回 null，由电脑代替
  ask(seat, req) {
    const s = this.seats[seat];
    if (!s || !s.connected) return sleep(DISCONNECTED_DELAY).then(() => null);
    const timeout = req.kind === 'turn' ? TURN_TIMEOUT : req.kind === 'claim' ? CLAIM_TIMEOUT : SETUP_TIMEOUT;
    return new Promise((resolve) => {
      const p = {
        id: ++this.askCounter,
        req,
        deadline: Date.now() + timeout,
        done: (value) => {
          if (this.pending[seat] !== p) return;
          clearTimeout(p.timer);
          this.pending[seat] = null;
          resolve(value);
          this.broadcast();
        },
      };
      p.timer = setTimeout(() => p.done(null), timeout);
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
    const n = this.n;
    const names = this.seats.slice(0, n).map((s, i) => s?.name ?? `电脑·${WINDS[i]}`);
    const humans = this.seats.slice(0, n).map((s) => s !== null);

    this.logs = [];
    this.phase = 'playing';
    const game = new Engine(getVariant(this.variant), {
      names,
      humans,
      dealer: this.dealer,
      decide: (seat, req) => this.ask(seat, req),
      log: (msg) => this.game === game && this.log(msg),
      onChange: () => this.game === game && this.broadcast(),
      pause: async (kind, seat) => {
        await sleep(kind === 'discard' ? (humans[seat] ? 300 : 800) : 500);
        if (this.game !== game) await forever();
      },
    });
    this.game = game;
    game.play().then((result) => {
      if (this.game !== game) return;
      result.deltas.forEach((d, i) => { this.totals[i] += d; });
      this.dealer = result.nextDealer;
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
    const n = this.n;
    const lobby = {
      phase: this.phase,
      host: this.hostSeat(),
      variant: this.variant,
      n,
      spectators: [...this.conns.values()].filter((c) => c.role === 'spectator').length,
      seats: this.seats.map((s) => (s ? { name: s.name, connected: s.connected } : null)),
    };
    const totals = this.totals.slice(0, n);
    const g = this.game;
    if (!g) return { t: 'state', me: seat, lobby, view: null, pending: null, totals };

    const view = g.view(seat);
    view.players.forEach((p, i) => {
      p.connected = p.bot ? true : Boolean(this.seats[i]?.connected);
    });
    const mine = seat !== null ? this.pending[seat] : null;
    const pending = mine ? { id: mine.id, ...mine.req, remainingMs: Math.max(0, mine.deadline - Date.now()) } : null;
    return { t: 'state', me: seat, lobby, view, pending, totals };
  }
}
