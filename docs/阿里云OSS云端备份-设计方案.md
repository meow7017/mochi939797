# 阿里云 OSS 云端备份（RAM 子账号直传）— 设计方案

> 状态：待审阅 · 版本：v1.0
> 范围：以下仅为设计文档，**未改动任何代码**。审阅确认后再实现。

***

## 1. 目标

让每个用户用**自己的阿里云 OSS Bucket** 存储 mochi 的全量备份（聊天记录/字卡/头像/音乐/各类功能数据等），实现：

* **上传**：把当前全量数据包传到云端，实现跨设备备份。

* **恢复**：从云端拉取可靠的一份，走现有原子导入流程还原。

* **自动备份**（可选）：按开关定时/定期上传最新全量包。

**原则**：复用现有 [data-backup.js](../src/js/data-backup.js) 的"导出收集 / 导入恢复"逻辑，不另起数据读取。用户自带账号、各自隔离，互不影响。

***

## 2. 安全模型（为什么够安全）

* **RAM 子账号 + 最小权限**：每个用户自己在阿里云控制台创建 RAM 子账号，只授予"读写自己 Bucket 指定目录"的最小权限（见 §7 配置指引）。数据传到**他自己的 Bucket**。

* **密钥不进仓库/不进构建产物**：`AccessKeyId / AccessKeySecret` 只由用户在**运行时**填进设置页，仅存于本机 localStorage；源码与 GitHub 上不含任何密钥。

* **数据天然隔离**：A 用户看不到 B 用户的 Bucket；即便某用户密钥泄露，也仅影响他自己，不波及他人。

* **不用 STS / 不加后端**：本项目是纯前端 PWA（GitHub Pages），无服务器，不引入 STS 服务端签名，故采用 RAM 子账号直传。这是对"每个人自己管自己"场景的最简单可靠做法。

***

## 3. 实现方式：手写 OSS REST + HMAC 签名

### 3.1 为什么不用官方 `ali-oss` SDK

| <br />                 | 官方 SDK                                     | 手写 REST（本项目选用）                              |
| ---------------------- | ------------------------------------------ | ------------------------------------------- |
| 体积                     | 大，会撑爆 `SCRIPT_CHUNK_LIMIT` 拆块并加大包体         | 几百行自包含                                      |
| 与现有零依赖压缩构建兼容           | 需改造 [build.mjs](../build.mjs) 的逐行压缩器，维护成本高 | 完全兼容，加文件即可                                  |
| 离线 PWA / ServiceWorker | 外置依赖处理繁琐                                   | 内联进单文件，天然离线                                 |
| 能力                     | 断点续传/分片全                                   | 本场景仅需单对象上传/下载，够用                            |
| 断点续传                   | 需                                          | 聊天备份单文件大小受 OSS 单个对象上限（5GB）约束，个人场景远小于此，可不做分片 |

### 3.2 OSS PutObject / GetObject 签名（浏览器端）

OSS 的访问控制走 HTTP 请求头 `Authorization`，格式为：

```
Authorization: OSS <AccessKeyId>:<Signature>
```

`Signature = Base64( HMAC-SHA1(AccessKeySecret, StringToSign) )`

`StringToSign` 规范串（不启用 STS、不用 Content-MD5 时）：

```
<VERB>\n
\n                          // Content-MD5（空）
\n                          // Content-Type（空，或填 application/json）
<Date>\n                   // IMF-fixdate，如 new Date().toUTCString()
\n                          // CanonicalizedOSSHeaders（空，无需 x-oss-* 头）
<CanonicalizedResource>    // /<bucket>/<object> （含?子资源，本项目无）
```

浏览器端用 `crypto.subtle.importKey('raw', secret, {name:'HMAC', hash:'SHA-1'})` 后 `sign()`，再 `btoa` 得到签名。前提：**HTTPS 安全上下文**（GitHub Pages 天然满足）。

**要求用户配置 Bucket CORS**（§7 有步骤）：`AllowedOrigin` 配 `*`（或你的 GitHub Pages 域名）、`AllowedMethod` 配 `PUT/GET/HEAD`、`AllowedHeader` 配 `*`。否则浏览器跨域直传/下载会被拦。

