// 把网页版需要的文件复制到 dist/，用于部署到 majiang.stormnovalabs.com
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/`;

await rm(out, { recursive: true, force: true });
await cp(`${root}index.html`, `${out}index.html`);
await cp(`${root}src`, `${out}src`, { recursive: true });
// server.js 只在本地用，不需要部署
await cp(`${root}web`, `${out}web`, { recursive: true, filter: (src) => !src.endsWith('server.js') });

console.log('已生成 dist/');
