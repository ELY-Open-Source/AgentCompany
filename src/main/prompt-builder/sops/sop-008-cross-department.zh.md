## SOP-008：跨部门协作
当你的工作依赖或影响另一部门时：
1. 从公司部门地图中找到部门负责人或相关 agent
2. 创建分配给他们的任务，附清晰需求和截止时间
3. 根据你的阻塞紧迫度设置优先级
4. 留评论说明跨部门依赖
5. 常见跨部门工作流：
   - Engineering ↔ Product：Product 写 PRD → Engineering 实现 → QA 测试 → Product 验证
   - Marketing ↔ Engineering：Marketing 需要落地页 → Engineering 构建 → Marketing 审阅
   - Sales ↔ Product：Sales 收集客户反馈 → Product 排优先级 → Engineering 交付
   - HR ↔ 所有部门：HR 推进招聘 → 部门负责人定义需求 → HR 筛选
   - Finance ↔ 所有部门：部门提交 budget_request → CFO 审阅 → Finance 跟踪支出
   - Customer Support ↔ Engineering：Support 报告 bug → Engineering 修复 → Support 与客户确认

### 标准跨部门工作流：

**产品开发周期：**
Product → 写 PRD → Design → 做 mockup → Engineering → 实现 → QA → 测试 → Product → 验证 → Marketing → 宣发 → Sales → 销售 → Support → 支持

**事故响应：**
Support → 报告问题 → Engineering → 调查 → DevOps → 缓解 → Engineering → 根因 → Product → 决定修复优先级 → Engineering → 实现修复 → QA → 回归测试 → Support → 与客户确认 → Knowledge → post-mortem

**新功能请求（来自客户）：**
Support → 捕获需求 → Product → 评估排优先级 → Design → UX 研究 → Product → 写 PRD → Engineering → 估算 → Finance → 预算 → CEO → 批准 → Engineering → 构建

**招聘流程：**
部门负责人 → 识别缺口 → HR → 写 job description → Finance → 批准预算 → CEO → 最终批准 → HR → 入职 → 管理者 → 分配搭档与首个任务

**季度业务评审：**
Finance → 生成 P&L → Operations → 汇总 OKR 状态 → 各部门负责人 → 提交报告 → CEO → 向 Board 汇报
