import { Engine, probeEngine } from '../src/engine.js';
import { VARIANTS, VARIANT_IDS, DEFAULT_VARIANT, getVariant } from '../src/variants.js';
import { suggestDiscard } from '../src/bot.js';
import { sortTiles, tileName, suitOf, SUIT_NAMES } from '../src/tiles.js';
import { tileHTML, backHTML } from './tile-art.js';
import { openTutorial } from './tutorial.js';
import { createRoom, hasSeat, OnlineRoom } from './online.js';
import { unlock, play, prefs, setPref, voiceAvailable } from './sound.js';
import { announce } from './announcer.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forever = () => new Promise(() => {});

// 电脑出牌后停顿多久（毫秒），让人看得清
const AI_DELAY = 700;
const HUMAN_DELAY = 250;
const CLAIM_DELAY = 500;

// 触屏设备（手机、平板）上点两下才打出：第一下选中，第二下确认，防止手指点错
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

const WINDS = ['东', '南', '西', '北'];
const BOT_NAMES = ['你', '电脑·南', '电脑·西', '电脑·北'];

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
// 画面只根据"视图"来画：单机模式由 Engine.view() 生成，联网模式由服务器发来。
// 视图里只有当前这个人能看到的东西（观战者的视图里没有任何人的手牌）。

const ui = {
  mode: null, // null（菜单）| 'solo' | 'online'
  variant: VARIANTS[load('mj-variant')] ? load('mj-variant') : DEFAULT_VARIANT, // 单机 / 开房间用的玩法
  game: null, // 单机：当前这一局
  totals: [], // 单机：这几局累计的分
  dealer: 0, // 单机：下一局谁坐庄
  ask: null, // 单机：等自己回答的请求 { req, resolve }
  room: null, // 联网：OnlineRoom 连接
  online: null, // 联网：服务器发来的最新状态
  answered: null, // 联网：已经回答过的请求 id，防止重复发送
  code: null,
  conn: 'connecting',
  lastPhase: null,
  deadline: null, // 联网：这次操作的截止时间
  selected: null, // 触屏上第一下选中的牌在手牌里的位置（data-pos）
  liangMode: false, // 卡五星：点了"亮倒"，接下来打出的牌同时亮倒
  swapPick: [], // 换三张：选中的牌的位置
  hints: load('mj-hints') === 'on',
};

function resetSelection() {
  ui.selected = null;
  ui.liangMode = false;
  ui.swapPick = [];
}

// ---------- 单机 ----------

function isCurrent(game) {
  return ui.mode === 'solo' && ui.game === game;
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  // 用 setTimeout 而不是 requestAnimationFrame：后者在页面不显示时会暂停，配音会漏掉
  setTimeout(() => {
    refreshQueued = false;
    refresh();
  }, 0);
}

async function newSoloGame() {
  const v = getVariant(ui.variant);
  ui.ask = null;
  ui.deadline = null;
  resetSelection();
  $('#result').hidden = true;
  $('#log').innerHTML = '';
  if (ui.totals.length !== v.players) {
    ui.totals = new Array(v.players).fill(0);
    ui.dealer = 0;
  }

  const game = new Engine(v, {
    names: BOT_NAMES,
    humans: [true, false, false, false],
    dealer: ui.dealer,
    decide: (seat, req) => new Promise((resolve) => {
      if (!isCurrent(game)) return;
      resetSelection();
      ui.ask = { req, resolve };
      refresh();
    }),
    log: (msg) => isCurrent(game) && addLog(msg),
    onChange: () => isCurrent(game) && scheduleRefresh(),
    pause: async (kind, seat) => {
      await sleep(kind === 'discard' ? (seat === 0 ? HUMAN_DELAY : AI_DELAY) : CLAIM_DELAY);
      // 点了"重新开始"或回到菜单后，旧的一局停在这里，永远不再继续
      if (!isCurrent(game)) await forever();
    },
  });
  ui.game = game;
  const result = await game.play();
  if (!isCurrent(game)) return;
  result.deltas.forEach((d, i) => { ui.totals[i] += d; });
  ui.dealer = result.nextDealer;
  refresh();
  showResult(currentView(), { label: '再来一局', enabled: true });
}