### 3.3 关键常数与唯一端点

* Host：`<bucket>.<region-endpoint>`，如 `mybackup.oss-cn-hangzhou.aliyuncs.com`。

* 上传：`PUT https://<bucket>.<endpoint>/<object>`，body 为备份 JSON 文本。

* 下载：`GET https://<bucket>.<endpoint>/<object>`，得到备份 JSON 文本。

* 对象名（object key）：建议 `mochi-backup/<年-月-日__时-分-秒>.json`，按时间戳存多份。恢复时从云端列目录取最新一份（`GET ?prefix=mochi-backup/` 列目录）或由用户指定。

***

## 4. 配置项与存储键

存 localStorage，全局键（不带 per-cid，云备份对整个应用）：

| 键                               | 含义                                            | 类型         |
| ------------------------------- | --------------------------------------------- | ---------- |
| `xy-home-v2:cloud-oss:enabled`  | 自动备份开关                                        | `"1"`/`""` |
| `xy-home-v2:cloud-oss:bucket`   | Bucket 名                                      | string     |
| `xy-home-v2:cloud-oss:endpoint` | 区域 Endpoint（如 `oss-cn-hangzhou.aliyuncs.com`） | string     |
| `xy-home-v2:cloud-oss:ak`       | AccessKeyId                                   | string     |
| `xy-home-v2:cloud-oss:sk`       | AccessKeySecret                               | string     |
| `xy-home-v2:cloud-oss:last`     | 最近一次成功上传的本地时间戳                                | number     |

**密钥存储提示**：`ak` / `sk` 仅存本机 localStorage。文档中要告知用户"请勿在公共/他人设备勾选记住、注意设备安全"。

***

## 5. 数据流

### 5.1 上传（手动 / 自动）

```
用户点「上传到云端」/ 自动备份触发
        │
        ▼
调用 window.exportToData()      ← 复用 data-backup.js 的导出收集（全量无遗漏）
        │  返回备份 JSON 字符串
        ▼
REST：PUT https://<bucket>.<endpoint>/mochi-backup/<时间戳>.json
        │  （手写 HMAC 签名）
        ▼
成功 → 记录 last 时间戳 → 提示「已备份到云端，xx MB」
失败 → 分类提示（网络错 / 权限错 403 / CORS 被拦），不做半途中止
```

### 5.2 恢复（手动）

```
用户点「从云端恢复」
        │
        ▼
GET 列出 mochi-backup/ 目录 → 取最新一份（或用户手选一份）
        ▼ 下载备份 JSON → JSON.parse → 生成 {ls, idb} 数据对象
        ▼
走现有 doImportGo(data)         ← 复用 data-backup.js 的原子恢复 + idbRestore 回填
        │
        ▼
进度面板 + 核对关键数据 → 刷新页面
```

### 5.3 与现有导出的共享

* 从 `doExport` 中抽取"收集→打包 JSON"部分为新公共函数 `window.exportToData()`（返回 JSON 字符串）。**下载到本机**仍走原 `doExport` 保存流程，**云端上传**复用同一份产物，保证两端数据完全一致、不缺项。

* 恢复端直接调用 `data-backup.js` 已存在的 `doImportGo`，原子性/回滚/IDB 兜底全部沿用，不重复实现。

***

## 6. 文件改动清单（实现阶段执行，本次不改）

