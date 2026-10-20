import { Game } from '../src/game.js';
import { sortTiles, tileName } from '../src/tiles.js';
import { waitingTiles } from '../src/rules.js';
import { chooseDiscard } from '../src/ai.js';
import { tileHTML, backHTML } from './tile-art.js';
import { openTutorial } from './tutorial.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 电脑出牌后停顿多久（毫秒），让人看得清
const AI_DELAY = 700;
const HUMAN_DELAY = 250;

// 触屏设备（手机、平板）上点两下才打出：第一下选中，第二下确认，防止手指点错
const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

// ---------- 网页版游戏：把命令行的输入输出换成画面和点击 ----------

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

  // 点了"重新开始"后，旧的一局就不再是当前局
  isCurrent() {
    return ui.game === this;
  }

  deal() {
    super.deal();
    render(this);
  }

  showTable() {
    render(this);
  }

  async afterDiscard(seat, tile) {
    this.lastDiscard = { seat, tile };
    render(this);
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
      render(this);
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
      render(this);
    });
  }

  announceWin(player, how) {
    super.announceWin(player, how);
    this.result = { player, how };
  }
}

// ---------- 界面状态 ----------

// localStorage 在隐私模式等情况下可能不可用，读写都包一层
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

const ui = {
  game: null,
  onDiscard: null, // 等待玩家出牌时的回调
  choice: null, // 等待玩家选择 胡/碰 时的状态
  selected: null, // 触屏上第一下选中的牌在手牌里的位置（data-pos）
  selectedTile: null, // 选中的是哪种牌
  hints: load('mj-hints') === 'on', // 是否显示出牌建议和听牌
};

const SEAT_CLASS = ['bottom', 'right', 'top', 'left'];

function addLog(msg) {
  const text = msg.trim();
  if (!text || /^[-=]+$/.test(text)) return;
  const log = $('#log');
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 30) log.lastChild.remove();
}

// ---------- 渲染 ----------

function meldsHTML(player) {
  return player.melds
    .map((m) => `<div class="meld">${m.map((t) => tileHTML(t, { cls: 'sm' })).join('')}</div>`)
    .join('');
}

function discardsHTML(player) {
  return player.discards.map((t) => tileHTML(t, { cls: 'xs' })).join('');
}

function opponentHTML(game, seat) {
  const p = game.players[seat];
  const hand = game.revealed
    ? sortTiles(p.hand).map((t) => tileHTML(t, { cls: 'sm' })).join('')
    : p.hand.map(() => backHTML('sm')).join('');
  return `
    <div class="seat-head"><span class="name">${p.name}</span><span class="count">${p.hand.length} 张</span></div>
    <div class="hand-row">${hand}</div>
    <div class="melds">${meldsHTML(p)}</div>
    <div class="discards">${discardsHTML(p)}</div>`;
}

// 自己能看到的所有明牌：手牌、各家碰出的牌、各家打出的牌
function visibleTiles(game, hand) {
  const seen = [...hand];
  for (const p of game.players) seen.push(...p.melds.flat(), ...p.discards);
  return seen;
}

// 提示：轮到出牌时给出建议，平时显示听哪些牌
function hintFor(game, canClick) {
  if (!ui.hints || game.revealed) return { text: '', suggest: null };
  const p = game.players[0];
  if (canClick) {
    const suggest = chooseDiscard(p.hand);
    const after = [...p.hand];
    after.splice(after.indexOf(suggest), 1);
    const waits = waitingTiles(after, visibleTiles(game, [...after, suggest]));
    const text = `💡 建议打 <b>${tileName(suggest)}</b>` +
      (waits.length ? `，打完就听：<b>${waits.map(tileName).join('、')}</b>` : '');
    return { text, suggest };
  }
  const waits = waitingTiles(p.hand, visibleTiles(game, p.hand));
  const text = waits.length ? `💡 听牌中！等：<b>${waits.map(tileName).join('、')}</b>` : '💡 还没听牌，继续凑面子';
  return { text, suggest: null };
}

