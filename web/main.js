import { Game } from '../src/game.js';
import { sortTiles, tileName } from '../src/tiles.js';
import { tileHTML, backHTML } from './tile-art.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 电脑出牌后停顿多久（毫秒），让人看得清
const AI_DELAY = 700;
const HUMAN_DELAY = 250;

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
      ui.onDiscard = (tile) => {
        ui.onDiscard = null;
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

const ui = {
  game: null,
  onDiscard: null, // 等待玩家出牌时的回调
  choice: null, // 等待玩家选择 胡/碰 时的状态
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

function humanHTML(game) {
  const p = game.players[0];
  const rest = [...p.hand];
  if (p.drawn != null) rest.splice(rest.indexOf(p.drawn), 1);
  const canClick = ui.onDiscard != null;
  const tile = (t) => tileHTML(t, { cls: canClick ? 'clickable' : '', attrs: `data-tile="${t}"` });
  const drawn = p.drawn != null ? `<div class="drawn">${tile(p.drawn)}</div>` : '';

  let actions = '';
  if (ui.choice) {
    actions = `<span class="prompt">${ui.choice.question}</span>
      <button class="btn primary" data-choice="yes">${ui.choice.action}</button>
      <button class="btn" data-choice="no">过</button>`;
  } else if (canClick) {
    actions = '<span class="prompt">轮到你了，点一张牌打出</span>';
  }

  return `
    <div class="discards">${discardsHTML(p)}</div>
    <div class="actions">${actions}</div>
    <div class="my-hand">
      <div class="melds">${meldsHTML(p)}</div>
      <div class="hand-row">${sortTiles(rest).map(tile).join('')}</div>
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
  if (tileEl && ui.onDiscard) ui.onDiscard(Number(tileEl.dataset.tile));
});

$('#restart').addEventListener('click', () => newGame());
$('#again').addEventListener('click', () => newGame());

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
