import { Game } from '../src/game.js';
import { sortTiles, tileName } from '../src/tiles.js';
import { waitingTiles } from '../src/rules.js';
import { chooseDiscard } from '../src/ai.js';
import { tileHTML, backHTML } from './tile-art.js';
import { openTutorial } from './tutorial.js';
import { createRoom, hasSeat, OnlineRoom } from './online.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 电脑出牌后停顿多久（毫秒），让人看得清
const AI_DELAY = 700;
const HUMAN_DELAY = 250;

// 触屏设备（手机、平板）上点两下才打出：第一下选中，第二下确认，防止手指点错
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

const WINDS = ['东', '南', '西', '北'];

// 玩家名字来自其他人的输入，放进 HTML 前一定要转义
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// localStorage 在隐私模式等情况下可能不可用，读写都包一层
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// ---------- 界面状态 ----------
//
// 画面只根据"视图"来画：单机模式由 WebGame.toView() 生成，联网模式由服务器发来。
// 视图里只有当前这个人能看到的东西（观战者的视图里没有任何人的手牌）。

const ui = {
  mode: null, // null（菜单）| 'solo' | 'online'
  game: null, // 单机：当前这一局
  room: null, // 联网：OnlineRoom 连接
  online: null, // 联网：服务器发来的最新状态 { me, lobby, view, result }
  code: null, // 联网：房间号
  conn: 'connecting', // 联网：连接状态
  lastPhase: null,
  onDiscard: null, // 轮到自己出牌时的回调
  choice: null, // 等待自己选择 胡/碰 时的状态
  deadline: null, // 联网：这次操作的截止时间
  selected: null, // 触屏上第一下选中的牌在手牌里的位置（data-pos）
  selectedTile: null, // 选中的是哪种牌
  hints: load('mj-hints') === 'on', // 是否显示出牌建议和听牌
};

// ---------- 单机：把命令行的输入输出换成画面和点击 ----------

class WebGame extends Game {
  constructor() {
    super({
      log: (msg) => this.isCurrent() && addLog(msg),
      ask: () => Promise.reject(new Error('网页版不使用文字输入')),
    });
    this.lastDiscard = null;
    this.revealed = false;
    this.result = null;
  }

  // 点了"重新开始"或回到菜单后，旧的一局就不再是当前局
  isCurrent() {
    return ui.mode === 'solo' && ui.game === this;
  }

  refresh() {
    if (this.isCurrent()) refresh();
  }

  deal() {
    super.deal();
    this.refresh();
  }

  showTable() {
    this.refresh();
  }

  async afterDiscard(seat, tile) {
    this.lastDiscard = { seat, tile };
    this.refresh();
    await sleep(seat === 0 ? HUMAN_DELAY : AI_DELAY);
    // 旧的一局停在这里，永远不再继续
    if (!this.isCurrent()) await new Promise(() => {});
  }

  async checkClaims(fromSeat, tile) {
    const claim = await super.checkClaims(fromSeat, tile);
    if (claim?.type === 'peng') this.lastDiscard = null;
    return claim;
  }

  humanDiscard() {
    return new Promise((resolve) => {
      ui.selected = null;
      ui.onDiscard = (tile) => {
        ui.onDiscard = null;
        ui.selected = null;
        resolve(tile);
      };
      this.refresh();
    });
  }

  confirm(question, action) {
    return new Promise((resolve) => {
      ui.choice = {
        question,
        action,
        resolve: (yes) => {
          ui.choice = null;
          resolve(yes);
        },
      };
      this.refresh();
    });
  }

  announceWin(player, how) {
    super.announceWin(player, how);
    this.result = { seat: this.players.indexOf(player), how };
  }

  toView() {
    return {
      me: 0,
      players: this.players.map((p, i) => ({
        name: p.name,
        bot: !p.isHuman,
        connected: true,
        handCount: p.hand.length,
        hand: i === 0 || this.revealed ? p.hand : null,
        drawn: i === 0 ? (p.drawn ?? null) : null,
        melds: p.melds,
        discards: p.discards,
      })),
      wall: this.wall.length,
      turn: this.turn,
      lastDiscard: this.lastDiscard,
      revealed: this.revealed,
    };
  }
}

