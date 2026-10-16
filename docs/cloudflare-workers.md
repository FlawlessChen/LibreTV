# Cloudflare Workers 部署

本仓库使用 OpenNext 将 Next.js 15 的服务端路由和页面部署到 Workers。
使用 Node.js 22，安装依赖后生成 Worker 产物；无需 R2、KV 或 D1。
原有 npm run dev、npm run build、npm start 和 Docker 部署仍可使用。

## 本地构建与检查

```powershell
npm ci
npm run cf:typegen
npm run typecheck
npm test
npm run build:worker
npm run check:worker
```

- build:worker：先执行 next build，再生成 .open-next/worker.js 和静态资源。
- check:worker：Wrangler 本地打包校验，不会上传或部署。
- cf:typegen：根据 wrangler.jsonc 生成本地 Cloudflare 类型。

## 在 Workers 运行时预览

复制 .env.example 为 .dev.vars，并修改其中的 PASSWORD 为本地测试密码：

```powershell
Copy-Item .env.example .dev.vars
npm run preview:worker
```

先执行 build:worker，再执行 preview:worker。预览使用本地 Workers 运行时，
可以验证登录、搜索、点播代理和直播接口，不需要 Cloudflare 登录。
.dev.vars 已被 Git 忽略，不要将密码放入 wrangler.jsonc 或提交到仓库。

## 通过 Cloudflare 控制台连接 GitHub

1. 进入 Workers & Pages，创建应用，选择导入 Git 仓库的 Workers 流程。
2. 选择自己的 LibreTV fork，以及已包含本次适配的分支。
3. Worker 名称设置为 libretv（应与 wrangler.jsonc 的 name 一致）。
4. 构建命令：npm run build:worker。
5. 部署命令：npm run deploy:worker。
6. 创建后，在 Worker 的 Settings → Variables and Secrets 中添加机密 PASSWORD。
   选择保存并部署配置变更，然后访问 Workers 提供的 HTTPS 地址。

PASSWORD 必须作为 Worker 运行时机密设置。本项目不需要在构建阶段提供密码；
不要使用 NEXT_PUBLIC_PASSWORD，也不要把本地 .env/.dev.vars 上传到仓库。
可选运行时机密 PROXY_SECRET 用于固定会话签名密钥；未设置时从 PASSWORD 派生。
其他 DEFAULT_SOURCES、DEFAULT_SUBSCRIPTIONS、REQUEST_TIMEOUT 等变量仍按 README 配置。
配置中的 keep_vars 保留控制台设置的普通变量，避免后续 Git 部署将其清除。

如需更改 Worker 名称，同时修改 wrangler.jsonc 的 name 与控制台项目名称。
自定义域名可以在部署完成后通过 Worker 的 Domains & Routes 添加。

## 命令行部署

```powershell
npx wrangler login
npm run build:worker
npm run deploy:worker
npx wrangler secret put PASSWORD
```

最后一步在交互提示中输入访问密码。首次部署尚未设置 PASSWORD 时，站点会提示管理员配置。

## 兼容处理与限制

- DNS 校验使用 Workers 支持的 resolve4/resolve6，同时检查 IPv4 和 IPv6；
  两种查询都失败时拒绝代理，避免静默跳过内网地址拦截。
- 登录限流记录在请求中按需清理，不在模块加载时启动后台定时器。
- 登录限流与热点缓存保存在单个 Worker isolate 内，属于尽力而为的限制和缓存，
  不构成跨地区、跨实例的统一配额。如需严格全局限流，应单独接入集中式状态服务。
- Workers 无法直接访问你电脑或家庭网络里的 IPTV 地址；LIVE_ALLOW_PRIVATE 不能建立内网连接。
- 第三方数据源、视频流仍可能因上游限制而不可用；部署后应使用自己的源测试实际播放。
- OpenNext 对 Windows 原生环境的支持有限；GitHub Actions 和 Cloudflare 构建使用 Linux。
- Worker 压缩体积、CPU 和子请求仍受 Cloudflare 账号套餐限制；check:worker 会输出打包体积。

## 持续验证

.github/workflows/workers-check.yml 在推送和 PR 时验证单测、类型、lint、
OpenNext 生产构建和 Wrangler 打包，不需要部署令牌，也不会部署到 Cloudflare。

参考：
- https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- https://opennext.js.org/cloudflare/get-started
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/
