# 寝室智控中心 v2.0

基于 Node.js + Express + Socket.io 的局域网多功能共享面板，手机与电脑通过 Wi-Fi 互通。

## 功能

| 模块 | 说明 |
|------|------|
| 📋 共享剪贴板 | 跨设备实时同步文字，Socket.io 毫秒级推送 |
| 💰 AA 记账 | 均摊计算、自动生成谁给谁多少钱的结算方案 |
| 💬 留言板 | 局域网实时群聊，Socket.io 毫秒级收发 |
| 📁 文件闪传 | 服务器中转上传下载 + ⚡ WebRTC P2P 直传 |
| ⚡ P2P 直传 | 设备间直连传输，不经过服务器，跑满千兆局域网 |

## 快速开始

```bash
# 1. 安装运行环境（一次性）
winget install OpenJS.NodeJS.LTS          # Node.js
winget install MongoDB.Server              # MongoDB（自动后台运行）

# 2. 克隆项目
git clone git@github.com:Cc-mug-up/dorm-share.git
cd dorm-share

# 3. 双击 setup.bat
```

`setup.bat` 自动完成：装 npm 依赖 → 配防火墙 → 启动服务。

> 首次运行弹出 UAC 窗口点"是"（配置防火墙 3000 端口）。

终端打印局域网地址（如 `http://192.168.0.100:3000`），手机连同一 Wi-Fi 打开即可，或扫页面上的二维码。

## WebRTC P2P 直传怎么用

1. 两台设备都打开网页，进入「文件闪传」
2. 底部 P2P 区域会显示在线设备，点击选中目标
3. 拖拽文件到 P2P 上传区
4. 对方屏幕弹出接收请求 → 点接受 → 文件直传开始

数据不经过服务器，速度仅受路由器限制（千兆 ≈ 100MB/s）。

## 换网 / 换电脑

IP 会变，页面顶部 Banner 实时显示当前地址。新电脑装 Node.js + MongoDB 后双击 `setup.bat`。

## 项目结构

```
dorm-share/
├── server.js          # Express + Socket.io 主程序
├── models/            # Mongoose 数据模型
│   ├── db.js          #   MongoDB 连接
│   ├── User.js        #   用户表（自动 upsert）
│   ├── Clipboard.js   #   剪贴板单例
│   ├── Expense.js     #   账单表
│   ├── Message.js     #   留言表
│   └── FileMeta.js    #   文件索引
├── public/            # 前端（纯 HTML/CSS/JS）
│   ├── index.html     #   主页面 + 全部 CSS 内联
│   └── app.js         #   前端逻辑
├── data/uploads/      # 上传文件目录
├── setup.bat          # 一键启动脚本
└── start.bat          # 手动启动（可选）
```

## E-R 数据模型

```
┌──────────┐        ┌──────────────┐
│   User   │───┐    │  Clipboard   │
│  _id (PK)│   │    │  _id (固定)  │  单例文档
│  name    │   │    │  content     │
│  createdAt│  │    │  updatedAt   │
└──────────┘   │    └──────────────┘
               │
        payer  │    ┌──────────────┐        ┌──────────────┐
        (FK)   ├───→│   Expense    │        │   Message    │
               │    │  _id (PK)    │        │  _id (PK)    │
               │    │  amount      │        │  author (FK) │
               │    │  category    │        │  content     │
               │    │  description │        │  date        │
               └───→│  payer  (FK) │        └──────────────┘
              author│  date        │
              (FK)  └──────────────┘
```

- **User** — 用户表，记账和留言自动 upsert 用户
- **Clipboard** — 剪贴板单例文档（永远只有一条，upsert 更新）
- **Expense** — 账单表，`payer` 外键关联 `User.name`
- **Message** — 留言表，`author` 外键关联 `User.name`
- **FileMeta** — 文件元数据索引（文件本体存磁盘）

## 技术栈

- 后端：Express + Socket.io + Multer + Mongoose
- 前端：纯 HTML/CSS/JS，暗色赛博朋克主题，Dialog 式交互
- 存储：MongoDB（4 张核心表：User / Clipboard / Expense / Message）
- 文件：磁盘存储（`data/uploads/`）+ MongoDB 元数据索引
- 通信：HTTP（记账+文件）+ WebSocket（剪贴板+留言板）+ WebRTC（P2P 文件）
