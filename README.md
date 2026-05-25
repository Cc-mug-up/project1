# 寝室智控中心 v1.2

基于 Node.js + Express 的局域网多功能共享面板，手机与电脑通过 Wi-Fi 互通。

## 功能

| 模块 | 说明 |
|------|------|
| 📋 共享剪贴板 | 跨设备实时同步文字，3 秒自动拉取 |
| 💰 AA 记账 | 均摊计算、自动生成谁给谁多少钱的结算方案 |
| 💬 留言板 | 局域网实时消息，类似群聊 |
| 📁 文件闪传 | 拖拽上传、满速下载、上传下载双进度条 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

终端会打印局域网地址，例如：

```
WLAN:  http://192.168.0.100:3000
```

- 电脑浏览器打开 `http://localhost:3000`
- 手机连接同一 Wi-Fi，打开 `http://192.168.0.100:3000`（扫页面上的二维码也行）

## Windows 防火墙

手机打不开通常是防火墙拦截。以管理员身份运行一次：

```powershell
netsh advfirewall firewall add rule name="DormShare" dir=in action=allow protocol=TCP localport=3000
```

## 开机自启

双击 `start.bat` 手动启动，或已将 `start-silent.vbs` 放入启动文件夹实现开机自动后台运行。

## 换网了怎么办

IP 会变。打开页面顶部 Banner 会显示当前地址，点「📱 扫码」用手机扫二维码即可。

## 文件存在哪里

所有数据存在 `data/` 目录（JSON 文件），不上传任何服务器，纯局域网运行。
