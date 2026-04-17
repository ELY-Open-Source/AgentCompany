import type { WakeReason, WakeReasonEntry, WakeReasonVars } from "./en";

export const WAKE_REASONS_ZH: Record<WakeReason, WakeReasonEntry> = {
  timer: {
    title: "常规心跳签到，这是你的周期性唤醒。",
    steps: () => [
      "调用 GET /api/agents/me/standup 获取完整简报",
      "检查你所有分配到的任务及其状态",
      "按优先级处理：审阅 > 解除阻塞 > 新工作",
      "若无事可做，在当前任务上留一条简短状态更新",
    ],
  },
  manual: {
    title: "你被人类操作员（Board）手动触发。",
    steps: () => [
      "检查你分配到的任务是否有新的任务或更新指令",
      "检查你的消息是否有直接沟通",
      "优先执行所有待办工作 —— Board 正在关注",
    ],
  },
  assignment: {
    title: "你被分配到一个新任务。",
    steps: (v: WakeReasonVars) => [
      `GET /api/companies/${v.companyId}/issues?assigneeAgentId=${v.agentId}&status=todo 查找新分配的任务`,
      "查看任务标题、描述以及所有现有评论",
      "POST /api/issues/{issueId}/checkout 认领该任务",
      "根据你的操作手册立即开始工作",
    ],
  },
  goal_activated: {
    title: "你拥有的一个目标已被激活。",
    steps: (v: WakeReasonVars) => [
      `GET /api/companies/${v.companyId}/goals 查找新激活的目标`,
      `将目标拆分为项目（POST /api/companies/${v.companyId}/projects）`,
      "将项目拆分为可执行任务并分配给你的团队",
      "在每个任务上留一条规划评论，说明执行思路",
    ],
  },
  approval_resolved: {
    title: "你提交的一项审批已有结果。",
    steps: (v: WakeReasonVars) => [
      `GET /api/companies/${v.companyId}/approvals?requestedByAgentId=${v.agentId} 查看结果`,
      "若 APPROVED（已批准）：继续执行等待中的操作（招聘、凭据获取等）",
      "若 DENIED（已拒绝）或 REVISION_REQUESTED（需修订）：阅读反馈，调整方案，必要时重新提交",
      "更新对应任务的进展",
    ],
  },
  subtask_completed: {
    title: "你委派的子任务已完成或进入审阅阶段。",
    steps: () => [
      '检查下属提交的 "in_review" 状态任务',
      "阅读完成子任务上的所有评论（GET /api/issues/{issueId}/comments）",
      "根据你设定的验收标准评估工作质量",
      '若合格：PATCH /api/issues/{issueId}，状态设为 "done"，附上批准评论',
      '若需修改：PATCH /api/issues/{issueId}，状态设为 "in_progress"，附上具体反馈',
      "检查父任务是否可以推进",
    ],
  },
  comment: {
    title: "你的一个任务有新评论。",
    steps: () => [
      "查看上方简报中的最新评论",
      "若有人提问：通过 POST /api/issues/{issueId}/comments 回复",
      "若管理者留下反馈：处理并更新任务",
      "若是合作者的状态更新：确认收到并视情况调整工作",
    ],
  },
  report_blocked: {
    title: "你的一个下属被阻塞，需要你的帮助。",
    steps: (v: WakeReasonVars) => [
      `GET /api/companies/${v.companyId}/issues?status=blocked 查找下属的阻塞任务`,
      "阅读阻塞评论，理解他们的需求",
      `采取行动解除阻塞：
   - 若他们需要凭据：通过 POST /api/companies/${v.companyId}/approvals 创建 secret_access 审批
   - 若需要跨部门协助：向相关部门负责人发送消息
   - 若需要澄清：留评论给出明确方向`,
      '解除阻塞后，唤醒对应 agent：POST /api/agents/{agentId}/wake，reason 设为 "blocker resolved"',
    ],
  },
  report_failed: {
    title: "你下属的一次执行失败。",
    steps: () => [
      "检查下属任务中失败或停滞的项目",
      "调查：阅读任务评论和错误信息",
      `决定后续步骤：
   - 若需重试：将状态改回 "todo"，附评论说明如何调整
   - 若需重新分配：将 assigneeAgentId 改为另一名胜任的下属
   - 若任务不再需要：状态设为 "cancelled"，附说明`,
      "唤醒对应 agent 执行",
    ],
  },
  message: {
    title: "你收到另一个 agent 的直接消息。",
    steps: (v: WakeReasonVars) => [
      `GET /api/companies/${v.companyId}/messages?unreadOnly=true 读取新消息`,
      "阅读每条消息，理解对方需求",
      `使用 API 返回的发送者和消息 ID 回复每条消息：
   - 对于直接消息，POST /api/companies/${v.companyId}/messages，channel="direct"，toAgentId 设为原消息的 fromAgentId，parentMessageId 设为该消息的 id
   - 若发送者是 Board，toAgentId 为 "__board__"`,
      `标记消息为已读：POST /api/companies/${v.companyId}/messages/{messageId}/read`,
      "若消息要求你对某任务采取行动，请照做",
    ],
  },
  peer_request: {
    title: "一位同级 agent 需要你的关注。",
    steps: (v: WakeReasonVars) => [
      `查看消息：GET /api/companies/${v.companyId}/messages?unreadOnly=true`,
      "检查是否有来自常规汇报线之外的新任务分配",
      "使用 API 返回的 fromAgentId 和消息 id 回复对方的请求",
      "若需要跨部门协作，通过消息和任务进行协调",
    ],
  },
};

export const FALLBACK_ZH = (reason: string): string =>
  `触发来源：${reason}\n需要执行的操作：查阅上方简报和消息，了解此次唤醒的上下文。`;

export const ACTION_REQUIRED_ZH = "需要执行的操作：";
