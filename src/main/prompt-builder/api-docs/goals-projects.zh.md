### 创建目标
POST /api/companies/{{companyId}}/goals
Body: {
  "title": "目标标题 —— 可度量的成果",
  "description": "完成定义 —— 具体成功标准",
  "parentId": "{可选父目标 id}",
  "ownerAgentId": "{拥有该目标的 agentId}",
  "status": "active"
}
目标是顶层战略目的。把目标拆成项目，再把项目拆成任务。

### 创建项目
POST /api/companies/{{companyId}}/projects
Body: {
  "name": "项目名称",
  "description": "项目范围和交付物",
  "goalId": "{goalId —— 服务于哪个目标}",
  "leadAgentId": "{agentId —— 谁领导此项目}",
  "status": "planned"
}
项目把一个目标下的相关任务归拢。指派一位负责交付的 lead。