function startSolo() {
  leaveRoom();
  ui.mode = 'solo';
  ui.totals = [];
  setScreen(null);
  document.body.dataset.mode = 'solo';
  newSoloGame();
  // 第一次来的玩家自动打开新手教学
  if (!load('mj-tutorial-seen')) startTutorial();
}

// 回答当前请求（出牌、碰、换三张……）
function respond(choice) {
  if (ui.mode === 'solo' && ui.ask) {
    const { resolve } = ui.ask;
    ui.ask = null;
    resetSelection();
    resolve(choice);
    refresh();
  } else if (ui.mode === 'online' && ui.online?.pending) {
    ui.answered = ui.online.pending.id;
    ui.room.send({ t: 'act', choice });
    resetSelection();
    ui.deadline = null;
    refresh();
  }
}

// ---------- 当前画面数据 ----------

function currentVariant() {
  if (ui.mode === 'online' && ui.online) return getVariant(ui.online.lobby.variant);
  return getVariant(ui.variant);
}

function currentView() {
  if (ui.mode === 'solo' && ui.game) {
    return { ...ui.game.view(0), pending: ui.ask?.req ?? null, totals: ui.totals };
  }
  if (ui.mode === 'online' && ui.online?.view) {
    const { view, me, pending, totals } = ui.online;
    const mine = pending && pending.id !== ui.answered ? pending : null;
    return { ...view, me, pending: mine, totals };
  }
  return null;
}

function addLog(msg) {
  const text = String(msg).trim();
  if (!text || /^[-=]+$/.test(text)) return;
  const log = $('#log');
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 60) log.lastChild.remove();
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- 渲染牌桌 ----------

// 赖子、要杠掉的牌（皮子、红中）在牌上加标记
function tile(view, t, { cls = '', attrs = '' } = {}) {
  if (view.laizi === t) return tileHTML(t, { cls: `${cls} laizi`, attrs, badge: '赖' });
  if (view.pizi?.includes(t)) return tileHTML(t, { cls, attrs, badge: '杠' });
  return tileHTML(t, { cls, attrs });
}

function meldsHTML(view, player) {
  return player.melds.map((m) => {
    const tiles = m.tiles ? m.tiles.map((t) => tile(view, t, { cls: 'sm' })).join('') : backHTML('sm').repeat(4);
    return `<div class="meld" title="${MELD_NAMES[m.type]}">${tiles}</div>`;
  }).join('');
}
const MELD_NAMES = { chi: '吃', peng: '碰', gang: '明杠', bugang: '补杠', angang: '暗杠' };

function extrasHTML(view, p) {
  if (!p.specials.length) return '';
  return `<div class="specials"><span class="muted small">杠出</span>${p.specials.map((t) => tile(view, t, { cls: 'xs' })).join('')}</div>`;
}

function discardsHTML(view, player) {
  return player.discards.map((t) => tile(view, t, { cls: 'xs' })).join('');
}

function nameHTML(view, seat) {
  const p = view.players[seat];
  let tags = '';
  if (seat === view.me) tags += '<span class="tag me">你</span>';
  if (ui.mode === 'online') {
    if (p.bot) tags += '<span class="tag">电脑</span>';
    else if (p.connected === false) tags += '<span class="tag warn">掉线·电脑代打</span>';
  }
  if (seat === view.dealer) tags += '<span class="tag dealer">庄</span>';
  if (p.que !== null && p.que !== undefined) tags += `<span class="tag que">缺${SUIT_NAMES[p.que]}</span>`;
  if (p.liang) tags += '<span class="tag warn">亮倒</span>';
  if (p.won) tags += `<span class="tag win">${p.won.self ? '自摸' : '胡'}</span>`;
  return `<span class="wind">${WINDS[seat]}</span>${esc(p.name)}${tags}`;
}

function scoreHTML(view, seat) {
  const total = view.totals?.[seat] ?? 0;
  return `<span class="score ${total < 0 ? 'neg' : ''}">${total > 0 ? '+' : ''}${total} 分</span>`;
}

function otherHTML(view, seat) {
  const p = view.players[seat];
  const hand = p.hand
    ? p.hand.map((t) => tile(view, t, { cls: 'sm' })).join('')
    : backHTML('sm').repeat(p.handCount);
  return `
    <div class="seat-head"><span class="name">${nameHTML(view, seat)}</span><span class="count">${scoreHTML(view, seat)} · ${p.handCount} 张</span></div>
    <div class="hand-row">${hand}</div>
    <div class="melds">${meldsHTML(view, p)}</div>
    ${extrasHTML(view, p)}
    <div class="discards">${discardsHTML(view, p)}</div>`;
}

