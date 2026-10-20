// 新手教学：从认牌开始，一步步讲到胡牌和出牌，中间穿插小测验。
// 测验的对错直接用游戏的规则代码判断，和实战完全一致。
import { parseTiles, tileName } from '../src/tiles.js';
import { canWin, waitingTiles } from '../src/rules.js';
import { tileHTML } from './tile-art.js';

const $ = (sel) => document.querySelector(sel);

// '123m 456s' -> 每组牌之间留空隙
function tiles(str) {
  return `<div class="tut-tiles">${str
    .split(' ')
    .map((g) => `<div class="tut-group">${parseTiles(g).map((t) => tileHTML(t, { cls: 'sm' })).join('')}</div>`)
    .join('')}</div>`;
}

function names(list) {
  return list.map(tileName).join('、');
}

// 能不能胡的测验：选项是一手 14 张牌，按 canWin 判对错
function winQuiz(question, hands) {
  return {
    question,
    options: hands.map(([str, explain]) => {
      const ok = canWin(parseTiles(str.replace(/ /g, '')));
      return { html: tiles(str), correct: ok, explain: (ok ? '能胡：' : '不能胡：') + explain };
    }),
  };
}

const LISTEN_HAND = '123m 456s 789p 55m 34s';

const STEPS = [
  {
    title: '欢迎来到麻将',
    body: `
      <p>麻将是 <b>4 个人</b>一起玩的游戏。你坐在下方，另外三家是电脑。</p>
      <p>每人开局拿 <b>13 张</b>牌，然后大家轮流：<b>摸一张、打一张</b>。</p>
      <p>谁先把手里的牌凑成一手规定的样子，就叫<b>"胡牌"</b>，谁就赢了这一局。</p>
      <p>接下来用几分钟，从认牌开始教你怎么凑出胡牌。</p>`,
  },
  {
    title: '第一步：认识三种花色',
    body: `
      <p>大部分牌分成三种<b>花色</b>，每种都是 1 到 9：</p>
      <p><b>万子</b>：上面写数字，下面一个红色的"萬"字</p>${tiles('123456789m')}
      <p><b>条子</b>：竹条的根数就是数字（一条是一根大红条）</p>${tiles('123456789s')}
      <p><b>筒子</b>：圆圈的个数就是数字</p>${tiles('123456789p')}`,
  },
  {
    title: '第二步：认识字牌',
    body: `
      <p>还有 7 种<b>字牌</b>，它们没有数字：</p>
      <p><b>风牌</b>：东、南、西、北</p>${tiles('1234z')}
      <p><b>箭牌</b>：红中、发财、白板（白板就是一个蓝色方框）</p>${tiles('567z')}
      <p>以上 34 种牌，每种都有 <b>4 张</b>，一共 136 张。</p>`,
  },
  {
    title: '小测验：认牌',
    quiz: {
      question: '下面哪一张是 <b>七条</b>？',
      options: [
        { html: tiles('7p'), correct: false, explain: '这是七筒——圆圈是筒子。' },
        { html: tiles('7s'), correct: true, explain: '对！竹条是条子，数一数正好 7 根。' },
        { html: tiles('7m'), correct: false, explain: '这是七万——有"萬"字的是万子。' },
      ],
    },
  },
  {
    title: '第三步：面子——三张一组',
    body: `
      <p>胡牌要先凑<b>"面子"</b>，就是三张一组。面子有两种：</p>
      <p><b>顺子</b>：<b>同一种花色</b>、数字连着的三张</p>${tiles('123m 456s 789p')}
      <p><b>刻子</b>：三张<b>一模一样</b>的牌</p>${tiles('555p 111z 666z')}
      <p class="warn">注意：字牌<b>不能</b>组顺子，不同花色也不能连在一起。比如"八万 九万 一条"不是顺子。</p>`,
  },
  {
    title: '第四步：将——一对',
    body: `
      <p>除了面子，还需要一个<b>"将"</b>，也叫"雀头"，就是两张一样的牌：</p>
      ${tiles('55m 11z 99s')}
      <p>任何一种牌凑成一对都可以当将。</p>`,
  },
  {
    title: '第五步：胡牌公式',
    body: `
      <p>记住这个公式就会胡牌了：</p>
      <p class="formula">4 组面子 + 1 对将 = 14 张 = 胡牌</p>
      ${tiles('123m 456s 789p 111z 55m')}
      <p>上面这手：三个顺子 + 一个东风刻子 + 一对五万，正好 14 张，胡了！</p>
      <p>你平时手里是 13 张，<b>再摸到或别人打出你缺的那一张</b>，凑成 14 张就能胡。</p>
      <p><b>特殊胡法"七对"</b>：14 张正好是 7 个对子，也算胡。</p>
      ${tiles('11m 33m 22s 55s 11p 99p 77z')}`,
  },
  {
    title: '小测验：能胡吗？',
    quiz: winQuiz('下面哪一手牌<b>已经胡了</b>？', [
      ['123m 456m 789s 222p 56z', '红中和发财不是一对，缺一个将。'],
      ['234p 234p 678s 999m 77s', '两个二三四筒 + 六七八条 + 九万刻子 + 一对七条。'],
      ['891m 456s 789p 111z 55m', '"八九一万"不连续，九和一不能连成顺子。'],
    ]),
  },
  {
    title: '第六步：一个回合怎么打',
    body: `
      <ol class="steps">
        <li><b>摸牌</b>：轮到你时自动摸一张，放在手牌最右边。</li>
        <li><b>自摸</b>：如果摸完正好胡了，会弹出"自摸"按钮，点它就赢了。</li>
        <li><b>打牌</b>：没胡就<b>点一张牌打出去</b>，手里永远保持 13 张。（手机上点两下：第一下选中，第二下打出。）</li>
      </ol>
      <p>别人打出一张牌时，你还有两个机会：</p>
      <ul class="steps">
        <li><b>胡</b>：这张正好是你缺的，点"胡"，这叫别人<b>"点炮"</b>。</li>
        <li><b>碰</b>：你手里有一对一样的，可以点"碰"把它拿过来凑成刻子。碰完不用摸牌，直接打一张。</li>
      </ul>
      <p>牌墙摸完了还没人胡，这局就是<b>"流局"</b>（平局）。</p>`,
  },
  {
    title: '第七步：听牌',
    body: `
      <p>当你的 13 张牌<b>只差一张就能胡</b>时，就叫<b>"听牌"</b>，差的那几种牌叫"听的牌"。</p>
      ${tiles(LISTEN_HAND)}
      <p>这手牌有三个顺子、一对五万，还剩"三条 四条"。</p>
      <p>来一张 <b>二条</b> 或 <b>五条</b>，就能和它们连成顺子，凑满 4 组面子 + 1 对将。所以这手牌听<b>二条、五条</b>。</p>`,
  },
  {
    title: '小测验：听什么？',
    quiz: {
      question: `${tiles('123m 456s 789p 55m 67p')}这手牌听哪一张？`,
      // 这手牌听五筒、八筒，选项里只放其中一个正确答案
      options: ['9p', '8p', '6p'].map((s) => {
        const t = parseTiles(s)[0];
        const waits = waitingTiles(parseTiles('123m456s789p55m67p'));
        const ok = waits.includes(t);
        return {
          html: tiles(s),
          correct: ok,
          explain: ok
            ? `对！${tileName(t)}能和六筒、七筒连成顺子。这手牌听：${names(waits)}。`
            : `来${tileName(t)}凑不成胡牌。六筒、七筒要连成顺子，得来五筒或八筒。`,
        };
      }),
    },
  },
  {
    title: '第八步：打哪张？出牌技巧',
    body: `
      <p>每次打牌，都要想想<b>哪张最没用</b>：</p>
      <ul class="steps">
        <li><b>先打孤零零的字牌</b>：字牌不能组顺子，只有一张时最难用上。</li>
        <li><b>再打边上的孤张</b>：一万、九万这类边张，能连的牌比中间的少。</li>
        <li><b>留住对子和挨着的牌</b>：比如"三四"，再来二或五就能成顺子。</li>
      </ul>`,
  },
  {
    title: '小测验：打哪张？',
    quiz: {
      question: `${tiles('123m 456s 789p 55m 34s 5z')}你刚摸完牌，手里 14 张。打哪一张最好？`,
      options: [
        { html: tiles('5z'), correct: true, explain: '对！红中只有一张，又不能组顺子，打掉它最好。打完正好听二条、五条。' },
        { html: tiles('5m'), correct: false, explain: '五万是你的将（一对），拆了就少一个将了。' },
        { html: tiles('3s'), correct: false, explain: '三条和四条挨着，是快要成顺子的好牌，应该留着。' },
      ],
    },
  },
  {
    title: '准备好了！',
    body: `
      <p>你已经学会了：认牌 → 面子和将 → 胡牌公式 → 听牌 → 出牌技巧。</p>
      <p>开始实战吧！我帮你打开了<b>"提示"</b>功能：</p>
      <ul class="steps">
        <li>轮到你时，建议打的牌会<b>亮起来</b></li>
        <li>手牌上方会显示你现在<b>听哪些牌</b></li>
      </ul>
      <p>熟练以后，可以点右上角关掉提示。随时可以点"新手教学"再看一遍。</p>`,
  },
];

