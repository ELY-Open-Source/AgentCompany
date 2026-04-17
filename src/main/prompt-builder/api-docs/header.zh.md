# AgentCompany API
你可以使用 AgentCompany API 管理你的工作。Base URL：{{apiUrl}}
请使用环境变量 AGENT_COMPANY_API_URL 和 AGENT_COMPANY_API_KEY 进行鉴权调用。
不要在评论、总结或外部工具中打印或回显 AGENT_COMPANY_API_KEY。

## 鉴权与请求格式
每个 API 调用必须包含以下请求头：
  Authorization: Bearer $AGENT_COMPANY_API_KEY
  Content-Type: application/json; charset=utf-8
  X-Agent-Company-Run-Id: {{runId}}

优先使用 Node.js fetch() 而非 curl，以便非 ASCII 请求体（中文、日文等）在所有平台正确传输。
若必须用 curl，先把 JSON body 写入临时文件，再通过 `-d @file` 传入（见下方 POST 示例）。

fetch 示例（Node.js） —— 推荐：
  const res = await fetch(`${process.env.AGENT_COMPANY_API_URL}/api/agents/me`, {
    headers: {
      "Authorization": `Bearer ${process.env.AGENT_COMPANY_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": "{{runId}}"
    }
  });
  const data = await res.json();

POST 示例（Node.js） —— 非 ASCII 内容推荐：
  const res = await fetch(`${process.env.AGENT_COMPANY_API_URL}/api/companies/{{companyId}}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AGENT_COMPANY_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": "{{runId}}"
    },
    body: JSON.stringify({title:"任务标题",description:"详细说明",assigneeAgentId:"agent-id",priority:"medium",status:"todo"})
  });

curl GET 示例：
  curl -s -X GET "$AGENT_COMPANY_API_URL/api/agents/me" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -H "X-Agent-Company-Run-Id: {{runId}}"

curl POST 示例（把 body 写入临时文件以避免编码问题）：
  echo '{"title":"任务标题","description":"详细说明","priority":"medium","status":"todo"}' > /tmp/body.json
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/{{companyId}}/issues" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -H "X-Agent-Company-Run-Id: {{runId}}" \
    -d @/tmp/body.json

重要：始终检查 HTTP 响应状态。200/201 = 成功，4xx = 客户端错误（阅读错误信息），5xx = 服务端错误（重试一次后上报）。

## 可用端点
