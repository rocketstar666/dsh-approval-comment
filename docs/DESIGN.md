# 设计文档：dsh-approval-comment

## 1. 目标与形态

替换 DSH Web 内置审批窗口，实现带「say some 附言」的四象限审批语义：

| | 允许一次 | 拒绝 |
|---|---|---|
| **无附言** | 继续执行 | 中断任务（停止，等待下一条指令） |
| **有附言** | 附言一并生效并继续，**一次审批完成** | 据附言调整并**自动继续**（不停止），**一次审批完成** |

形态：独立 dsh bundle 插件（host + client 双半区），装进 `$DSH_HOME/profiles/web`，核心升级不覆盖，可经 GitHub Release / 文件夹 / git 分发。

## 2. 架构总览

```
                     ┌──────────────────────────── host ─────────────────────────────┐
审批请求 ──► approval/request 前置监听(prepend)
               │  grantNext 命中？→ 直接 allowed-once（一次性放行，不弹窗）
               │  否则 next() ──► 内置 web 应答器（展示审批 UI，等用户决定）
               │  outcome 返回后：
               │    · rejected/cancelled → rejected.add(agent.id)
               │    · 有附言（agent.inbox.hasPending）→ grantNext.add(agent.id)
               └────────────────────────────────────────────────────────────────────┘

工具结果 = "the user rejected tool X"（仅拒绝时）→ loop 提议续步
                     ┌──────────────────────────────────────────────────────────────┐
agent/pre-step 守卫：rejected.has(agent.id)?
   ├─ 本步 messages 含 user 消息（附言已 steer 进来）→ 放行：模型据附言调整并自动继续
   └─ 无附言 → { kind: 'reject' } 终止当前回合（停止等待）
                     └──────────────────────────────────────────────────────────────┘

                     ┌────────────────────────── client ────────────────────────────┐
conversation.composer 链 priority:0（内置面板 priority:1）→ 本插件面板胜出（无感替代）
  UI：警示条 + 工具名 + 附言 textarea + [拒绝][允许一次]
  submit(outcome)：附言非空 → session.prompt([{type:text,text}], 'steer')（失败回退 queue）
                    → pending.respond({ok:true, value:{sessionId, approvalId, outcome}})
                     └──────────────────────────────────────────────────────────────┘
```

**grant-next（一次性放行，回合作用域）**：用户附言即表达"据附言调整"意图；模型据附言重新发起的越权调用由 grant-next 自动放行一次，使整次交互**只弹一次审批窗**。授权严格限定在附言发生的**当前回合**内：`turn/end` 时清空，且离开附言调整步（下一步无 user 消息）也清空——杜绝跨回合/跨场景的误放行。

## 3. 关键契约（均已在本机核对源码）

| 契约 | 来源 |
|---|---|
| 审批结果词汇封闭：`allowed-once / rejected / cancelled / unavailable`；客户端应答 payload 仅 `{sessionId, approvalId, outcome}` | `dsh-user-approval`、`dsh-host-apiproxy/approvals` |
| 拒绝映射为工具结果文本 `the user rejected tool "<name>"`，且 `approval/asked`/`decided` 仅写审计日志不进模型上下文 | `dsh-tools` `serviceAsk` |
| `approval/request` 为 waterfall，`prepend: true` 可先于内置 web 应答器注册 | cordis `ctx.on`、`dsh-host-apiproxy` |
| `approval/policy='never'` 在应答链前短路返回 `rejected`（不受本插件影响） | `dsh-user-approval` `decide()` |
| `agent/pre-step` payload 携带 `{agent, messages, turn, step, signal}`；决策 `{kind:'reject'} / {kind:'enter', messages}` | `dsh-agent/runtime-types` |
| `agent` 有 `inbox`（`nextTurn`/`nextStep`、`hasPending`、`append/prepend`）与 `session.events` | `dsh-agent/inbox` |
| client 半区：`dsh.client{platform:'web', inject:[...]}` + `exports["./client"]`，bundle 以 `window.__ModuleLoader__.load({id, factory})` 注册，factory 返回 `{apply, inject}` | `dsh-client-modules`（node+browser） |
| `conversation.composer` 链按 priority 取首个 select 匹配者；内置 `ApprovalPanel` priority 1 | `dsh-client-web-react` `renderOutletContent`、`dsh-client-ui-conversation` |
| 客户端经 `sessions.binding(id).session.prompt(content, 'steer'|'queue')` 发送用户消息 | `dsh-client-runtime` `session.d.ts` |

## 4. host 半区（lib/index.js）

状态：`rejected`（纯拒绝集）、`grantNext`（一次性放行集）。

