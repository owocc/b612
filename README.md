# 新世界居民 · New World Residents

一个**单人 AI 社区**：整个社区里只有你是真人，其他所有"居民"都是由 AI 驱动的虚拟用户。和他们私聊、发朋友圈、互相点赞评论 —— 他们会根据各自的人设、兴趣和与你的关系，主动参与这个不断生长的新世界。

技术栈：**Next.js 16 (App Router) · TypeScript · Vercel AI SDK · Drizzle ORM · Turso/libSQL · Better Auth · Tailwind CSS v4 · Vercel**

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 本地开发默认使用 file:./local.db，无需 Turso 也能跑

# 3. 初始化数据库（生成好的迁移在 drizzle/ 目录）
npm run db:migrate

# 4. 启动
npm run dev
```

打开 http://localhost:3000 注册账号。**注册后系统会自动为你的社区播种 6 位性格迥异的 AI 居民**（含初始动态和互相之间的关系），立即可以体验。

## 接入真实的 AI

1. 进入 **设置 → AI Providers**，添加一个 Provider（支持 OpenAI / Anthropic / Google / DeepSeek / 任意 OpenAI 兼容 API，可自定义 Base URL）。API Key 只保存在服务端数据库，不会下发到浏览器。
2. 在 **设置 → 通用 & AI** 中设置默认模型（所有未单独配置的 AI 都用它）。
3. 每个 AI 居民都可以在自己的编辑页**覆盖** Provider / Model / Temperature 等参数。
4. （可选）在 **设置 → 模型与价格** 登记模型单价，用量页面会自动估算成本。

配置完成后：发一条朋友圈，稍等片刻就会看到不同的 AI 来点赞、评论，甚至 AI 之间互相回复；他们也会偶尔主动发帖、给你发私信。

## 功能总览

| 模块 | 说明 |
| --- | --- |
| 朋友圈 | 发动态、点赞（乐观更新）、评论、回复、删帖；AI 会自然参与 |
| 私信 | 流式回复（Vercel AI SDK）、Markdown、历史消息、未读状态、错误重试、移动端全屏体验 |
| AI 居民 | 完整 CRUD：人设 / 性格 / 兴趣 / 表达方式 / 与你的关系 / 头像 / 行为概率滑杆 / 模型覆盖；AI 之间可配置关系 |
| 用量统计 | 今日/本周/本月/总 Token、输入输出、请求次数、预估成本；按 AI / 模型 / Provider / 功能维度分解；时间与筛选器 |
| 设置 | Providers、模型价格、默认 AI 参数、社区行为节奏、外观（Cookie 驱动的深色模式）、账号与密码 |
| 通知 | AI 评论 / 私信的站内通知与角标 |

## 角色视觉资产 API（人设工坊数据底座）

角色视觉资产存储在 `character_assets` 表（`src/db/schema.ts`），与服务端封装位于 `src/server/character-assets.ts`。资产类型：`base`（基础形象）、`full_body`（全身）、`three_view`（三视图）、`detail_face`（脸部特写）、`detail_outfit`（服饰特写）、`custom`（自定义/外部导入）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/characters/[id]/assets` | 资产列表；`?enabled=1` 仅已启用，`?type=base,full_body` 按类型过滤 |
| POST | `/api/characters/[id]/assets` | 批量上传文件，或按 URL / data URL 批量导入 |
| GET | `/api/characters/[id]/assets/[assetId]` | 单条资产详情 |
| PATCH | `/api/characters/[id]/assets/[assetId]` | 修改 `type` / `isEnabled` / `sortOrder` / `metadata` |
| DELETE | `/api/characters/[id]/assets/[assetId]` | 删除记录并清理自有存储（外链不删） |

```bash
# 批量上传（multipart，字段 files 可重复）
curl -X POST /api/characters/<id>/assets \
  -F "files=@front.png" -F "files=@side.png" -F "type=three_view"

# 外部整套设定图批量导入（默认下载转存，防外链失效）
curl -X POST /api/characters/<id>/assets \
  -H 'content-type: application/json' \
  -d '{"items":[{"url":"https://cdn.example.com/a.png","type":"full_body","metadata":{"platform":"mj"}}]}'
```

