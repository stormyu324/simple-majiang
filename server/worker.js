// Worker 入口：/majiang/api/* 走房间服务器，其他路径交给静态文件
//   POST /majiang/api/create            创建房间，返回 { code }
//   GET  /majiang/api/room/<房间号>/ws   WebSocket 连接房间（玩家或观战）
export { MajiangRoom } from './room.js';

const API = /^\/majiang\/api\/(?:(create)|room\/(\d{4})\/ws)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(API);
    if (!m) return env.ASSETS.fetch(request);

    if (m[1]) {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const { variant } = await request.json().catch(() => ({}));
      // 随机挑一个没人用的 4 位房间号
      for (let i = 0; i < 20; i++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
        const res = await room(env, code).fetch('https://room/claim', { method: 'POST', body: JSON.stringify({ variant }) });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: '房间太多了，请稍后再试' }, { status: 503 });
    }

    return room(env, m[2]).fetch(request);
  },
};

function room(env, code) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}