// 提示：轮到出牌时给出建议，平时显示听哪些牌
function hintFor(view, clickable) {
  if (!ui.hints || view.revealed || view.phase !== 'play') return { text: '', suggest: null };
  const p = view.players[view.me];
  if (!p.hand || p.won) return { text: '', suggest: null };
  const probe = probeEngine(currentVariant(), view);
  const req = view.pending;
  if (req?.kind === 'turn' && clickable.length) {
    const suggest = suggestDiscard(probe, view.me, clickable);
    const rest = [...p.hand];
    rest.splice(rest.indexOf(suggest), 1);
    const waits = probe.waits(probe.players[view.me], rest);
    const text = `💡 建议打 <b>${tileName(suggest)}</b>` +
      (waits.length ? `，打完就听：<b>${waits.map(tileName).join('、')}</b>` : '');
    return { text, suggest };
  }
  if (p.hand.length % 3 !== 1) return { text: '', suggest: null };
  const waits = probe.waits(probe.players[view.me]);
  const text = waits.length ? `💡 听牌中！等：<b>${waits.map(tileName).join('、')}</b>` : '💡 还没听牌，继续凑牌';
  return { text, suggest: null };
}

function countdownHTML() {
  return ui.deadline ? ' <span class="countdown"></span>' : '';
}

function actionLabel(view, req, a) {
  switch (a.type) {
    case 'hu': return a.label ?? (req.kind === 'turn' ? '自摸' : '胡');
    case 'peng': return `碰 ${tileName(req.tile)}`;
    case 'gang': return `杠 ${tileName(req.tile)}`;
    case 'chi': return `吃 ${sortTiles([...a.tiles, req.tile]).map(tileName).join('')}`;
    case 'angang': return `暗杠 ${tileName(a.tile)}`;
    case 'bugang': return `补杠 ${tileName(a.tile)}`;
    default: return `${a.label} ${tileName(a.tile)}`;
  }
}

function actionsHTML(view, req) {
  if (!req) return '';
  const btns = (req.actions ?? []).map((a, i) =>
    `<button class="btn ${a.type === 'hu' ? 'primary' : 'action'}" data-a="${i}">${esc(actionLabel(view, req, a))}</button>`).join('');
  switch (req.kind) {
    case 'turn': {
      let prompt;
      if (ui.liangMode) prompt = '选一张牌打出，同时亮倒（亮着的牌可以打）';
      else if (TOUCH && ui.selected != null) prompt = '再点一次打出，点别的牌换一张';
      else prompt = TOUCH ? '轮到你了：点一张牌选中，再点一次打出' : '轮到你了，点一张牌打出';
      const liang = req.liang
        ? `<button class="btn ${ui.liangMode ? 'primary' : 'action'}" data-liang>${ui.liangMode ? '取消亮倒' : '亮倒'}</button>`
        : '';
      return `<span class="prompt">${prompt}${countdownHTML()}</span>${btns}${liang}`;
    }
    case 'claim': {
      const who = view.players[req.from].name;
      const prompt = req.robbing ? `${esc(who)} 补杠 ${tileName(req.tile)}，可以抢杠胡！` : `${esc(who)} 打出 ${tileName(req.tile)}`;
      return `<span class="prompt">${prompt}${countdownHTML()}</span>${btns}<button class="btn" data-pass>过</button>`;
    }
    case 'swap': {
      const ok = swapTiles(view) !== null;
      return `<span class="prompt">换三张：选 3 张同花色的牌换出去${countdownHTML()}</span>
        <button class="btn primary" data-swap ${ok ? '' : 'disabled'}>确定换出</button>
        <button class="btn action" data-swap-auto>帮我选</button>`;
    }
    case 'dingque':
      return `<span class="prompt">定缺：选一门花色不要${countdownHTML()}</span>` +
        [0, 1, 2].map((s) => `<button class="btn action" data-que="${s}">缺${SUIT_NAMES[s]}</button>`).join('');
  }
  return '';
}

