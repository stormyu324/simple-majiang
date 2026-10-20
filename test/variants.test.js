import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.js';
import { VARIANTS } from '../src/variants.js';
import { standardWin, sevenPairs } from '../src/hand.js';
import { parseTiles as parse, toCounts } from '../src/tiles.js';

// 造一个牌局，直接摆好某个玩家的手牌和亮出的牌，用来测胡牌判定
function setup(id, { hand, melds = [], laizi = null, pizi = [], que = null, liang = false }) {
  const e = new Engine(VARIANTS[id], { names: ['A', 'B', 'C', 'D'], humans: [false, false, false, false] });
  e.laizi = laizi;
  e.pizi = pizi;
  const p = e.players[0];
  p.hand = parse(hand);
  p.melds = melds.map(([type, s]) => ({ type, tiles: parse(s) }));
  p.que = que;
  p.liang = liang;
  return { e, p };
}
const T = (s) => parse(s)[0];

test('赖子当万能牌', () => {
  assert.equal(standardWin(toCounts(parse('123m456m789s111p5z')), 1), true); // 赖子补成 55z
  assert.equal(standardWin(toCounts(parse('13m456m789s111p55z')), 1), true); // 赖子补 2m
  assert.equal(standardWin(toCounts(parse('19m456m789s111p55z')), 1), false);
  assert.ok(sevenPairs(toCounts(parse('1133m2255s1199p7z')), 1));
});

test('武汉麻将：必须开口、258 将、皮子不能留', () => {
  // 没开口不能胡
  let { e, p } = setup('wuhan', { hand: '123m456m789s111p5s', laizi: T('9p'), pizi: [T('8p'), 31] });
  assert.equal(e.v.checkWin(e, p, T('5s'), { self: false }), null);
  // 开口后，258 将能胡小胡
  ({ e, p } = setup('wuhan', { hand: '123m456m789s5s', melds: [['peng', '111p']], laizi: T('9p'), pizi: [T('8p'), 31] }));
  assert.equal(e.v.checkWin(e, p, T('5s'), { self: false }).title, '小胡');
  // 将不是 258 不能胡小胡
  ({ e, p } = setup('wuhan', { hand: '123m456m789s3s', melds: [['peng', '111p']], laizi: T('9p'), pizi: [T('8p'), 31] }));
  assert.equal(e.v.checkWin(e, p, T('3s'), { self: false }), null);
  // 手里有红中（皮子）不能胡
  ({ e, p } = setup('wuhan', { hand: '123m456m789s5z', melds: [['peng', '111p']], laizi: T('9p'), pizi: [T('8p'), 31] }));
  assert.equal(e.v.checkWin(e, p, T('5z'), { self: false }), null);
  // 清一色是大胡，不要求 258 将
  ({ e, p } = setup('wuhan', { hand: '1234567893m', melds: [['chi', '123m']], laizi: T('9p'), pizi: [T('8p'), 31] }));
  const qing = e.v.checkWin(e, p, T('3m'), { self: false });
  assert.ok(qing.bigs.includes('清一色'));
});

test('卡五星：夹 5 胡', () => {
  const { e, p } = setup('kawuxing', { hand: '46s123p789p111p55s' });
  const info = e.v.checkWin(e, p, T('5s'), { self: false });
  assert.ok(info.fans.some((f) => f.name === '卡五星'));
  // 两头听 5 不是卡五星
  const b = setup('kawuxing', { hand: '67s123p789p111p55s' });
  assert.ok(!b.e.v.checkWin(b.e, b.p, T('5s'), { self: false }).fans.some((f) => f.name === '卡五星'));
});

test('血战到底：手里有缺门的牌不能胡', () => {
  let { e, p } = setup('xuezhan', { hand: '123s456s789p111p5m', que: 0 });
  assert.equal(e.v.checkWin(e, p, T('5m'), { self: false }), null);
  ({ e, p } = setup('xuezhan', { hand: '123s456s789p111p5s', que: 0 }));
  assert.equal(e.v.checkWin(e, p, T('5s'), { self: false }).points, 1);
});

test('红中麻将：只能自摸', () => {
  const { e, p } = setup('hongzhong', { hand: '123s456s789p111p5z', laizi: 31 });
  assert.equal(e.v.checkWin(e, p, T('5s'), { self: false }), null);
  p.hand.push(T('5s'));
  assert.ok(e.v.checkWin(e, p, T('5s'), { self: true }));
});

test('全电脑对局：每种玩法都能打完，分数总和为 0', async () => {
  for (const v of Object.values(VARIANTS)) {
    for (let g = 0; g < 5; g++) {
      const e = new Engine(v, { names: ['A', 'B', 'C', 'D'], humans: [false, false, false, false], dealer: g });
      const res = await e.play();
      assert.equal(res.deltas.reduce((a, b) => a + b, 0), 0, v.id);
    }
  }
});