function addLog(msg) {
  const text = String(msg).trim();
  if (!text || /^[-=]+$/.test(text)) return;
  const log = $('#log');
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 40) log.lastChild.remove();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- 渲染牌桌 ----------

function meldsHTML(player) {
  return player.melds
    .map((m) => `<div class="meld">${m.map((t) => tileHTML(t, { cls: 'sm' })).join('')}</div>`)
    .join('');
}

function discardsHTML(player) {
  return player.discards.map((t) => tileHTML(t, { cls: 'xs' })).join('');
}

function nameHTML(view, seat) {
  const p = view.players[seat];
  if (ui.mode !== 'online') return esc(p.name);
  let tags = '';
  if (seat === view.me) tags += '<span class="tag me">你</span>';
  if (p.bot) tags += '<span class="tag">电脑</span>';
  else if (!p.connected) tags += '<span class="tag warn">掉线·电脑代打</span>';
  return `<span class="wind">${WINDS[seat]}</span>${esc(p.name)}${tags}`;
}

function otherHTML(view, seat) {
  const p = view.players[seat];
  const hand = p.hand
    ? sortTiles(p.hand).map((t) => tileHTML(t, { cls: 'sm' })).join('')
    : backHTML('sm').repeat(p.handCount);
  return `
    <div class="seat-head"><span class="name">${nameHTML(view, seat)}</span><span class="count">${p.handCount} 张</span></div>
    <div class="hand-row">${hand}</div>
    <div class="melds">${meldsHTML(p)}</div>
    <div class="discards">${discardsHTML(p)}</div>`;
}

// 自己能看到的所有明牌：手牌、各家碰出的牌、各家打出的牌
function visibleTiles(view, hand) {
  const seen = [...hand];
  for (const p of view.players) seen.push(...p.melds.flat(), ...p.discards);
  return seen;
}

// 提示：轮到出牌时给出建议，平时显示听哪些牌
function hintFor(view, canClick) {
  if (!ui.hints || view.revealed) return { text: '', suggest: null };
  const p = view.players[view.me];
  if (canClick) {
    const suggest = chooseDiscard(p.hand);
    const after = [...p.hand];
    after.splice(after.indexOf(suggest), 1);
    const waits = waitingTiles(after, visibleTiles(view, [...after, suggest]));
    const text = `💡 建议打 <b>${tileName(suggest)}</b>` +
      (waits.length ? `，打完就听：<b>${waits.map(tileName).join('、')}</b>` : '');
    return { text, suggest };
  }
  const waits = waitingTiles(p.hand, visibleTiles(view, p.hand));
  const text = waits.length ? `💡 听牌中！等：<b>${waits.map(tileName).join('、')}</b>` : '💡 还没听牌，继续凑面子';
  return { text, suggest: null };
}

function countdownHTML() {
  return ui.deadline ? ' <span class="countdown"></span>' : '';
}