| 文件                              | 改动                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新增** `src/js/cloud-backup.js` | 主体：设置项读写、HMAC 签名、上传/下载/列目录、进度反馈、自动备份调度                                                                                                              |
| `build.mjs`                     | `jsFiles` 数组在 `data-backup.js` **之前**插入 `cloud-backup.js`（依赖：其调用 `window.exportToData` / `doImportGo`，均在其后定义可运行时调用，见 §8 顺序说明）；`FIX_SENTINELS` 加一行哨兵 |
| `data-backup.js`                | 抽出 `window.exportToData()`（导出收集逻辑复用）；暴露恢复入口（已有 `doImportGo` 可直接引用）                                                                                  |
| `src/template.html`             | 设置页「云端备份」分组静态锚点（若设置区由 JS 渲染则仅 JS；待实现时核对）                                                                                                            |
| 设置 CSS（`setting.css`）           | 新增分组/输入框样式（沿用现有设置页风格）                                                                                                                               |
| `mobile-adapt.js`               | 进度遮罩加入 `FLOAT_SELECTORS` 列表（复用导入进度遮罩即可，若新增可复用 `cc-import-progress` 则无需改）                                                                            |
| `AGENTS.md` / 本项目文档             | NEW 文件属数据层（AI-B 域）；跨域改动需按协议在 WORKLOG 留留言（实现时）                                                                                                       |
| `README.md`                     | 借鉴接入来源/API 文档标注（按项目历史要求）                                                                                                                            |
| `src/pwa/notice.json`           | 开屏公告/新增功能介绍补文案                                                                                                                                      |
| `WORKLOG.md`                    | 开工/完工各记一行                                                                                                                                           |

> 版本号：`build.mjs` 的 `APP_VERSION` 系列随本次提交递增（v3.26.x），提交 message 按 `v3.26.x: …` 约定。

***

## 7. 用户侧配置指引（需要写进设置页操作说明 / 介绍页）

1. 登录阿里云控制台 → 新建 **RAM 子账号**，仅授权目标 Bucket 指定前缀的最小权限（避免误授整个账号权限）。
2. 创建 **OSS Bucket**，记录 Bucket 名与区域 Endpoint。
3. 在该 Bucket 的「权限管理 → 跨域设置（CORS）」添加规则：

   * 来源：`*`

   * 方法：`PUT, GET, HEAD`

   * 允许 Headers：`*`

   * 暴露 Headers：`ETag`（可选）
4. 将子账号的 `AccessKeyId / AccessKeySecret` 填进 mochi 设置页「云端备份」。

> 提示文案：密钥只存本机，请在可信设备上使用；如泄露可随时在控制台禁用该子账号。

***

## 8. 关键风险与边界

* **依赖顺序**：`cloud-backup.js` 运行时才调用 `window.exportToData` / `doImportGo`，均在页面加载后可用，不受 build 顺序影响；但为清晰仍将其排在 `data-backup.js` 前。

* **`crypto.subtle`** **需 HTTPS**：GitHub Pages 已 HTTPS，OK；本地 `file://` 打开无法用 crypto.subtle，云端备份在 `file://` 下不可用（文档注明）。

* **CORS 未配置**：报错应明确提示"请检查 Bucket 跨域设置"，而非笼统"网络错误"。

* **超大单个对象**：OSS 单对象上限 5GB，聊天备份（含图片 base64）一般远小于此；暂不做分片，若未来超限再补。

* **文件：一定不能把 AccessKey 写进任何源码/产物**，构建后哨兵检查只验证代码特征，密钥在运行时才输入。

* **自动备份的触发**：建议低频（每次启动后/手动触发为主），避免频繁写 OSS 产生流量费用；默认关，用户开。

***

## 9. 验收与回归防线（实现后执行）

* 新增 `FIX_SENTINELS` 哨兵：`cloud-backup.js` 的 `window.cloudOss` 或 HMAC 签名函数名特征。

* 手测路径：

  1. 配置 RAM 子账号 + CORS，点「上传到云端」→ 成功、对象名带时间戳。
  2. 清本地数据 → 「从云端恢复」→ 聊天/头像取回，核对条数。
  3. 未配 CORS / 密钥错 → 报错提示友好。
  4. 自动备份开关开 → 触发时上传，成功后 `last` 更新。
  5. `node build.mjs` 后看哨兵输出 + `npm run verify` 系列（无头 Chrome 布局）。

***

## 10. 明确不做（本次范围外）

* 不做后端 / 不做 STS 服务端签名。

* 不做多人共享协作同步（仅个人单向备份/恢复）。

* 不做增量 diff，全量包覆盖式备份（与现有手动导出一致）。

