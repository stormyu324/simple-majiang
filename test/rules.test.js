import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWin, canPeng } from '../src/rules.js';
import { chooseDiscard } from '../src/ai.js';
import { Game } from '../src/game.js';

// 简写：m=万 s=条 p=筒 z=字，例如 '123m' -> [0,1,2]
function parse(str) {
  const tiles = [];
  for (const [, nums, suit] of str.matchAll(/(\d+)([mspz])/g)) {
    const base = { m: 0, s: 9, p: 18, z: 27 }[suit];
    for (const n of nums) tiles.push(base + Number(n) - 1);
  }
  return tiles;
}

test('标准胡牌：四组面子 + 一对将', () => {
  assert.equal(canWin(parse('123m456m789s111p55z')), true);
  assert.equal(canWin(parse('111222333m44455p')), true);
});

test('七对', () => {
  assert.equal(canWin(parse('1133m2255s1199p77z')), true);
});

test('碰牌后的少张手牌也能胡', () => {
  assert.equal(canWin(parse('123m55z')), true);
  assert.equal(canWin(parse('11m')), true);
});

test('不能胡的牌', () => {
  assert.equal(canWin(parse('123m456m789s111p56z')), false);
  assert.equal(canWin(parse('89m1s')), false); // 不能跨花色组顺子
  assert.equal(canWin(parse('123z11m')), false); // 字牌不能组顺子
  assert.equal(canWin(parse('123m456m789s111p5z')), false); // 张数不对
});

test('碰', () => {
  assert.equal(canPeng(parse('11m'), parse('1m')[0]), true);
  assert.equal(canPeng(parse('12m'), parse('1m')[0]), false);
});

test('电脑优先打孤张字牌', () => {
  assert.equal(chooseDiscard(parse('123m456m789s11p23p7z')), parse('7z')[0]);
});

test('电脑之间能完整打完一局', async () => {
  const io = { log: () => {}, ask: async () => '1' };
  const game = new Game(io);
  game.players[0].isHuman = false;
  const winner = await game.play();
  assert.ok(winner >= -1 && winner <= 3);
});