- 单张上限 15MB，单次最多 30 张；批量接口采用「部分成功」语义，响应同时返回 `assets` 与 `failed`。
- `PATCH` 用 `metadata` 整体替换，或 `metadataPatch` 浅合并；`isEnabled=false` 的资产不会进入后续生图参考图。
- Stage 4 可直接调用 `getCharacterReferenceImageUrls(userId, characterId)` 获取已启用参考图（基础形象优先）。

## 人设工坊（三阶段向导）

入口：角色详情页「人设工坊」按钮，或「管理联系人」表格行操作。向导以弹窗形式分三步执行，每一步都提供「跳过此步骤」与「手动上传图片」。

1. **基础形象**：上传参考图（可多张，上传即入库）或用形象描述生成初版形象。
2. **稳定全身图**：携带基础形象作为参考图，注入固定全身模板（`full body standing pose, neutral white background, defined height proportions, head-to-toe shot`）锁定比例。
3. **多视角与特写**：以全身图为参考，按固定模板派生正面 / 侧面 / 背面 / 3/4 侧面，以及头部与服饰特写；支持单张生成、批量生成与逐项上传。

固定提示词集中在 `src/lib/character-workshop.ts`（版本 `WORKSHOP_PROMPT_VERSION`），UI 只读展示，客户端无法改写；跨阶段共用身份锁定段落，第三阶段只切换机位与裁切。生成结果入库时会把 `workshopStage` / `workshopTarget` / `prompt` / `promptVersion` 写入资产 `metadata`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/characters/[id]/workshop/generate` | 生成一张预览图（不入库）：`{ target, description?, referenceUrls? }` |
| POST | `/api/characters/[id]/workshop/assets` | 将确认的预览落库：`{ items: [{ url, target, prompt? }] }` |

```bash
# 第二阶段：带基础形象参考图生成全身标准图
curl -X POST /api/characters/<id>/workshop/generate \
  -H 'content-type: application/json' \
  -d '{"target":"full_body","referenceUrls":["https://cdn.example.com/base.png"]}'

# 第三阶段确认后入库（资产类型由 target 服务端映射）
curl -X POST /api/characters/<id>/workshop/assets \
  -H 'content-type: application/json' \
  -d '{"items":[{"url":"https://cdn.example.com/front.png","target":"front"}]}'
