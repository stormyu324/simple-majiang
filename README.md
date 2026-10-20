# 简单麻将

一个简单的麻将游戏：你和 3 个电脑对手打一局。有**网页版**（带牌面图案，点击出牌）和**命令行版**两种玩法。

## 运行

需要 Node.js 18 或更高版本，不需要安装任何依赖。

```bash
npm run web    # 网页版：自动在浏览器打开 http://localhost:8080/
npm start      # 命令行版
npm test       # 运行测试
```

网页版不能直接双击 `web/index.html` 打开（浏览器不允许本地文件加载模块代码），要用 `npm run web`。

## 在线试玩

- https://games.stormnovalabs.com/majiang/ （Cloudflare Worker）
- https://stormyu324.github.io/simple-majiang/ （GitHub Pages，推送后自动更新）

更新 Cloudflare 上的版本：

```bash
npx wrangler login   # 第一次需要登录
npm run deploy       # 生成 dist/ 并部署
```

## 好友对战和观战（网页版）

打开网页先选模式：**单人练习**（和 3 个电脑打）或**好友对战**。

- **创建房间**拿到 4 位房间号，点"复制邀请链接"发给好友；好友打开链接点"加入"
- 最多 4 个人，房主随时可以开局，空座位由电脑来打
- 对局中有人掉线，电脑先替他打；他刷新页面或重新连上后接着自己打
- 出牌限时 30 秒，胡/碰 限时 15 秒，超时自动处理
- **观战**：输入房间号点"观战"。观战的人只能看到打出的牌、碰出的牌和每家张数，一局结束后才翻开所有手牌。两局之间有空位时可以点"入座"
- 牌局全部在服务器上判定，每个人只收到自己能看的牌，打开开发者工具也看不到别人的手牌

好友对战需要房间服务器，只能在 games.stormnovalabs.com/majiang/ 上玩；GitHub Pages 和 `npm run web` 只能单人练习。本地测试好友对战用：

```bash
npm run build && npx wrangler dev   # 打开 http://localhost:8787/majiang/
```

## 规则

- 136 张牌：万、条、筒各 1-9，字牌东南西北中发白，每种 4 张
- 每人起手 13 张，轮流摸一张、打一张
- 可以**碰**别人打出的牌（手里有一对相同的牌）
- 胡牌方式：
  - 标准胡：4 组面子（顺子或刻子）+ 1 对将
  - 七对：7 个对子
- 可以**自摸**，也可以胡别人打出的牌（点炮）
- 牌墙摸完没人胡就流局

没有吃、杠和番数计算，保持简单。

## 新手教学（网页版）

- **📖 新手教学**：14 步从零教起——认牌、面子和将、胡牌公式、一回合怎么打、听牌、出牌技巧，中间有 4 道小测验。第一次打开网页会自动弹出。
- **提示**：打开后，轮到你时会高亮建议打的牌，并显示你现在听哪些牌。学完教学会自动打开。

## 代码结构

```
index.js           命令行入口
src/tiles.js       牌的表示、名称、洗牌
src/rules.js       胡牌、碰牌判定
src/ai.js          电脑的出牌策略
src/game.js        游戏流程（两个版本共用）
web/index.html     网页版页面
web/main.js        网页版界面：菜单、等候室、渲染牌桌、处理点击
web/online.js      好友对战：创建房间、WebSocket 连接和断线重连
server/worker.js   Cloudflare Worker 入口：/majiang/api/* 交给房间，其他是静态文件
server/room.js     房间服务器（Durable Object）：座位、观战、牌局判定
web/tile-art.js    用 SVG 画牌面
web/tutorial.js    新手教学和小测验
web/style.css      样式
web/server.js      本地静态服务器（npm run web）
test/              测试
```
