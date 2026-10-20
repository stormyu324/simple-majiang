// 用 SVG 画麻将牌面。牌面坐标系 30 x 40
import { isHonor, tileName } from '../src/tiles.js';

const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONORS = ['东', '南', '西', '北', '中', '发', '白'];
const FONT = `font-family="'KaiTi','STKaiti','SimSun','Songti SC',serif"`;

const RED = '#c62828';
const GREEN = '#1b7a3d';
const BLUE = '#1d4e9e';
const INK = '#1f2a44';

// 1-9 个图案在牌面上的位置（0..1 归一化坐标）
const LAYOUTS = [
  [[0.5, 0.5]],
  [[0.5, 0.22], [0.5, 0.78]],
  [[0.2, 0.18], [0.5, 0.5], [0.8, 0.82]],
  [[0.27, 0.25], [0.73, 0.25], [0.27, 0.75], [0.73, 0.75]],
  [[0.25, 0.2], [0.75, 0.2], [0.5, 0.5], [0.25, 0.8], [0.75, 0.8]],
  [[0.27, 0.18], [0.73, 0.18], [0.27, 0.5], [0.73, 0.5], [0.27, 0.82], [0.73, 0.82]],
  [[0.2, 0.12], [0.5, 0.25], [0.8, 0.38], [0.27, 0.62], [0.73, 0.62], [0.27, 0.87], [0.73, 0.87]],
  [[0.27, 0.12], [0.73, 0.12], [0.27, 0.37], [0.73, 0.37], [0.27, 0.63], [0.73, 0.63], [0.27, 0.88], [0.73, 0.88]],
  [[0.2, 0.18], [0.5, 0.18], [0.8, 0.18], [0.2, 0.5], [0.5, 0.5], [0.8, 0.5], [0.2, 0.82], [0.5, 0.82], [0.8, 0.82]],
];

function pipSize(n) {
  if (n === 1) return 9;
  if (n <= 4) return 5.5;
  if (n <= 6) return 4.6;
  return 3.8;
}

function place([x, y]) {
  return [3 + x * 24, 4 + y * 32];
}

function dots(n) {
  const r = pipSize(n);
  return LAYOUTS[n - 1].map((p) => {
    const [cx, cy] = place(p);
    const extra = n === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.65}" fill="none" stroke="${GREEN}" stroke-width="1"/>` : '';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BLUE}" stroke-width="${r * 0.32}"/>${extra}` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.32}" fill="${RED}"/>`;
  }).join('');
}

function sticks(n) {
  const r = pipSize(n);
  const w = n === 1 ? 7 : r * 0.9;
  const h = n === 1 ? 26 : Math.min(r * 2, 8);
  return LAYOUTS[n - 1].map((p, i) => {
    const [cx, cy] = place(p);
    // 一条、五条和九条的中间那根用红色点缀
    const red = n === 1 || ((n === 5 || n === 9) && i === Math.floor(n / 2));
    const color = red ? RED : GREEN;
    return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${w / 2}" fill="${color}"/>` +
      `<line x1="${cx}" y1="${cy - h / 2 + 1.2}" x2="${cx}" y2="${cy + h / 2 - 1.2}" stroke="#fff" stroke-width="0.6" opacity="0.7"/>`;
  }).join('');
}

function characters(n) {
  return `<text x="15" y="13" ${FONT} font-size="12" fill="${INK}" text-anchor="middle" dominant-baseline="central">${NUMS[n - 1]}</text>` +
    `<text x="15" y="29" ${FONT} font-size="14" font-weight="bold" fill="${RED}" text-anchor="middle" dominant-baseline="central">萬</text>`;
}

function honor(i) {
  if (i === 6) {
    return `<rect x="6" y="8" width="18" height="24" rx="2" fill="none" stroke="${BLUE}" stroke-width="2"/>`;
  }
  const color = i === 4 ? RED : i === 5 ? GREEN : INK;
  return `<text x="15" y="21" ${FONT} font-size="20" font-weight="bold" fill="${color}" text-anchor="middle" dominant-baseline="central">${HONORS[i]}</text>`;
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

// attrs: 额外的 HTML 属性字符串；cls: 额外的 class
export function tileHTML(tile, { cls = '', attrs = '' } = {}) {
  const name = tileName(tile);
  return `<div class="tile ${cls}" title="${name}" aria-label="${name}" ${attrs}>${faceSVG(tile)}</div>`;
}

export function backHTML(cls = '') {
  return `<div class="tile back ${cls}" aria-hidden="true"></div>`;
}
