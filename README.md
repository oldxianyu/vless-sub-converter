# VLESS to Clash 订阅转换器 (Cloudflare Worker 版)

这是一个部署在 Cloudflare Workers 上的轻量级订阅转换工具。
它可以将 VLESS 节点链接转换为 Clash Meta (Mihomo) 支持的订阅配置，完美支持 Reality 和 XTLS-Vision。

## ✨ 功能特点

- **隐私安全**：代码部署在自己的 Cloudflare 账号，数据仅存放在私有 KV 中。
- **最新协议**：支持 VLESS Reality, Vision, GRPC 等新参数。
- **真·订阅**：基于 KV 存储生成短链接，支持 Clash 客户端云端更新。
- **安全防护**：内置 IP 频率限制（60秒/5次）和防覆盖机制。
- **自动分流**：集成 Loyalsoldier 规则集（自动分流 Apple, Google, 广告拦截等）。
- **美观界面**：内置现代化 Web UI，支持一键生成和复制。

## 🚀 部署教程

1. 登录 Cloudflare Dashboard，创建一个 **Worker**。
2. 创建一个 **KV Namespace** (例如命名为 `vless_db`)。
3. 在 Worker 的 **Settings -> Variables** 中绑定 KV：
   - Variable name: `KV` (必须大写)
   - KV Namespace: 选择你刚才创建的数据库
4. 将 `worker.js` 的代码复制到 Worker 编辑器中并部署。
5. 访问 Worker 的域名即可使用。

## ⚠️ 免责声明
本项目仅供学习交流使用，请勿用于非法用途。
