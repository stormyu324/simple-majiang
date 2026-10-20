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

- https://games.stormnovalabs.com/majiang/ （Cloudflare Worker；旧地址 majiang.stormnovalabs.com 也还能用）
- https://stormyu324.github.io/simple-majiang/ （GitHub Pages，推送后自动更新）

更新 Cloudflare 上的版本：

```bash
npx wrangler login   # 第一次需要登录
npm run deploy       # 生成 dist/ 并部署
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
web/main.js        网页版界面：渲染牌桌、处理点击
web/tile-art.js    用 SVG 画牌面
web/tutorial.js    新手教学和小测验
web/style.css      样式
web/server.js      本地静态服务器（npm run web）
test/              测试
```