function myHTML(view) {
  const p = view.players[view.me];
  const rest = [...p.hand];
  if (p.drawn != null) rest.splice(rest.indexOf(p.drawn), 1);
  const canClick = ui.onDiscard != null;
  const hint = hintFor(view, canClick);
  // 建议的牌只高亮一张：是刚摸的牌就高亮它，否则高亮手牌里的第一张
  let pendingMark = hint.suggest != null && p.drawn !== hint.suggest;
  // 每张牌按显示顺序编号，同样的牌有好几张时也能分清选中的是哪一张
  let pos = 0;
  const tile = (t, isDrawn = false) => {
    let cls = canClick ? 'clickable' : '';
    const markThis = isDrawn ? hint.suggest === t : pendingMark && t === hint.suggest;
    if (markThis) {
      cls += ' suggest';
      pendingMark = false;
    }
    if (canClick && ui.selected === pos) cls += ' selected';
    return tileHTML(t, { cls, attrs: `data-tile="${t}" data-pos="${pos++}"` });
  };
  const handHTML = sortTiles(rest).map((t) => tile(t)).join('');
  const drawn = p.drawn != null ? `<div class="drawn">${tile(p.drawn, true)}</div>` : '';

  let actions = '';
  if (ui.choice) {
    actions = `<span class="prompt">${esc(ui.choice.question)}${countdownHTML()}</span>
      <button class="btn primary" data-choice="yes">${esc(ui.choice.action)}</button>
      <button class="btn" data-choice="no">过</button>`;
  } else if (canClick && TOUCH && ui.selected != null) {
    actions = `<span class="prompt">再点一次 <b>${tileName(ui.selectedTile)}</b> 打出，点别的牌换一张${countdownHTML()}</span>`;
  } else if (canClick) {
    actions = `<span class="prompt">${TOUCH ? '轮到你了：点一张牌选中，再点一次打出' : '轮到你了，点一张牌打出'}${countdownHTML()}</span>`;
  }

  const head = ui.mode === 'online'
    ? `<div class="seat-head"><span class="name">${nameHTML(view, view.me)}</span></div>`
    : '';
  return `
    ${head}
    <div class="discards">${discardsHTML(p)}</div>
    <div class="actions">${actions}</div>
    ${hint.text ? `<div class="hint">${hint.text}</div>` : ''}
    <div class="my-hand">
      <div class="melds">${meldsHTML(p)}</div>
      <div class="hand-row">${handHTML}</div>
      ${drawn}
    </div>`;
}

function centerHTML(view) {
  const last = view.lastDiscard;
  const lastHTML = last
    ? `<div class="last-label">${esc(view.players[last.seat].name)} 打出</div>${tileHTML(last.tile, { cls: 'lg' })}`
    : '<div class="last-label">&nbsp;</div><div class="tile lg ghost"></div>';
  return `
    <div class="wall">牌墙剩余 <b>${view.wall}</b> 张</div>
    <div class="last">${lastHTML}</div>`;
}

// 自己坐在下方；观战者从东家的角度看
function render(view) {
  const base = view.me ?? 0;
  for (let seat = 0; seat < 4; seat++) {
    const el = $(`#seat-${(seat - base + 4) % 4}`);
    el.innerHTML = seat === view.me ? myHTML(view) : otherHTML(view, seat);
    el.classList.toggle('active', view.turn === seat && !view.revealed);
  }
  $('#center').innerHTML = centerHTML(view);
  updateCountdown();
}

function currentView() {
  if (ui.mode === 'solo') return ui.game?.toView() ?? null;
  // 服务器把 me 放在视图外面，合进来；观战者的 me 是 null
  if (ui.mode === 'online') return ui.online?.view ? { ...ui.online.view, me: ui.online.me } : null;
  return null;
}

function refresh() {
  const view = currentView();
  $('.table').hidden = !view;
  if (view) render(view);
  renderRoomBar();
}

function updateCountdown() {
  if (!ui.deadline) return;
  const left = Math.max(0, Math.ceil((ui.deadline - Date.now()) / 1000));
  document.querySelectorAll('.countdown').forEach((el) => {
    el.textContent = `${left} 秒`;
    el.classList.toggle('urgent', left <= 5);
  });
}
setInterval(updateCountdown, 500);

// ---------- 结果弹窗 ----------

function showResult(view, result, again) {
  const box = $('#result');
  if (!result || result.draw) {
    box.querySelector('h2').textContent = '流局';
    box.querySelector('.detail').textContent = '牌墙摸完了，没有人胡牌。';
    box.querySelector('.hand-row').innerHTML = '';
  } else {
    const p = view.players[result.seat];
    const mine = result.seat === view.me;
    box.querySelector('h2').textContent = mine ? '你赢了！' : `${p.name} 赢了`;
    box.querySelector('.detail').textContent = `${p.name} ${result.how}`;
    const tiles = [...p.melds.flat(), ...sortTiles(p.hand ?? [])];
    box.querySelector('.hand-row').innerHTML = tiles.map((t) => tileHTML(t, { cls: 'sm' })).join('');
  }
  const btn = $('#again');
  btn.textContent = again.label;
  btn.disabled = !again.enabled;
  box.hidden = false;
}