- `ctx.on('approval/request', handler, {prepend:true})`：
  1. 若 `grantNext.has(agent.id)` → 清除并返回 `allowed-once`（一次性放行，不弹窗）。
  2. 否则 `await next()` 委托内置应答器，观察 outcome。
  3. `rejected`/`cancelled` → `rejected.add(agent.id)`。
  4. 若 outcome 为 `allowed-once`/`rejected` 且 `agent.inbox.hasPending`（附言已 steer）→ `grantNext.add(agent.id)`。
- `ctx.on('agent/pre-step', handler)`：`await next()` 后若 `decision.kind === 'enter'` 且 agent 在 `rejected` 集内 → 清除标记；本步 `payload.messages` 含 role=`user` 消息（附言）则放行，否则 `{kind:'reject'}` 终止回合。此外，若进入非附言步（本步无 user 消息）且 `grantNext` 未消费，立即清除。
- `ctx.on('session/event', ...)`：`turn/end` 时清空该 session 的 `rejected` 与 `grantNext`——授权/拒绝状态不跨回合残留。

时序要点：
- 附言经 `session.prompt(…,'steer')` 注入 next-step，会在下一步被 claim 进 `payload.messages` → 守卫据此放行。
- 模型据附言重新发起的越权调用命中 grant-next → 自动放行，完成"一次审批"。

## 5. client 半区（lib/client.js）

- `select({interactions}) = interactions.find(i => i.kind === 'approval')`。
- `ctx.slots.register({name:'conversation.composer', select, priority:0}, Panel)` 顶替内置面板。
- 面板：警示条 + 工具名/`reason` + 附言 textarea + [拒绝][允许一次]。
- 允许/拒绝统一走 `submit(outcome)`：附言非空则先 `sessions.binding(sessionId).session.prompt([{type:'text',text}], 'steer')`（失败回退 `'queue'`），再 `pending.respond({ok:true, value:{sessionId, approvalId, outcome}})`；送达失败仍应答（决策不丢）。
- `inject: ['slots','sessions']`；`dsh.client.inject: ['@deepseek-ai/dsh-client-ui-conversation']` 保证 conversation 先 apply（slot 已声明）。

## 6. 分发

- 文件：`dsh plugin --profile web add <目录>`（pnpm link，`anchorPathSpec` 锚定相对路径）。
- GitHub Release：`npm pack` 出 `.tgz` 作为资产，`dsh plugin --profile web add <asset-url>`（pnpm 按 `.tgz` 识别 URL tarball，预构建无 prepare 脚本、无需 allowBuilds）。
- git：`dsh plugin --profile web add git+https://...`（需 allowBuilds）。
- `reconcilePlugins` 按安装后 package.json 的 `dsh.bundle.patch` 识别 bundle，与来源无关。

## 7. 验证清单

1. ✅ **允许并附言** → 附言一并生效，模型据附言自动调整，且**只弹一次审批窗**（grant-next 放行后续调整调用）。—— 已通过（写 hello → 附言 hallo → 一次审批，最终 hallo）。
2. ✅ **拒绝并附言** → 附言经 steer 注入，模型据附言调整并**自动继续**（不停止），一次审批完成。—— 已通过（写桌面 → 附言"改写到当前工作目录" → 改写工作区，未执行桌面）。
3. ✅ **拒绝（无附言）** → 当前回合终止，模型不再调用工具、不猜测。—— 已通过（写桌面被拒，回合终止，停止等待）。
4. ✅ **grant-next 回合作用域（回归）** → 场景 2 附言调整无需越权（写工作区）不消费授权，`turn/end` 清空后，场景 3 的越权正常弹窗（未误放行）。—— 已通过。
5. 拒绝/附言后手动停止 → 新请求模型仍记得（transcript 持久）。
6. 允许一次 / 纯拒绝 / 取消不回归；`policy='never'` 不触发守卫。
7. 核心升级后插件仍工作；`dsh plugin` 装/卸干净。
8. GitHub Release 远程安装到第二台设备后功能一致。

## 8. 已知边界与权衡

- **grant-next 是一次性授权，回合作用域**：只放行附言后紧接着的那一次越权调用；`turn/end` 或离开附言调整步时即作废，不会跨回合/跨场景残留。源于用户主动附言，风险可控。
- **允许+附言时原命令先执行**：审批语义是"批准本次调用"，附言无法改写已定参数，故原命令（旧参数）会先执行，模型再据附言自动修正（grant-next 放行）。若要求"完全跳过旧参数执行"，需上游支持改参数后执行。
- 审批面板标题用 `reason`（或"工具 X 请求越权执行"），内置面板的命令原文展示未复刻。
- 无审批 UI（非 web 场景）时，应答链回退 `unavailable`，行为与现状一致。

## 9. 声明

本项目代码及文档由 deepseek-v4-pro 模型生成。