// ---------- 弹窗 ----------

let step = 0;
let onFinish = null;

function renderStep() {
  const s = STEPS[step];
  const box = $('#tutorial');
  box.querySelector('.tut-progress').textContent = `${step + 1} / ${STEPS.length}`;
  box.querySelector('.tut-bar').style.width = `${((step + 1) / STEPS.length) * 100}%`;
  box.querySelector('h2').textContent = s.title;

  let html = s.body || '';
  if (s.quiz) {
    html += `<div class="quiz-q">${s.quiz.question}</div><div class="quiz-options">${s.quiz.options
      .map((o, i) => `<button class="quiz-option" data-option="${i}">${o.html}</button>`)
      .join('')}</div><p class="quiz-feedback" aria-live="polite"></p>`;
  }
  const body = box.querySelector('.tut-body');
  body.innerHTML = html;
  body.scrollTop = 0;

  box.querySelector('[data-tut="prev"]').disabled = step === 0;
  const next = box.querySelector('[data-tut="next"]');
  next.textContent = step === STEPS.length - 1 ? '开始实战' : s.quiz ? '跳过' : '下一步';
}

function answer(i) {
  const s = STEPS[step];
  const opt = s.quiz.options[i];
  const box = $('#tutorial');
  box.querySelectorAll('.quiz-option').forEach((el, j) => {
    el.classList.remove('right', 'wrong');
    if (j === i) el.classList.add(opt.correct ? 'right' : 'wrong');
  });
  const fb = box.querySelector('.quiz-feedback');
  fb.textContent = opt.explain;
  fb.className = `quiz-feedback ${opt.correct ? 'right' : 'wrong'}`;
  if (opt.correct) box.querySelector('[data-tut="next"]').textContent = '下一步';
}

function close(finished) {
  $('#tutorial').hidden = true;
  if (finished && onFinish) onFinish();
}

export function openTutorial(finish) {
  onFinish = finish;
  step = 0;
  renderStep();
  $('#tutorial').hidden = false;
}

$('#tutorial').addEventListener('click', (e) => {
  const opt = e.target.closest('[data-option]');
  if (opt) return answer(Number(opt.dataset.option));
  const btn = e.target.closest('[data-tut]');
  if (!btn) return;
  const action = btn.dataset.tut;
  if (action === 'close') return close(false);
  if (action === 'prev' && step > 0) step--;
  if (action === 'next') {
    if (step === STEPS.length - 1) return close(true);
    step++;
  }
  renderStep();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#tutorial').hidden) close(false);
});
