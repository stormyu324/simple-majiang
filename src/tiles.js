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

export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => a - b);
}

// 每种牌 4 张，共 136 张，洗好后返回
export function createWall(random = Math.random) {
  const wall = [];
  for (let t = 0; t < TILE_KINDS; t++) {
    for (let i = 0; i < 4; i++) wall.push(t);
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

export function toCounts(tiles) {
  const counts = new Array(TILE_KINDS).fill(0);
  for (const t of tiles) counts[t]++;
  return counts;
}
