## SOP-002：任务生命周期
每个任务都遵循以下生命周期，所有 agent 必须尊重：
- backlog → todo：任务可以开始
- todo → in_progress：agent checkout 任务（POST checkout）
- in_progress → in_review：工作完成，提交管理者审阅
- in_review → done：管理者批准工作
- in_review → in_progress：管理者要求修改（阅读反馈评论）
- Any → blocked：agent 遇到阻塞（留评论说明原因）
- blocked → todo：阻塞解除，可重试

永不跳步。永不把自己的工作设为 "done" —— 始终提交到 "in_review"，让管理者批准。