// ---------- 单机 ----------

async function newSoloGame() {
  ui.onDiscard = null;
  ui.choice = null;
  ui.deadline = null;
  $('#result').hidden = true;
  $('#log').innerHTML = '';

  const game = new WebGame();
  ui.game = game;
  const winner = await game.play();
  if (!game.isCurrent()) return;

  game.revealed = true;
  refresh();
  showResult(game.toView(), winner === -1 ? null : game.result, { label: '再来一局', enabled: true });
}

function startSolo() {
  leaveRoom();
  ui.mode = 'solo';
  setScreen(null);
  document.body.dataset.mode = 'solo';
  newSoloGame();
  // 第一次来的玩家自动打开新手教学
  if (!load('mj-tutorial-seen')) startTutorial();
}

// ---------- 联网 ----------

function playerName() {
  const name = $('#name').value.trim().slice(0, 12);
  if (name) save('mj-name', name);
  return name || '玩家';
}

function enterRoom(code, role) {
  leaveRoom();
  ui.mode = 'online';
  ui.code = code;
  ui.online = null;
  ui.lastPhase = null;
  ui.onDiscard = null;
  ui.choice = null;
  ui.deadline = null;
  document.body.dataset.mode = 'online';
  $('#result').hidden = true;
  $('#log').innerHTML = '';
  // 地址栏带上房间号，刷新页面可以回到房间
  history.replaceState(null, '', `?room=${code}`);
  setScreen('room');
  renderLobbyRoom();
  ui.room = new OnlineRoom(code, role, playerName(), {
    onMessage: onRoomMessage,
    onStatus: (status) => {
      ui.conn = status;
      if (status === 'failed' && !ui.online) {
        backToMenu();
        showLobbyError('连不上房间服务器。好友对战只能在 games.stormnovalabs.com/majiang/ 上玩');
        return;
      }
      if (status === 'replaced') toast('这个座位在别的窗口打开了');
      renderLobbyRoom();
      renderRoomBar();
    },
  });
}

function leaveRoom() {
  if (ui.room) ui.room.close();
  ui.room = null;
  ui.online = null;
  ui.code = null;
}

function onRoomMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      $('#log').innerHTML = '';
      for (const line of msg.logs ?? []) addLog(line);
      if (msg.notice) toast(msg.notice);
      return;
    case 'log':
      return addLog(msg.msg);
    case 'error':
      if (msg.fatal) {
        backToMenu();
        showLobbyError(msg.msg);
      } else {
        toast(msg.msg);
      }
      return;
    case 'state':
      return onRoomState(msg);
  }
}

function onRoomState(state) {
  const prevPhase = ui.lastPhase;
  ui.online = state;
  const phase = state.lobby.phase;
  ui.lastPhase = phase;

  // 服务器说现在轮到我做什么
  const pending = state.view?.pending;
  if (pending?.type === 'discard') {
    if (!ui.onDiscard) ui.selected = null;
    ui.onDiscard = (tile) => {
      ui.room.send({ t: 'discard', tile });
      ui.onDiscard = null;
      ui.selected = null;
      ui.deadline = null;
      refresh();
    };
  } else {
    ui.onDiscard = null;
    ui.selected = null;
  }
  ui.choice = pending?.type === 'choice'
    ? {
        question: pending.question,
        action: pending.action,
        resolve: (yes) => {
          ui.room.send({ t: 'choice', yes });
          ui.choice = null;
          ui.deadline = null;
          refresh();
        },
      }
    : null;
  ui.deadline = pending ? Date.now() + pending.remainingMs : null;

  if (phase === 'playing' && prevPhase !== 'playing') {
    // 新的一局开始
    $('#result').hidden = true;
  }
  setScreen(phase === 'lobby' ? 'room' : null);
  if (phase === 'lobby') renderLobbyRoom();

  refresh();

  if (phase === 'ended' && prevPhase === 'playing') {
    const isHost = state.me !== null && state.me === state.lobby.host;
    showResult(currentView(), state.result.draw ? null : state.result, isHost
      ? { label: '再来一局', enabled: true }
      : { label: '等房主开始下一局', enabled: false });
  }
}

