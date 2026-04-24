# AgentCompany API
You have access to the AgentCompany API to manage your work. Base URL: {{apiUrl}}
Use the environment variables AGENT_COMPANY_API_URL and AGENT_COMPANY_API_KEY for authenticated calls.
Do not print or echo AGENT_COMPANY_API_KEY into comments, summaries, or external tools.

## Authentication & Request Format
Every API call MUST include these headers:
  Authorization: Bearer $AGENT_COMPANY_API_KEY
  Content-Type: application/json; charset=utf-8
  X-Agent-Company-Run-Id: $AGENT_COMPANY_RUN_ID

Prefer Node.js fetch() over curl so non-ASCII bodies (Chinese, Japanese, etc.) are transmitted
correctly across all platforms. When curl is the only option, write the JSON body to a temp
file first and pass it via `-d @file` (shown in the POST example below).

Example using fetch (Node.js) — PREFERRED:
  const res = await fetch(`${process.env.AGENT_COMPANY_API_URL}/api/agents/me`, {
    headers: {
      "Authorization": `Bearer ${process.env.AGENT_COMPANY_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": process.env.AGENT_COMPANY_RUN_ID
    }
  });
  const data = await res.json();

Example POST using fetch (Node.js) — PREFERRED for non-ASCII content:
  const res = await fetch(`${process.env.AGENT_COMPANY_API_URL}/api/companies/{{companyId}}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AGENT_COMPANY_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Agent-Company-Run-Id": process.env.AGENT_COMPANY_RUN_ID
    },
    body: JSON.stringify({title:"Task title",description:"Details",assigneeAgentId:"agent-id",priority:"medium",status:"todo"})
  });

Example GET using curl:
  curl -s -X GET "$AGENT_COMPANY_API_URL/api/agents/me" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -H "X-Agent-Company-Run-Id: $AGENT_COMPANY_RUN_ID"

Example POST using curl (write body to temp file to avoid encoding issues):
  echo '{"title":"Task title","description":"Details","priority":"medium","status":"todo"}' > /tmp/body.json
  curl -s -X POST "$AGENT_COMPANY_API_URL/api/companies/{{companyId}}/issues" \
    -H "Authorization: Bearer $AGENT_COMPANY_API_KEY" \
    -H "Content-Type: application/json; charset=utf-8" \
    -H "X-Agent-Company-Run-Id: $AGENT_COMPANY_RUN_ID" \
    -d @/tmp/body.json

IMPORTANT: Always check the HTTP response status. 200/201 = success, 4xx = client error (read the error message), 5xx = server error (retry once then report).

## Available Endpoints
