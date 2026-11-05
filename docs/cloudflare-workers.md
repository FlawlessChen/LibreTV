# Cloudflare Workers 部署

本仓库使用 OpenNext 将 Next.js 15 的服务端路由和页面部署到 Workers。
使用 Node.js 22，安装依赖后生成 Worker 产物；无需 R2、KV 或 D1。
原有 npm run dev、npm run build、npm start 和 Docker 部署仍可使用。

## 当前部署入口

- 自定义域名：https://tv.cqfly.xyz
- Workers 默认地址：https://libretv.171444135.workers.dev

wrangler.jsonc 已记录自定义域名绑定，并显式启用 workers.dev 地址。
两个入口连接同一个 Worker，使用相同的运行时密码；浏览器会分别保存各域名的登录 Cookie。

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

## 当前默认播放源

生产站点的 DEFAULT_SOURCES 配置备份见 [cloudflare-default-sources.json](./cloudflare-default-sources.json)。
2026-11-05 保留原有 360、量子、金鹰，在末尾追加暴风、非凡、虎牙、红牛，共 7 个源。
追加源时不要重排已有条目：预置源的 env_0、env_1 等 key 来自数组下标，重排会改变历史记录和收藏关联的源。

新增的 4 个源已通过生产 Worker 对《嫁金钗》第一集的搜索、详情、m3u8 和两处 128 KiB
分片采样检查；带 AES-128 加密的虎牙和红牛同时检查了 16 字节密钥响应。
这些检查反映测试时的可达性，不保证所有影片、所有地区或长期持续播放速度。
本次未加入分片超时的速播、清单返回 403 的无尽和暂不支持搜索的闪电。

修改这个 JSON 文件不会自动更新线上环境变量。需要在 libretv Worker 的 Variables and Secrets
中将 DEFAULT_SOURCES 的值更新为文件内的 JSON 数组并部署；现有 PASSWORD、PROXY_SECRET 保持原值。
新源首次下发后前端会自动勾选，刷新站点即可看到；已经手动取消勾选的源会保留用户选择。

## 浏览器播放器

点播页默认使用浏览器自带控件。夸克和支持原生 HLS 的浏览器优先直接加载 m3u8 地址，
方便浏览器接管播放；源不可达时尝试同源代理，必要时再使用 hls.js 兼容播放。
播放区下方可切换浏览器播放器／网页播放器，选择保存在当前设备，切换时保留进度。
浏览器模式的原生路径由浏览器处理媒体，网页播放器继续提供广告过滤和前向预缓存。
夸克自己的接管界面和投屏入口仍取决于手机端浏览器能力及设置。

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