function shareLink() {
  return `${location.origin}${location.pathname}?room=${ui.code}`;
}

async function copyInvite() {
  const link = shareLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('邀请链接已复制，发给好友就能加入');
  } catch {
    toast(`把这个链接发给好友：${link}`);
  }
}

const CONN_TEXT = {
  connecting: '正在连接…',
  reconnecting: '连接断了，正在重连…',
  closed: '已断开',
  failed: '连接失败',
  replaced: '已在别的窗口打开',
};

// 观战者在开局前或两局之间，有空座位就能坐下
function canSit(state) {
  return state.me === null && state.lobby.phase !== 'playing' && state.lobby.seats.includes(null);
}

function renderRoomBar() {
  const bar = $('#room-bar');
  if (ui.mode !== 'online' || !ui.online || ui.online.lobby.phase === 'lobby') {
    bar.hidden = true;
    return;
  }
  const { lobby, me } = ui.online;
  const isHost = me !== null && me === lobby.host;
  const parts = [
    `房间 <b>${ui.code}</b>`,
    me === null ? '👀 你在观战' : `你是<b>${WINDS[me]}</b>家`,
    `观战 ${lobby.spectators} 人`,
  ];
  if (CONN_TEXT[ui.conn]) parts.push(`<span class="warn">${CONN_TEXT[ui.conn]}</span>`);
  bar.innerHTML = `<span class="room-info">${parts.join(' · ')}</span>
    <span class="room-actions">
      ${isHost && lobby.phase === 'ended' ? '<button class="btn primary" data-room="start">开始下一局</button>' : ''}
      ${canSit(ui.online) ? '<button class="btn primary" data-room="sit">入座</button>' : ''}
      <button class="btn" data-room="invite">邀请好友</button>
    </span>`;
  bar.hidden = false;
}

// ---------- 菜单 / 等候室 ----------

function setScreen(name) {
  $('#lobby').hidden = name === null;
  document.querySelectorAll('#lobby [data-screen]').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
}

function showLobbyError(msg) {
  $('.lobby-error').textContent = msg;
}

function backToMenu() {
  leaveRoom();
  ui.mode = null;
  ui.game = null;
  ui.onDiscard = null;
  ui.choice = null;
  ui.deadline = null;
  document.body.dataset.mode = 'menu';
  history.replaceState(null, '', location.pathname);
  $('#result').hidden = true;
  showLobbyError('');
  setScreen('home');
  refresh();
}

function renderLobbyRoom() {
  const box = $('[data-screen="room"]');
  box.querySelector('.room-code').textContent = ui.code ?? '----';
  const state = ui.online;
  if (!state) {
    box.querySelector('.seat-list').innerHTML = `<li class="muted">${CONN_TEXT[ui.conn] ?? '正在连接…'}</li>`;
    box.querySelector('.room-start').innerHTML = '';
    box.querySelector('.room-spectators').textContent = '';
    return;
  }
  const { lobby, me } = state;
  box.querySelector('.seat-list').innerHTML = lobby.seats.map((s, i) => {
    const who = s
      ? `${esc(s.name)}${i === lobby.host ? ' <span class="tag">房主</span>' : ''}${i === me ? ' <span class="tag me">你</span>' : ''}`
      : '<span class="muted">空位（开局后由电脑补上）</span>';
    return `<li><span class="wind">${WINDS[i]}</span>${who}</li>`;
  }).join('');
  box.querySelector('.room-spectators').textContent = `观战 ${lobby.spectators} 人`;

  let start;
  if (me !== null && me === lobby.host) {
    const humans = lobby.seats.filter(Boolean).length;
    start = `<button class="btn primary big" data-room="start">开始对局</button>
      <p class="muted">${humans < 4 ? `现在 ${humans} 个人，空着的 ${4 - humans} 个座位由电脑来打` : '4 个人都到齐了'}</p>`;
  } else if (me === null) {
    start = '<p class="muted">👀 你在观战，等房主开始</p>' +
      (canSit(state) ? '<button class="btn primary" data-room="sit">入座</button>' : '');
  } else {
    start = '<p class="muted">等房主开始对局…</p>';
  }
  box.querySelector('.room-start').innerHTML = start;
}