// 自己手牌的显示顺序：排好序的手牌 + 刚摸的牌放在最右边
function myTiles(p) {
  const rest = [...p.hand];
  if (p.drawn != null) rest.splice(rest.indexOf(p.drawn), 1);
  const tiles = sortTiles(rest);
  if (p.drawn != null) tiles.push(p.drawn);
  return tiles;
}

function swapTiles(view) {
  const tiles = myTiles(view.players[view.me]);
  const picked = ui.swapPick.map((pos) => tiles[pos]);
  if (picked.length !== 3 || new Set(picked.map(suitOf)).size !== 1) return null;
  return picked;
}

function clickableTiles(view) {
  const req = view.pending;
  if (req?.kind === 'turn') return ui.liangMode ? req.liang : req.discards;
  return [];
}

function myHTML(view) {
  const p = view.players[view.me];
  const req = view.pending;
  const tiles = myTiles(p);
  const clickable = clickableTiles(view);
  const swapping = req?.kind === 'swap';
  const hint = hintFor(view, clickable);
  let marked = false;

  const tileAt = (t, pos) => {
    let cls = '';
    const canClick = swapping ? suitOf(t) <= 2 : clickable.includes(t);
    if (canClick) cls += ' clickable';
    else if (req?.kind === 'turn') cls += ' dim';
    if (!marked && hint.suggest === t && (pos === tiles.length - 1 || p.drawn !== t)) {
      cls += ' suggest';
      marked = true;
    }
    if (swapping ? ui.swapPick.includes(pos) : ui.selected === pos) cls += ' selected';
    return tile(view, t, { cls, attrs: `data-tile="${t}" data-pos="${pos}"` });
  };
  const handTiles = tiles.map((t, pos) => ({ t, pos }));
  const drawnPart = p.drawn != null ? handTiles.pop() : null;
  const handHTML = handTiles.map(({ t, pos }) => tileAt(t, pos)).join('');
  const drawn = drawnPart ? `<div class="drawn">${tileAt(drawnPart.t, drawnPart.pos)}</div>` : '';

  return `
    <div class="seat-head"><span class="name">${nameHTML(view, view.me)}</span><span class="count">${scoreHTML(view, view.me)}</span></div>
    <div class="discards">${discardsHTML(view, p)}</div>
    ${extrasHTML(view, p)}
    <div class="actions">${actionsHTML(view, req)}</div>
    ${hint.text ? `<div class="hint">${hint.text}</div>` : ''}
    <div class="my-hand">
      <div class="melds">${meldsHTML(view, p)}</div>
      <div class="hand-row">${handHTML}</div>
      ${drawn}
    </div>`;
}

function centerHTML(view) {
  const last = view.lastDiscard;
  const lastHTML = last
    ? `<div class="last-label">${esc(view.players[last.seat].name)} 打出</div>${tile(view, last.tile, { cls: 'lg' })}`
    : '<div class="last-label">&nbsp;</div><div class="tile lg ghost"></div>';
  let laizi = '';
  if (view.laizi != null) {
    const flip = view.flip != null ? `<span class="muted small">翻</span>${tileHTML(view.flip, { cls: 'sm' })}` : '';
    laizi = `<div class="laizi-box">${flip}<span class="muted small">赖子</span>${tile(view, view.laizi, { cls: 'sm' })}</div>`;
  }
  const phase = view.phase === 'swap' ? '<div class="phase">换三张中…</div>' : view.phase === 'dingque' ? '<div class="phase">定缺中…</div>' : '';
  return `
    <div class="wall">牌墙剩余 <b>${view.wall}</b> 张</div>
    ${laizi}
    ${phase}
    <div class="last">${lastHTML}</div>`;
}

// 座位在屏幕上的位置：0 下、1 右、2 上、3 左；3 人时不用上面
const POSITIONS = { 3: [0, 1, 3], 4: [0, 1, 2, 3] };

// 自己坐在下方；观战者从东家的角度看
function render(view) {
  const base = view.me ?? 0;
  const pos = POSITIONS[view.n];
  for (let k = 0; k < 4; k++) $(`#seat-${k}`).hidden = !pos.includes(k);
  for (let k = 0; k < view.n; k++) {
    const seat = (base + k) % view.n;
    const el = $(`#seat-${pos[k]}`);
    el.innerHTML = seat === view.me ? myHTML(view) : otherHTML(view, seat);
    el.classList.toggle('active', view.turn === seat && view.phase === 'play');
  }
  $('.table').dataset.players = view.n;
  $('#center').innerHTML = centerHTML(view);
  updateCountdown();
}

