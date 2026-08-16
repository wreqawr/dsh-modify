# @deepseek-ai/dsh-client-banma-skills-workbench

[English](README.md) | 中文

斑马 · Skills 工作台 UI（浏览器半区）：将左侧栏（`sidebar` 槽位）替换为 skill 目录与已激活 skill 的系统提示词，将右侧详情列（`details` 槽位）替换为实时的 skill 执行轨迹。

## 左栏：斑马 · Skills 工作台

`sidebar` 占用者渲染两个可折叠区块（面板头部显示当前会话短 id 与工作区名）：

- **激活 Skills 系统提示词** —— 本会话通过模型侧 `skill` 工具加载过的每个 skill（按首次加载顺序），附其渲染后的指令全文（即 DSH 注入给模型的系统提示词）。
- **可用 Skills（当前工作空间）** —— 当前会话项目按序编号的 `skill.list` 目录（`name` / `description` / `whenToUse` / `modelInvocable`），cwd 由 host 从会话头解析。行可展开：已激活的 skill 显示指令全文，否则显示 `whenToUse` 或加载提示。`modelInvocable: false` 的条目带 `user-only` 标签。

列折叠时面板渲染紧凑竖排 rail，带展开按钮。

## 右栏：Skills 执行轨迹

`details` 占用者将会话的每次工具执行渲染为按时间排序的轨迹 —— `skill` 加载器带 `SKILL` 徽标，其他调用带 `TOOL` 徽标，并标注执行时处于激活状态的 skill，另附调用时间、截断的参数、运行中/成功/失败状态与失败信息。过滤支持全部 / 仅 Skill 加载 / 仅工具。会话切换时面板会自动重新打开详情列。

## 数据流

两个面板共读一个工作台 store（`createSnapshotStore`），经注册时的 inject `hooks` 舱以 `useSkillsWorkbench` 暴露。`WorkbenchController`（apply 层）拥有全部订阅：通过 `ctx.sessions.list` 跟踪当前会话、绑定该会话的会话面（`SessionBinding.session`，即 `ObservableSnapshot<ConversationSnapshot>`），并在会话切换时及每 15 秒（host 不转发 `skills/change` 事件）通过只读的 connection `skill.list` RPC 拉取目录。轨迹本身是会话快照中 `tool-call` 聊天节点的纯投影（`deriveTrace`）——无 host 监听、无需轮询、可重放稳定。

浏览器插件体仅导出 `apply` / `inject`；controller、轨迹投影与组件均在 `src/client` 子路径内部。

## 模型体验

本包仅浏览器展示：只读会话对话快照与 `skill.list` RPC，不触及模型请求，也不改动会话日志。无模型 token、无 KV 缓存影响。

## 已知限制与后续工作

- **未加载过的 skill 拿不到指令全文** —— `skill.list` RPC 仅暴露 `{name, description, whenToUse, modelInvocable}`；完整指令内容需模型加载后才出现在对话记录中。加载前，展开的目录行显示 `whenToUse` 或提示。
- **侧栏会替换工作区浏览器** —— 注册进单槽位 `sidebar` 会遮蔽自带的工作区/会话浏览区及其设置栏；`details` 同理遮蔽工具详情面板。移除 `packages/bundle/web-app/cordis.patch.yml` 中的 `banma-skills-workbench` 行即可恢复自带列。
- **轨迹行仅在调用仍在运行时窗口内时可见** —— 轨迹投影自聊天节点，历史分页若逐出某次调用，该行会从面板消失（对话记录仍保有持久化记录）。
- **尚无组件/controller 测试套件** —— `src/client/trace.ts` 有单元测试；controller 与两个面板仍缺 spec 以满足逐文件覆盖率门禁。