// ---------- 事件 ----------

$('#seat-0').addEventListener('click', (e) => {
  const choiceBtn = e.target.closest('[data-choice]');
  if (choiceBtn && ui.choice) {
    ui.choice.resolve(choiceBtn.dataset.choice === 'yes');
    return;
  }
  const tileEl = e.target.closest('[data-tile]');
  if (!tileEl || !ui.onDiscard) return;
  const pos = Number(tileEl.dataset.pos);
  if (!TOUCH || ui.selected === pos) {
    ui.onDiscard(Number(tileEl.dataset.tile));
  } else {
    ui.selected = pos;
    ui.selectedTile = Number(tileEl.dataset.tile);
    refresh();
  }
});

$('#restart').addEventListener('click', () => newSoloGame());
$('#menu').addEventListener('click', () => backToMenu());
$('#result-close').addEventListener('click', () => { $('#result').hidden = true; });
$('#again').addEventListener('click', () => {
  if (ui.mode === 'solo') newSoloGame();
  else if (ui.mode === 'online') ui.room?.send({ t: 'start' });
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-room]');
  if (!btn) return;
  if (btn.dataset.room === 'start') ui.room?.send({ t: 'start' });
  if (btn.dataset.room === 'invite') copyInvite();
  if (btn.dataset.room === 'sit') ui.room?.send({ t: 'sit', name: playerName() });
  if (btn.dataset.room === 'leave') backToMenu();
});

function codeInput() {
  const code = $('#code').value.trim();
  if (!/^\d{4}$/.test(code)) {
    showLobbyError('请输入 4 位数字的房间号');
    return null;
  }
  return code;
}

$('#lobby').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  showLobbyError('');
  if (act === 'solo') return startSolo();
  if (act === 'create') {
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      const code = await createRoom();
      enterRoom(code, 'player');
    } catch (err) {
      showLobbyError(err.message);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (act === 'join' || act === 'watch') {
    const code = codeInput();
    if (code) enterRoom(code, act === 'join' ? 'player' : 'spectator');
  }
});

$('#code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('[data-act="join"]').click();
});

function setHints(on) {
  ui.hints = on;
  save('mj-hints', on ? 'on' : 'off');
  const btn = $('#hints');
  btn.textContent = on ? '提示：开' : '提示：关';
  btn.setAttribute('aria-pressed', String(on));
  refresh();
}

function startTutorial() {
  openTutorial(() => setHints(true));
  save('mj-tutorial-seen', '1');
}

$('#hints').addEventListener('click', () => setHints(!ui.hints));
$('#tutorial-btn').addEventListener('click', startTutorial);

// ---------- 启动 ----------

$('#name').value = load('mj-name') ?? '';
setHints(ui.hints);
document.body.dataset.mode = 'menu';
setScreen('home');

// 打开邀请链接（?room=1234）时直接填好房间号
const invited = new URLSearchParams(location.search).get('room');
if (invited && /^\d{4}$/.test(invited) && hasSeat(invited)) {
  // 刷新页面：直接回到原来的座位
  enterRoom(invited, 'player');
} else if (invited && /^\d{4}$/.test(invited)) {
  $('#code').value = invited;
  $('.invite-note').textContent = `好友邀请你加入房间 ${invited}，填好名字点"加入"`;
  $('.invite-note').hidden = false;
}
