// 用 SVG 画麻将牌面。牌面坐标系 30 x 40
// 为了在小尺寸下也看得清：图案尽量占满牌面、线条加粗、颜色对比强
import { isHonor, tileName } from '../src/tiles.js';

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONORS = ['东', '南', '西', '北', '中', '发', '白'];
const FONT = `font-family="'KaiTi','STKaiti','SimHei','Heiti SC','Microsoft YaHei',serif"`;

const RED = '#c4161c';
const GREEN = '#0e6b2f';
const BLUE = '#123f8c';
const INK = '#111827';

// 1-9 个图案在牌面上的位置（30 x 40 坐标）和每个图案的半径
const LAYOUTS = [
  { r: 11, at: [[15, 20]] },
  { r: 7.6, at: [[15, 10.5], [15, 29.5]] },
  { r: 6.2, at: [[7.5, 8], [15, 20], [22.5, 32]] },
  { r: 6.2, at: [[8.5, 11], [21.5, 11], [8.5, 29], [21.5, 29]] },
  { r: 5.6, at: [[8, 9], [22, 9], [15, 20], [8, 31], [22, 31]] },
  { r: 5.2, at: [[9, 7.5], [21, 7.5], [9, 20], [21, 20], [9, 32.5], [21, 32.5]] },
  { r: 4.5, at: [[6, 5.5], [15, 10.5], [24, 15.5], [9, 25], [21, 25], [9, 34.5], [21, 34.5]] },
  { r: 4.4, at: [[9, 5.5], [21, 5.5], [9, 15.2], [21, 15.2], [9, 24.8], [21, 24.8], [9, 34.5], [21, 34.5]] },
  { r: 4.4, at: [[6, 7], [15, 7], [24, 7], [6, 20], [15, 20], [24, 20], [6, 33], [15, 33], [24, 33]] },
];

function dots(n) {
  const { r, at } = LAYOUTS[n - 1];
  return at.map(([cx, cy], i) => {
    // 五筒、九筒中间那个用红色，其他蓝色；一筒是大花饼
    const center = (n === 5 || n === 9) && i === Math.floor(n / 2);
    const color = n === 1 ? GREEN : center ? RED : BLUE;
    const ring = n === 1
      ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="${BLUE}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#fff"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>`;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>${ring}` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="${RED}"/>`;
  }).join('');
}

function stick(cx, cy, w, h, color) {
  // 竹节：深色描边 + 中间一道节
  return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${w / 2}" fill="${color}"/>` +
    `<line x1="${cx - w / 2}" y1="${cy}" x2="${cx + w / 2}" y2="${cy}" stroke="#fff" stroke-width="0.9"/>`;
}

function sticks(n) {
  if (n === 1) {
    // 一条：一根粗大的红绿竹子，和其他条一眼区分
    return stick(15, 20, 9, 32, GREEN) +
      `<rect x="13" y="6" width="4" height="28" rx="2" fill="${RED}"/>` +
      `<line x1="10.5" y1="13" x2="19.5" y2="13" stroke="#fff" stroke-width="1"/>` +
      `<line x1="10.5" y1="27" x2="19.5" y2="27" stroke="#fff" stroke-width="1"/>`;
  }
  const { r, at } = LAYOUTS[n - 1];
  const w = Math.min(r * 1.05, 5.5);
  const h = n <= 2 ? 15 : n <= 6 ? r * 2.1 : 9;
  return at.map(([cx, cy], i) => {
    const red = (n === 5 || n === 9) && i === Math.floor(n / 2);
    return stick(cx, cy, w, h, red ? RED : GREEN);
  }).join('');
}

function characters(n) {
  // 数字是辨认的关键，写得比"萬"还大
  return `<text x="15" y="11" ${FONT} font-size="19" font-weight="900" fill="${INK}" text-anchor="middle" dominant-baseline="central">${NUMS[n - 1]}</text>` +
    `<text x="15" y="30" ${FONT} font-size="15" font-weight="900" fill="${RED}" text-anchor="middle" dominant-baseline="central">萬</text>`;
}

function honor(i) {
  if (i === 6) {
    return `<rect x="5" y="6" width="20" height="28" rx="2" fill="none" stroke="${BLUE}" stroke-width="2.6"/>` +
      `<rect x="9" y="10" width="12" height="20" rx="1" fill="none" stroke="${BLUE}" stroke-width="1.2"/>`;
  }
  const color = i === 4 ? RED : i === 5 ? GREEN : INK;
  return `<text x="15" y="21" ${FONT} font-size="25" font-weight="900" fill="${color}" text-anchor="middle" dominant-baseline="central">${HONORS[i]}</text>`;
}

function faceSVG(tile) {
  let body;
  if (isHonor(tile)) body = honor(tile - 27);
  else {
    const n = (tile % 9) + 1;
    body = [characters, sticks, dots][Math.floor(tile / 9)](n);
  }
  return `<svg viewBox="0 0 30 40" aria-hidden="true">${body}</svg>`;
}

// attrs: 额外的 HTML 属性字符串；cls: 额外的 class；badge: 角上的小标记（例如"赖"）
export function tileHTML(tile, { cls = '', attrs = '', badge = '' } = {}) {
  const name = tileName(tile);
  const mark = badge ? `<span class="badge">${badge}</span>` : '';
  return `<div class="tile ${cls}" title="${name}" aria-label="${name}" ${attrs}>${faceSVG(tile)}${mark}</div>`;
}

export function backHTML(cls = '') {
  return `<div class="tile back ${cls}" aria-hidden="true"></div>`;
}