function humanHTML(game) {
  const p = game.players[0];
  const rest = [...p.hand];
  if (p.drawn != null) rest.splice(rest.indexOf(p.drawn), 1);
  const canClick = ui.onDiscard != null;
  const hint = hintFor(game, canClick);
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
    actions = `<span class="prompt">${ui.choice.question}</span>
      <button class="btn primary" data-choice="yes">${ui.choice.action}</button>
      <button class="btn" data-choice="no">过</button>`;
  } else if (canClick && TOUCH && ui.selected != null) {
    actions = `<span class="prompt">再点一次 <b>${tileName(ui.selectedTile)}</b> 打出，点别的牌换一张</span>`;
  } else if (canClick) {
    actions = `<span class="prompt">${TOUCH ? '轮到你了：点一张牌选中，再点一次打出' : '轮到你了，点一张牌打出'}</span>`;
  }

  return `
    <div class="discards">${discardsHTML(p)}</div>
    <div class="actions">${actions}</div>
    ${hint.text ? `<div class="hint">${hint.text}</div>` : ''}
    <div class="my-hand">
      <div class="melds">${meldsHTML(p)}</div>
      <div class="hand-row">${handHTML}</div>
      ${drawn}
    </div>`;
}

function centerHTML(game) {
  const last = game.lastDiscard;
  const lastHTML = last
    ? `<div class="last-label">${game.players[last.seat].name} 打出</div>${tileHTML(last.tile, { cls: 'lg' })}`
    : '<div class="last-label">&nbsp;</div><div class="tile lg ghost"></div>';
  return `
    <div class="wall">牌墙剩余 <b>${game.wall.length}</b> 张</div>
    <div class="last">${lastHTML}</div>`;
}

function render(game) {
  if (game !== ui.game) return;
  for (let seat = 0; seat < 4; seat++) {
    const el = $(`#seat-${seat}`);
    el.innerHTML = seat === 0 ? humanHTML(game) : opponentHTML(game, seat);
    el.classList.toggle('active', game.turn === seat && !game.revealed);
  }
  $('#center').innerHTML = centerHTML(game);
}

function showResult(game, winner) {
  const box = $('#result');
  if (winner === -1) {
    box.querySelector('h2').textContent = '流局';
    box.querySelector('.detail').textContent = '牌墙摸完了，没有人胡牌。';
    box.querySelector('.hand-row').innerHTML = '';
  } else {
    const { player, how } = game.result;
    box.querySelector('h2').textContent = player.isHuman ? '你赢了！' : `${player.name} 赢了`;
    box.querySelector('.detail').textContent = `${player.name} ${how}`;
    const tiles = [...player.melds.flat(), ...sortTiles(player.hand)];
    box.querySelector('.hand-row').innerHTML = tiles.map((t) => tileHTML(t, { cls: 'sm' })).join('');
  }
  box.hidden = false;
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
    render(ui.game);
  }
});

$('#restart').addEventListener('click', () => newGame());
$('#again').addEventListener('click', () => newGame());

function setHints(on) {
  ui.hints = on;
  save('mj-hints', on ? 'on' : 'off');
  const btn = $('#hints');
  btn.textContent = on ? '提示：开' : '提示：关';
  btn.setAttribute('aria-pressed', String(on));
  if (ui.game) render(ui.game);
}

function startTutorial() {
  openTutorial(() => setHints(true));
  save('mj-tutorial-seen', '1');
}

$('#hints').addEventListener('click', () => setHints(!ui.hints));
$('#tutorial-btn').addEventListener('click', startTutorial);
setHints(ui.hints);

async function newGame() {
  ui.onDiscard = null;
  ui.choice = null;
  $('#result').hidden = true;
  $('#log').innerHTML = '';

  const game = new WebGame();
  ui.game = game;
  const winner = await game.play();
  if (!game.isCurrent()) return;

  game.revealed = true;
  render(game);
  showResult(game, winner);
}

newGame();
// 第一次来的玩家自动打开新手教学
if (!load('mj-tutorial-seen')) startTutorial();
