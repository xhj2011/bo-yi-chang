# 博弈场 · 多人公网版

每个玩家用自己的设备访问同一个网址。

## 本地运行

```bash
npm install
npm start
```

然后打开：

```
http://localhost:3000
```

## 人机测试

- 创建房间后，房主可以点击“添加机器人”；
- 建议先加 3 个机器人，凑成 4 人再开始游戏；
- 机器人会自动参与正常事件的秘密选择，也会出现在最后通牒中。


## 部署到托管平台

推荐使用 Railway、Render 或 Fly.io 等支持 WebSocket 的托管平台。

### Railway 快速流程

1. 在 GitHub 上创建一个仓库，把本项目推上去；
2. 在 Railway 中新建项目并选择该仓库；
3. 平台会自动安装依赖并运行 `npm start`；
4. Railway 会分配一个公网地址；
5. 玩家打开该地址即可。

### Render 快速流程

1. 把项目推到 GitHub；
2. 在 Render 中新建 Web Service；
3. Runtime 选择 Node；
4. Build Command：`npm install`
5. Start Command：`npm start`
6. 等待部署完成后访问分配的公网地址。

注意：必须选择支持 WebSocket 的托管平台。  
Vercel 和 Netlify 主要面向静态站/Serverless，不适合第一版。

## 目录结构

```
bo-yi-chang/
├── server.js          # Node.js + WebSocket 服务器
├── package.json
└── public/
    └── index.html     # 玩家端网页
```

## 当前功能

- 创建房间 / 加入房间
- 初始积分 100
- 公开聊天
- 12 种博弈事件（含决斗、重复囚徒困境、海盗分金、全支付拍卖等多阶段/特殊事件），每局随机抽 6 种
- 同时秘密选择
- 最后通牒特殊流程
- 实时积分榜
- 最终排名
