// 根据画面数据的变化放音效、配音：比较上一次和这一次的视图，
// 有人打牌就"嗒"一声并报牌名，有人碰杠胡就喊出来。单机、联网、观战都一样用。
import { isHonor, tileName } from '../src/tiles.js';
import { play, say } from './sound.js';

const HONOR_CALLS = { 27: '东风', 28: '南风', 29: '西风', 30: '北风', 31: '红中', 32: '发财', 33: '白板' };
const MELD_CALLS = { chi: '吃', peng: '碰', gang: '杠', bugang: '杠', angang: '暗杠' };

function callTile(t) {
  if (isHonor(t)) return HONOR_CALLS[t];
  if (t === 9) return '幺鸡'; // 一条
  return tileName(t);
}

// 每个座位的声音高低不一样，听得出是谁
const PITCH = [1, 0.8, 1.25, 0.95];

let prev = null;

export function resetAnnouncer() {
  prev = null;
}

export function announce(view) {
  const last = prev;
  prev = view;
  if (!view) return;

  // 新的一局：牌墙变多了，或者上一局已经结束
  if (!last || view.wall > last.wall || (last.revealed && !view.revealed) || last.variant !== view.variant) {
    if (!view.revealed) play('deal');
    return;
  }

  view.players.forEach((p, i) => {
    const q = last.players[i];
    if (!q) return;
    const pitch = PITCH[i];
    // 吃、碰、杠：亮出的牌组多了一组，或者碰变成了补杠
    if (p.melds.length > q.melds.length) {
      play('meld');
      say(MELD_CALLS[p.melds[p.melds.length - 1].type], { pitch });
    } else if (p.melds.some((m, k) => q.melds[k] && m.type !== q.melds[k].type)) {
      play('meld');
      say('杠', { pitch });
    }
    // 红中杠、皮子杠、赖子杠
    if (p.specials.length > q.specials.length) {
      const t = p.specials[p.specials.length - 1];
      play('discard');
      say(t === view.laizi ? '赖子杠' : t === 31 ? '红中杠' : '皮子杠', { pitch });
    }
    if (p.liang && !q.liang) say('亮倒', { pitch });
    if (p.won && !q.won) say(p.won.self ? '自摸' : '胡了', { pitch });
  });

  // 有人打出一张牌
  const d = view.lastDiscard;
  const ld = last.lastDiscard;
  if (d && (!ld || ld.seat !== d.seat || ld.tile !== d.tile)) {
    play('discard');
    say(callTile(d.tile), { pitch: PITCH[d.seat] });
  }

  // 自己摸到牌
  if (view.me !== null && view.me !== undefined) {
    const me = view.players[view.me];
    const was = last.players[view.me];
    if (me.drawn != null && me.drawn !== was?.drawn) play('draw');
  }

  // 轮到自己做选择（碰、杠、胡、换三张、定缺）时提醒一下
  const req = view.pending;
  if (req && req.kind !== 'turn' && !last.pending) play('notify');

  // 一局结束
  if (view.revealed && !last.revealed) {
    const result = view.result;
    if (!result || result.draw) play('draw_game');
    else if (view.me !== null && result.deltas[view.me] < 0) play('lose');
    else play('win');
  }
}
