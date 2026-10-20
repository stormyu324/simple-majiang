// 声音：音效和背景音乐用 Web Audio 现场合成（不需要下载音频文件），
// 配音用浏览器自带的中文语音朗读（speechSynthesis）。
//
// 浏览器规定页面要等用户点过一下之后才能出声，所以第一次点击时才真正启动。

const PREFS_KEY = 'mj-sound';
const DEFAULTS = { sfx: true, voice: true, music: true, volume: 0.8, musicVolume: 0.5 };

function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = loadPrefs();

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

let ctx = null;
let master = null; // 音效总音量
let musicBus = null; // 背景音乐音量
let reverb = null;
let noise = null; // 一段白噪声，做牌的碰撞声用

function setup() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = prefs.volume;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = prefs.musicVolume * prefs.volume * 0.35;
  musicBus.connect(ctx.destination);

  // 简单的混响：用衰减的噪声当冲激响应，让古筝声更有空间感
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.2;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  reverb.connect(wet).connect(musicBus);

  noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return true;
}

// 第一次点击/触摸页面时启动声音
export function unlock() {
  if (!setup()) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (prefs.music) startMusic();
}

// ---------- 音效 ----------

// 牌碰到桌面的"嗒"一声：一小段带通滤波的噪声 + 低音
function clack(at = 0, { gain = 1, pitch = 1 } = {}) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600 * pitch;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.4, 0.06);

  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(260 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.05);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.35 * gain, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(og).connect(master);
  o.start(t);
  o.stop(t + 0.08);
}

// 洗牌：一阵沙沙的噪声
function shuffle(at = 0, dur = 0.9) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.15);
  g.gain.linearRampToValueAtTime(0.18, t + dur - 0.2);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
  // 洗牌时夹杂的碰撞声
  for (let i = 0; i < 10; i++) clack(at + Math.random() * dur, { gain: 0.25, pitch: 0.8 + Math.random() * 0.5 });
}

// 拨弦音（古筝感）：三角波 + 高八度泛音，快起慢落
function pluck(freq, at = 0, { gain = 0.5, dur = 1.6, out = master, wet = false } = {}) {
  const t = ctx.currentTime + at;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 6, t);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur * 0.6);
  lp.connect(g);
  g.connect(out);
  if (wet) g.connect(reverb);
  for (const [mult, type, level] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const og = ctx.createGain();
    og.gain.value = level;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

const note = (semi) => 293.66 * 2 ** (semi / 12); // 以 D 为宫
const PENTA = [0, 2, 4, 7, 9]; // 宫 商 角 徵 羽

function chime(notes, step = 0.12, gain = 0.4) {
  notes.forEach((s, i) => pluck(note(s), i * step, { gain, dur: 1.2 }));
}

const EFFECTS = {
  discard: () => clack(0, { gain: 1 }),
  draw: () => clack(0, { gain: 0.45, pitch: 1.2 }),
  meld: () => { clack(0); clack(0.07, { gain: 0.8 }); clack(0.14, { gain: 0.7 }); },
  deal: () => {
    shuffle(0, 1.0);
    for (let i = 0; i < 13; i++) clack(1.05 + i * 0.07, { gain: 0.5, pitch: 0.9 + (i % 3) * 0.08 });
  },
  notify: () => chime([12, 19], 0.09, 0.25),
  tick: () => clack(0, { gain: 0.35, pitch: 1.8 }),
  win: () => chime([0, 4, 7, 9, 12, 16, 19, 24], 0.1, 0.45),
  lose: () => chime([12, 9, 7, 4, 0], 0.16, 0.3),
  draw_game: () => chime([7, 4, 7, 0], 0.18, 0.3),
};

export function play(name) {
  // 刚点击时音频还在启动（suspended），这时排进去的声音等启动好了照样会响
  if (!prefs.sfx || !ctx) return;
  EFFECTS[name]?.();
}

// ---------- 配音 ----------

let zhVoice;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find((v) => /zh[-_]CN/i.test(v.lang)) ?? voices.find((v) => /^zh/i.test(v.lang)) ?? null;
  return zhVoice;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function voiceAvailable() {
  return Boolean(zhVoice ?? pickVoice());
}

// pitch 用来区分不同座位的人
export function say(text, { pitch = 1 } = {}) {
  if (!prefs.voice || !('speechSynthesis' in window)) return;
  // 来不及说完的旧内容丢掉，免得配音越落越后
  if (speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  if (zhVoice) u.voice = zhVoice;
  u.rate = 1.15;
  u.pitch = pitch;
  u.volume = prefs.volume;
  speechSynthesis.speak(u);
}

// ---------- 背景音乐 ----------
//
// 五声音阶的古筝风格小曲，现场随机生成，不会每遍都一样：
// 每小节一个低音，旋律在五声音阶上小步游走，偶尔来一个琶音。

let musicTimer = null;
let nextBar = 0;
let melodyPos = 2; // 旋律在音阶里的位置

const BAR = 3.2; // 一小节多少秒（4 拍，每分钟 75 拍）
const BASS = [0, -5, -3, -8]; // 宫、徵、羽、角的低音进行（半音，相对 D）

function scaleNote(pos) {
  const octave = Math.floor(pos / 5);
  return PENTA[((pos % 5) + 5) % 5] + octave * 12;
}

function scheduleBar(start, bar) {
  const at = start - ctx.currentTime;
  const bass = BASS[bar % BASS.length];
  pluck(note(bass - 12), at, { gain: 0.32, dur: 3, out: musicBus, wet: true });
  pluck(note(bass - 5), at + BAR / 2, { gain: 0.16, dur: 2, out: musicBus, wet: true });

  // 每 4 小节的最后一小节用琶音收尾
  if (bar % 4 === 3) {
    [0, 2, 4, 5, 7].forEach((p, i) => pluck(note(scaleNote(p)), at + i * 0.22, { gain: 0.2, dur: 2.2, out: musicBus, wet: true }));
    return;
  }
  const beat = BAR / 8;
  for (let i = 0; i < 8; i++) {
    // 有时候空一拍，留点呼吸
    if (Math.random() < (i % 2 ? 0.55 : 0.25)) continue;
    melodyPos += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    melodyPos = Math.max(0, Math.min(9, melodyPos));
    const vel = i % 4 === 0 ? 0.26 : 0.18;
    pluck(note(scaleNote(melodyPos)), at + i * beat, { gain: vel, dur: 1.8, out: musicBus, wet: true });
    // 古筝的"轮指"：偶尔快速重复一下
    if (Math.random() < 0.12) pluck(note(scaleNote(melodyPos)), at + i * beat + beat / 3, { gain: vel * 0.6, dur: 1, out: musicBus, wet: true });
  }
}

let barCount = 0;
function startMusic() {
  if (musicTimer || !ctx || document.hidden) return;
  nextBar = ctx.currentTime + 0.3;
  const tick = () => {
    // 提前排好接下来一小节，定时器不准也不会断
    while (nextBar < ctx.currentTime + BAR) {
      scheduleBar(nextBar, barCount++);
      nextBar += BAR;
    }
  };
  tick();
  musicTimer = setInterval(tick, 500);
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

// 切到别的标签页时停掉音乐
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopMusic();
  else if (prefs.music && ctx) startMusic();
});

// ---------- 设置 ----------

export function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  if (!ctx) return;
  master.gain.value = prefs.volume;
  musicBus.gain.value = prefs.musicVolume * prefs.volume * 0.35;
  if (key === 'music') (value ? startMusic() : stopMusic());
  if (key === 'voice' && !value && 'speechSynthesis' in window) speechSynthesis.cancel();
}
