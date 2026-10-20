// 联网对战：创建房间、用 WebSocket 连接房间服务器，断线自动重连
// 接口在页面的上一级目录：/majiang/web/ → /majiang/api/
const API = new URL('../api/', location.href);
const OFFLINE_MSG = '这个网址不支持好友对战，请到 games.stormnovalabs.com/majiang/ 上玩';

// 座位凭证存在 sessionStorage：刷新页面能回到原来的座位；
// 同一台电脑开两个标签页就是两个玩家
function loadToken(code) {
  try { return sessionStorage.getItem(`mj-token-${code}`); } catch { return null; }
}
// 这个标签页之前是否坐在这个房间里（刷新页面后用来自动回到座位）
export function hasSeat(code) {
  return Boolean(loadToken(code));
}
function saveToken(code, token) {
  try { sessionStorage.setItem(`mj-token-${code}`, token); } catch {}
}

// variant：房间一开始用的玩法，进房间后房主还可以换
export async function createRoom(variant) {
  let res;
  try {
    res = await fetch(new URL('create', API), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    });
  } catch {
    throw new Error('网络连接失败，请稍后再试');
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.code) return data.code;
  if (data?.error) throw new Error(data.error);
  throw new Error(OFFLINE_MSG);
}

export class OnlineRoom {
  // handlers: { onMessage(msg), onStatus(status) }，status: connecting | connected | reconnecting | closed | failed
  constructor(code, role, name, handlers) {
    this.code = code;
    this.role = role;
    this.name = name;
    this.handlers = handlers;
    this.closed = false;
    this.retries = 0;
    this.connect();
    this.pinger = setInterval(() => this.send({ t: 'ping' }), 20_000);
  }

  connect() {
    const url = new URL(`room/${this.code}/ws`, API);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.handlers.onStatus(this.retries ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.retries = 0;
      ws.send(JSON.stringify({ t: 'join', role: this.role, name: this.name, token: loadToken(this.code) }));
      this.handlers.onStatus('connected');
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') {
        if (msg.token) saveToken(this.code, msg.token);
        this.role = msg.role; // 房间满了会变成观战
      }
      if (msg.t === 'error' && msg.fatal) this.fatal = true;
      this.handlers.onMessage(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      // 4000：同一个座位在别的窗口打开了，这边就不再抢回来
      if (this.closed || this.fatal || e.code === 4000) {
        this.stop();
        this.handlers.onStatus(e.code === 4000 ? 'replaced' : 'closed');
        return;
      }
      if (!opened && this.retries === 0) {
        this.stop();
        this.handlers.onStatus('failed');
        return;
      }
      if (this.retries++ < 10) {
        this.handlers.onStatus('reconnecting');
        setTimeout(() => !this.closed && this.connect(), Math.min(1000 * this.retries, 5000));
      } else {
        this.stop();
        this.handlers.onStatus('failed');
      }
    };
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  stop() {
    clearInterval(this.pinger);
  }

  close() {
    this.closed = true;
    this.stop();
    try { this.ws?.close(); } catch {}
  }
}