function refresh() {
  const view = currentView();
  $('.table').hidden = !view;
  if (view) render(view);
  announce(view);
  $('#variant-name').textContent = ui.mode ? `· ${currentVariant().short}` : '';
  renderRoomBar();
}

let lastLeft = null;
function updateCountdown() {
  if (!ui.deadline) return;
  const left = Math.max(0, Math.ceil((ui.deadline - Date.now()) / 1000));
  // 最后 5 秒每秒"嘀"一声
  if (left !== lastLeft && left > 0 && left <= 5) play('tick');
  lastLeft = left;
  document.querySelectorAll('.countdown').forEach((el) => {
    el.textContent = `${left} 秒`;
    el.classList.toggle('urgent', left <= 5);
  });
}
setInterval(updateCountdown, 500);

// ---------- 结果弹窗 ----------

function showResult(view, again) {
  const box = $('#result');
  const result = view.result;
  const n = view.n;
  if (!result) return;
  const names = view.players.map((p) => esc(p.name));
  let title;
  if (result.draw) title = '流局';
  else if (result.wins.length > 1) title = `${result.wins.length} 家胡牌`;
  else title = result.wins[0].seat === view.me ? '你赢了！' : `${view.players[result.wins[0].seat].name} 赢了`;
  box.querySelector('h2').textContent = title;

  box.querySelector('.result-wins').innerHTML = result.wins.map((w) => {
    const p = view.players[w.seat];
    const how = w.from === null ? '自摸' : `胡 ${names[w.from]} 的 ${tileName(w.tile)}`;
    const melds = p.melds.map((m) => `<div class="meld">${(m.tiles ?? []).map((t) => tile(view, t, { cls: 'sm' })).join('')}</div>`).join('');
    const hand = (p.hand ?? []).map((t) => tile(view, t, { cls: 'sm' })).join('');
    return `<div class="win-row"><p><b>${names[w.seat]}</b> ${how}：${esc(w.title ?? '')}</p>
      <div class="hand-row">${melds}${hand}</div></div>`;
  }).join('') || '<p>牌墙摸完了，没有人胡牌。</p>';

  const deltas = result.deltas;
  const totals = view.totals ?? [];
  const sign = (x) => `${x > 0 ? '+' : ''}${x}`;
  box.querySelector('.score-table').innerHTML = `
    <tr><th></th>${names.slice(0, n).map((s, i) => `<th>${s}${i === view.me ? '（你）' : ''}</th>`).join('')}</tr>
    <tr><td>本局</td>${deltas.map((d) => `<td class="${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${sign(d)}</td>`).join('')}</tr>
    <tr><td>总分</td>${deltas.map((_, i) => `<td>${sign(totals[i] ?? 0)}</td>`).join('')}</tr>`;
  box.querySelector('.result-lines').innerHTML = result.lines.map((l) => `<li>${esc(l)}</li>`).join('');

  const btn = $('#again');
  btn.textContent = again.label;
  btn.disabled = !again.enabled;
  box.hidden = false;
}

// ---------- 玩法规则 ----------

function showRules(v = currentVariant()) {
  $('#rules-title').textContent = `${v.name}（${v.players} 人）`;
  $('#rules .rules-list').innerHTML = v.rules.map((r) => `<li>${esc(r).replace(/【(.+?)】/g, '<b>$1</b>')}</li>`).join('');
  $('#rules').hidden = false;
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
  ui.answered = null;
  ui.lastPhase = null;
  ui.deadline = null;
  resetSelection();
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
  const prevPending = ui.online?.pending?.id;
  ui.online = state;
  const phase = state.lobby.phase;
  ui.lastPhase = phase;

  // 新的请求：清掉上一次的选择，开始倒计时
  const pending = state.pending;
  if (pending?.id !== prevPending) resetSelection();
  ui.deadline = pending && pending.id !== ui.answered ? Date.now() + pending.remainingMs : null;

  if (phase === 'playing' && prevPhase !== 'playing') $('#result').hidden = true;
  setScreen(phase === 'lobby' ? 'room' : null);
  if (phase === 'lobby') renderLobbyRoom();

  refresh();

  if (phase === 'ended' && prevPhase === 'playing') {
    const isHost = state.me !== null && state.me === state.lobby.host;
    showResult(currentView(), isHost
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
  return state.me === null && state.lobby.phase !== 'playing' && state.lobby.seats.slice(0, state.lobby.n).includes(null);
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
    `<b>${esc(getVariant(lobby.variant).short)}</b>`,
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
  ui.ask = null;
  ui.deadline = null;
  resetSelection();
  document.body.dataset.mode = 'menu';
  history.replaceState(null, '', location.pathname);
  $('#result').hidden = true;
  showLobbyError('');
  setScreen('home');
  refresh();
}

function variantOptions(selected) {
  return VARIANT_IDS.map((id) => {
    const v = VARIANTS[id];
    return `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(v.name)}（${v.players} 人）</option>`;
  }).join('');
}

function renderVariantPicker() {
  $('#variant').innerHTML = variantOptions(ui.variant);
  const v = getVariant(ui.variant);
  $('.variant-desc').innerHTML = `${esc(v.rules[0])} <a href="#" data-rules>查看完整规则</a>`;
}

function renderLobbyRoom() {
  const box = $('[data-screen="room"]');
  box.querySelector('.room-code').textContent = ui.code ?? '----';
  const state = ui.online;
  if (!state) {
    box.querySelector('.seat-list').innerHTML = `<li class="muted">${CONN_TEXT[ui.conn] ?? '正在连接…'}</li>`;
    box.querySelector('.room-start').innerHTML = '';
    box.querySelector('.room-spectators').textContent = '';
    box.querySelector('.room-variant').innerHTML = '';
    return;
  }
  const { lobby, me } = state;
  const isHost = me !== null && me === lobby.host;
  const v = getVariant(lobby.variant);
  box.querySelector('.room-variant').innerHTML = isHost
    ? `<label class="field">玩法（房主可以换）<select class="variant-select" data-room-variant>${variantOptions(lobby.variant)}</select></label>`
    : `<p>玩法：<b>${esc(v.name)}</b>（${v.players} 人）</p>`;
  box.querySelector('.seat-list').innerHTML = lobby.seats.slice(0, lobby.n).map((s, i) => {
    const who = s
      ? `${esc(s.name)}${i === lobby.host ? ' <span class="tag">房主</span>' : ''}${i === me ? ' <span class="tag me">你</span>' : ''}`
      : '<span class="muted">空位（开局后由电脑补上）</span>';
    return `<li><span class="wind">${WINDS[i]}</span>${who}</li>`;
  }).join('');
  box.querySelector('.room-spectators').textContent = `观战 ${lobby.spectators} 人`;

  let start;
  if (isHost) {
    const humans = lobby.seats.slice(0, lobby.n).filter(Boolean).length;
    start = `<button class="btn primary big" data-room="start">开始对局</button>
      <p class="muted">${humans < lobby.n ? `现在 ${humans} 个人，空着的 ${lobby.n - humans} 个座位由电脑来打` : `${lobby.n} 个人都到齐了`}</p>`;
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
  const view = currentView();
  const req = view?.pending;
  if (!req) return;
  const btn = e.target.closest('button');
  if (btn) {
    if (btn.dataset.a !== undefined) return respond(req.actions[Number(btn.dataset.a)]);
    if (btn.hasAttribute('data-pass')) return respond({ type: 'pass' });
    if (btn.hasAttribute('data-liang')) {
      ui.liangMode = !ui.liangMode;
      ui.selected = null;
      return refresh();
    }
    if (btn.dataset.que !== undefined) return respond({ suit: Number(btn.dataset.que) });
    if (btn.hasAttribute('data-swap')) {
      const tiles = swapTiles(view);
      if (tiles) respond({ tiles });
      return;
    }
    if (btn.hasAttribute('data-swap-auto')) return autoSwap(view);
    return;
  }

  const tileEl = e.target.closest('[data-tile]');
  if (!tileEl) return;
  const pos = Number(tileEl.dataset.pos);
  const t = Number(tileEl.dataset.tile);
  if (req.kind === 'swap') {
    if (suitOf(t) > 2) return;
    const tiles = myTiles(view.players[view.me]);
    let pick = ui.swapPick.includes(pos) ? ui.swapPick.filter((x) => x !== pos) : [...ui.swapPick, pos];
    // 换三张必须同一花色：选了别的花色就重新开始选
    if (pick.some((x) => suitOf(tiles[x]) !== suitOf(t))) pick = [pos];
    ui.swapPick = pick.slice(-3);
    return refresh();
  }
  if (req.kind !== 'turn' || !clickableTiles(view).includes(t)) return;
  if (!TOUCH || ui.selected === pos) {
    respond({ type: ui.liangMode ? 'liang' : 'discard', tile: t });
  } else {
    ui.selected = pos;
    refresh();
  }
});

// 换三张"帮我选"：选张数最少的那门里最边上的 3 张
function autoSwap(view) {
  const tiles = myTiles(view.players[view.me]);
  const bySuit = [0, 1, 2].map((s) => tiles.map((t, pos) => ({ t, pos })).filter((x) => suitOf(x.t) === s)).filter((g) => g.length >= 3);
  const g = bySuit.sort((a, b) => a.length - b.length)[0];
  ui.swapPick = g.slice(0, 3).map((x) => x.pos);
  refresh();
}

$('#restart').addEventListener('click', () => newSoloGame());
$('#menu').addEventListener('click', () => backToMenu());
$('#result-close').addEventListener('click', () => { $('#result').hidden = true; });
$('#again').addEventListener('click', () => {
  if (ui.mode === 'solo') newSoloGame();
  else if (ui.mode === 'online') ui.room?.send({ t: 'start' });
});
$('#rules-btn').addEventListener('click', () => showRules());

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close="rules"]')) $('#rules').hidden = true;
  if (e.target.closest('[data-rules]')) {
    e.preventDefault();
    showRules(getVariant(ui.variant));
  }
  const btn = e.target.closest('[data-room]');
  if (!btn) return;
  if (btn.dataset.room === 'start') ui.room?.send({ t: 'start' });
  if (btn.dataset.room === 'invite') copyInvite();
  if (btn.dataset.room === 'sit') ui.room?.send({ t: 'sit', name: playerName() });
  if (btn.dataset.room === 'leave') backToMenu();
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-room-variant]')) ui.room?.send({ t: 'variant', id: e.target.value });
});

$('#variant').addEventListener('change', (e) => {
  ui.variant = e.target.value;
  save('mj-variant', ui.variant);
  renderVariantPicker();
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
      const code = await createRoom(ui.variant);
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

// 大牌：所有牌放大 1.25 倍，看不清牌的玩家可以打开
function setBigTiles(on) {
  save('mj-big', on ? 'on' : 'off');
  document.documentElement.classList.toggle('big-tiles', on);
  $('#big-tiles').setAttribute('aria-pressed', String(on));
}
$('#big-tiles').addEventListener('click', () => setBigTiles(load('mj-big') !== 'on'));
setBigTiles(load('mj-big') === 'on');

// ---------- 声音设置 ----------

function renderSoundPanel() {
  const panel = $('#sound-panel');
  panel.querySelector('[data-pref="sfx"]').checked = prefs.sfx;
  panel.querySelector('[data-pref="voice"]').checked = prefs.voice;
  panel.querySelector('[data-pref="music"]').checked = prefs.music;
  panel.querySelector('[data-pref="volume"]').value = prefs.volume;
  panel.querySelector('[data-pref="musicVolume"]').value = prefs.musicVolume;
  panel.querySelector('.voice-note').hidden = voiceAvailable();
  const on = prefs.sfx || prefs.voice || prefs.music;
  $('#sound-btn').textContent = on ? '🔊 声音' : '🔇 声音';
}

$('#sound-btn').addEventListener('click', () => {
  const panel = $('#sound-panel');
  panel.hidden = !panel.hidden;
  renderSoundPanel();
});
$('#sound-panel').addEventListener('input', (e) => {
  const key = e.target.dataset.pref;
  if (!key) return;
  setPref(key, e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value));
  renderSoundPanel();
  if (key === 'sfx' && prefs.sfx) play('discard');
});
// 点面板外面就收起来
document.addEventListener('click', (e) => {
  if (!e.target.closest('#sound-panel, #sound-btn')) $('#sound-panel').hidden = true;
});
// 浏览器要求用户点过页面之后才能出声
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, unlock);

// ---------- 启动 ----------

$('#name').value = load('mj-name') ?? '';
renderVariantPicker();
setHints(ui.hints);
renderSoundPanel();
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
