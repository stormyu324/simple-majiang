// 把网页版需要的文件复制到 dist/majiang/，用于部署到 games.stormnovalabs.com/majiang/
// Worker 只接管 /majiang 开头的路径，所以静态文件也要放在 majiang/ 目录下
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist/`;
const out = `${dist}majiang/`;

await rm(dist, { recursive: true, force: true });
await cp(`${root}index.html`, `${out}index.html`);
await cp(`${root}src`, `${out}src`, { recursive: true });
// server.js 只在本地用，不需要部署
await cp(`${root}web`, `${out}web`, { recursive: true, filter: (src) => !src.endsWith('server.js') });

console.log('已生成 dist/');
