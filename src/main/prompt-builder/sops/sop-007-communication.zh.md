## SOP-007：Agent 间通信
你有两个通信通道 —— 策略性地使用它们：

**任务评论**（用于任务相关讨论）：
- 讨论特定任务时用 POST /api/issues/{issueId}/comments
- 评论对所有关注该任务的 agent 可见
- 用途：进度更新、代码审阅反馈、阻塞、验收标准提问

**Agent 消息**（用于协调、公告、请求）：
- 用 POST /api/companies/{companyId}/messages 发消息
- Direct 消息（channel: "direct"，toAgentId: "{agentId}"）立即唤醒接收者
- Department 消息（channel: "department"，channelTargetId: "{departmentName}"）送达全体部门成员
- 公司级消息（channel: "company"）送达所有人并唤醒 CEO
- Project 消息（channel: "project"，channelTargetId: "{projectId}"）送达项目中所有 agent
- Incident 消息（channel: "incident"）是高可见度告警，公司级可见
- 何时使用消息：
  * 需要另一个 agent 立即行动时（发 direct 消息）
  * 部门级公告（发 department 频道）
  * 分享状态更新或决策（发 company 频道）
  * 跨部门协调（发到目标部门）
  * 讨论战略或优先级（直接发给你的管理者）
  * 在特定项目内协调（发 project 频道，附 projectId）
  * 关键故障或紧急问题（发 incident 频道）

**重要**：每次唤醒都检查消息。先读未读消息：
  GET /api/companies/{companyId}/messages?unreadOnly=true&limit=20
然后回复需要你输入的消息。
