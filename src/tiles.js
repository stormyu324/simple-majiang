// 牌用 0..33 的整数表示：
//   0-8   万 (一万..九万)
//   9-17  条 (一条..九条)
//   18-26 筒 (一筒..九筒)
//   27-33 字牌 (东 南 西 北 中 发 白)

export const TILE_KINDS = 34;

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUITS = ['万', '条', '筒'];
const HONORS = ['东', '南', '西', '北', '中', '发', '白'];

export function isHonor(tile) {
  return tile >= 27;
}

export function tileName(tile) {
  if (isHonor(tile)) return HONORS[tile - 27];
  return NUMS[tile % 9] + SUITS[Math.floor(tile / 9)];
}

// 花色：0 万、1 条、2 筒、3 字牌
export function suitOf(tile) {
  return Math.floor(tile / 9);
}

// 点数 1-9（字牌返回 0）
export function rankOf(tile) {
  return isHonor(tile) ? 0 : (tile % 9) + 1;
}

export const SUIT_NAMES = ['万', '条', '筒', '字'];

// 一副牌里有哪些牌：各地玩法用的牌不一样
export const ALL_KINDS = Array.from({ length: TILE_KINDS }, (_, t) => t);
export const SUITED_KINDS = ALL_KINDS.slice(0, 27);

export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => a - b);
}

// kinds 里的每种牌 4 张（默认全部 34 种，共 136 张），洗好后返回
export function createWall(random = Math.random, kinds = ALL_KINDS) {
  const wall = [];
  for (const t of kinds) {
    for (let i = 0; i < 4; i++) wall.push(t);
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

// 简写转成牌：m=万 s=条 p=筒 z=字（1-7 为东南西北中发白），例如 '123m55z'
export function parseTiles(str) {
  const tiles = [];
  for (const [, nums, suit] of str.matchAll(/(\d+)([mspz])/g)) {
    const base = { m: 0, s: 9, p: 18, z: 27 }[suit];
    for (const n of nums) tiles.push(base + Number(n) - 1);
  }
  return tiles;
}

export function toCounts(tiles) {
  const counts = new Array(TILE_KINDS).fill(0);
  for (const t of tiles) counts[t]++;
  return counts;
}