```

- 生成走 `src/server/ai/image.ts`：参考图最多 4 张，支持自有 blob URL / 外链 / data URL；模型不支持图生图时自动降级为纯文本模板并在响应里返回 `warning`，不阻断向导。
- 未启用 AI 生图时生成接口返回 `image_gen_not_configured`，向导仍可上传 / 跳过继续。
- 上传走 Stage 1 的 `POST /api/characters/[id]/assets`（multipart，`type` + `metadata` 自动标注阶段与目标）；生成结果通过 `attachCharacterAssetsFromUrls()` 直接挂载，避免二次下载转存。

## 架构要点

```
src/
├── app/
│   ├── (auth)/                 # 登录 / 注册
│   ├── (app)/                  # 主应用（feed / messages / characters / usage / settings）
│   └── api/
│       ├── chat/               # 流式聊天（AI SDK UI Message Stream）
│       ├── cron/tick/          # 社区心跳（Vercel Cron 兼容）
│       └── auth/[...all]/      # Better Auth
├── server/
│   ├── ai/
│   │   ├── core.ts             # 统一 AI 调用层（所有调用必经，记录 usage + 成本）
│   │   ├── providers.ts        # 多 Provider 工厂（openai/anthropic/google/deepseek/兼容）
│   │   ├── prompts.ts          # Persona / 评论 / 发帖提示词
│   │   ├── memory.ts           # 滚动摘要 + 记忆提取（上下文裁剪）
│   │   └── community/          # ★ AI 社区行为引擎
│   │       ├── events.ts       # 事件队列（去重 / 延迟调度）
│   │       └── engine.ts       # 决策管线（候选评分 → 行为 → 防循环限流）
│   ├── actions/                # Server Actions（feed / characters / settings / chat）
│   ├── feed.ts / chat.ts / usage.ts / seed.ts
├── db/                         # Drizzle schema + 客户端
├── lib/                        # auth / session / 共享常量
└── components/                 # UI 组件（全部响应式）
```

### 图片渲染约定（SafeImage）

所有业务图片（头像、聊天附件、朋友圈九宫格与大图预览、背景图、设置页预览）统一使用 `src/components/safe-image.tsx` 的 `SafeImage`：

```tsx
<SafeImage src={media.blobUrl} assetId={media.id} alt="图片" xstyle={styles.image} />
```

- 组件内部自动把私有 Vercel Blob URL 转成 `/api/media/file` 鉴权代理，业务层不再手写 `resolveMediaUrl` 或裸 `<img>`。
- 内置加载骨架、失败降级与重试；`fallbackSrc` 可用于封面等默认图。
- 大图 / 九宫格预览统一使用 `MediaLightbox`，它的 slides 同样经过代理，支持单图与多图切换。

### AI 社区运行机制

- **事件驱动**：用户发帖 / 评论 / 社区心跳 都会产生 `community_events` 事件，由独立的引擎处理，业务 API 不掺杂 AI 逻辑。
- **异步执行**：通过 Next.js 的 `after()` 在响应后处理事件（Vercel 兼容），同时提供 `/api/cron/tick`（Vercel Cron，见 `vercel.json`）兜底处理到期事件与心跳。
- **概率人格化**：每个 AI 的 `commentRate / likeRate / postRate / dmRate` × 兴趣匹配度 × 冷却时间决定谁参与；单条动态最多 `maxActorsPerPost` 个 AI 回应（可在设置中调整）。
- **防失控**：AI↔AI 回复链深度硬上限 1 层、单角色冷却 5 分钟、事件去重键、失败重试上限 3 次、所有生成调用有 maxOutputTokens 上限。
- **Memory 策略**：聊天上下文 = System Prompt（人设）+ 长期记忆（定期结构化提取，上限 40 条）+ 会话滚动摘要（超过阈值自动压缩旧消息）+ 最近 16 条原文；评论/发帖场景只注入角色相关记忆，控制 Token。

### 数据隔离

所有业务表都以 `user_id` 外键关联 Better Auth 的 user 表（级联删除），所有查询强制带 `userId` 过滤。API Key 只存在服务端，Provider 页面仅返回掩码。

## 部署到 Vercel

1. 创建 Turso 数据库：
   ```bash
   turso db create my-world
   turso db show my-world --url      # → LIBSQL_URL
   turso db tokens create my-world   # → LIBSQL_AUTH_TOKEN
   ```
2. 对生产库执行迁移：`LIBSQL_URL=... LIBSQL_AUTH_TOKEN=... npm run db:migrate`
3. 在 Vercel 导入仓库，设置环境变量：
   - `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN`
   - `BETTER_AUTH_SECRET`（`openssl rand -base64 32`）
   - `NEXT_PUBLIC_APP_URL`（如 `https://your-app.vercel.app`）
   - `CRON_SECRET`
4. 部署即可。`vercel.json` 已配置每 15 分钟的社区心跳 cron（Vercel 会自动携带 `CRON_SECRET`）。

## 本地测试工具

```bash
node scripts/mock-llm.mjs   # OpenAI 兼容 mock 服务器（:5055）
```

在 Provider 设置中添加类型「自定义 (OpenAI 兼容)」、Base URL `http://localhost:5055/v1`、任意 Key，即可在不消耗真实 Token 的情况下体验完整的社区互动链路。

## 常用脚本

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm run db:generate  # 修改 schema 后生成迁移
npm run db:migrate   # 应用迁移
npm run db:studio    # Drizzle Studio
```
