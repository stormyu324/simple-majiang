import { createWall, sortTiles, tileName } from './tiles.js';
import { canWin, canPeng } from './rules.js';
import { chooseDiscard, shouldPeng } from './ai.js';

const SEAT_NAMES = ['你', '电脑-南', '电脑-西', '电脑-北'];

function removeTiles(hand, tile, n) {
  for (let i = 0; i < n; i++) hand.splice(hand.indexOf(tile), 1);
}

function formatHand(hand) {
  return sortTiles(hand).map(tileName).join(' ');
}

export class Game {
  // io: { log(msg), ask(question) => Promise<string> }
  constructor(io, random = Math.random) {
    this.io = io;
    this.wall = createWall(random);
    this.players = SEAT_NAMES.map((name, i) => ({
      name,
      isHuman: i === 0,
      hand: [],
      melds: [],
      discards: [],
    }));
  }

  deal() {
    for (const p of this.players) p.hand = this.wall.splice(0, 13);
  }

  showTable() {
    const { log } = this.io;
    log('\n------------------------------------------');
    log(`牌墙剩余：${this.wall.length} 张`);
    for (const p of this.players) {
      const melds = p.melds.map((m) => `[${m.map(tileName).join('')}]`).join(' ');
      log(`${p.name} 打出：${p.discards.map(tileName).join(' ') || '-'}${melds ? '  碰：' + melds : ''}`);
    }
  }

  async humanDiscard(player) {
    const sorted = sortTiles(player.hand);
    this.io.log('你的手牌：');
    this.io.log(sorted.map((t, i) => `${i + 1}.${tileName(t)}`).join('  '));
    while (true) {
      const ans = (await this.io.ask(`请选择要打出的牌 (1-${sorted.length})：`)).trim();
      const idx = Number(ans) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < sorted.length) return sorted[idx];
      this.io.log('输入无效，请重新输入。');
    }
  }

  async confirm(question) {
    const ans = (await this.io.ask(`${question} (y/n)：`)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes' || ans === '';
  }

  // 返回是否胡牌
  async checkSelfDrawWin(player) {
    if (!canWin(player.hand)) return false;
    if (player.isHuman) return this.confirm('可以自摸！要胡吗？');
    return true;
  }

  // 有人打出一张牌后，按座次检查其他玩家能否胡或碰。
  // 返回 { type: 'win' | 'peng', seat } 或 null
  async checkClaims(fromSeat, tile) {
    // 先检查胡（优先级高于碰）
    for (let k = 1; k < 4; k++) {
      const seat = (fromSeat + k) % 4;
      const p = this.players[seat];
      if (!canWin([...p.hand, tile])) continue;
      if (!p.isHuman || (await this.confirm(`${tileName(tile)} 可以胡！要胡吗？`))) {
        return { type: 'win', seat };
      }
    }
    for (let k = 1; k < 4; k++) {
      const seat = (fromSeat + k) % 4;
      const p = this.players[seat];
      if (!canPeng(p.hand, tile)) continue;
      const want = p.isHuman
        ? await this.confirm(`要碰 ${tileName(tile)} 吗？`)
        : shouldPeng(p.hand, tile);
      if (want) return { type: 'peng', seat };
    }
    return null;
  }

  announceWin(player, how) {
    this.io.log('\n==========================================');
    this.io.log(`${player.name} ${how}！`);
    this.io.log(`胡牌手牌：${formatHand(player.hand)}`);
    if (player.melds.length) {
      this.io.log(`碰出的牌：${player.melds.map((m) => m.map(tileName).join('')).join(' ')}`);
    }
    this.io.log('==========================================');
  }

  // 返回赢家座位号，流局返回 -1
  async play() {
    const { log } = this.io;
    this.deal();
    log('游戏开始！你坐东家，先摸牌。');

    let seat = 0;
    let needDraw = true;

    while (true) {
      const player = this.players[seat];

      if (needDraw) {
        if (this.wall.length === 0) {
          log('\n牌墙已摸完，流局！');
          return -1;
        }
        const tile = this.wall.shift();
        player.hand.push(tile);
        if (player.isHuman) {
          this.showTable();
          log(`你摸到了：${tileName(tile)}`);
        }
        if (await this.checkSelfDrawWin(player)) {
          this.announceWin(player, '自摸');
          return seat;
        }
      } else if (player.isHuman) {
        this.showTable();
      }

      const discard = player.isHuman
        ? await this.humanDiscard(player)
        : chooseDiscard(player.hand);
      removeTiles(player.hand, discard, 1);
      log(`${player.name} 打出 ${tileName(discard)}`);

      const claim = await this.checkClaims(seat, discard);
      if (claim?.type === 'win') {
        const winner = this.players[claim.seat];
        winner.hand.push(discard);
        this.announceWin(winner, `胡了 ${player.name} 的 ${tileName(discard)}`);
        return claim.seat;
      }
      if (claim?.type === 'peng') {
        const p = this.players[claim.seat];
        removeTiles(p.hand, discard, 2);
        p.melds.push([discard, discard, discard]);
        log(`${p.name} 碰 ${tileName(discard)}！`);
        seat = claim.seat;
        needDraw = false;
        continue;
      }

      player.discards.push(discard);
      seat = (seat + 1) % 4;
      needDraw = true;
    }
  }
}
