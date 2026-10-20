import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Game } from './src/game.js';

const rl = readline.createInterface({ input: stdin, output: stdout });
// 输入流结束（Ctrl+C / Ctrl+D）时直接退出
rl.on('close', () => {
  console.log('\n再见！');
  process.exit(0);
});

const io = {
  log: (msg) => console.log(msg),
  ask: (question) => rl.question(question),
};

try {
  do {
    await new Game(io).play();
  } while ((await io.ask('\n再来一局？(y/n)：')).trim().toLowerCase() === 'y');
} finally {
  rl.close();
}
