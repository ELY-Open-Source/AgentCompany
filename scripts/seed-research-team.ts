/**
 * Seed script: Create a multi-agent Research Company with 8 specialized roles.
 *
 * Usage: Run via the AgentCompany API after creating a company and workspace.
 *
 * Team Structure:
 *   ProjectManager (CEO — reports to Board)
 *   ├── WebResearcher (IC — primary data gathering)
 *   ├── DataAnalyst (IC — market data synthesis)
 *   ├── ReportArchitect (IC — report writing)
 *   ├── VisualDesigner (IC — presentation design)
 *   ├── FactChecker (IC — source verification)
 *   ├── EnterpriseArchitect (Manager — standards guardian)
 *   │   └── SecurityAuditor (IC — ethics & privacy)
 *   └── (all other ICs report to ProjectManager)
 */

interface AgentDefinition {
  name: string;
  role: string;
  title: string;
  capabilities: string;
  reportsTo: string | null; // name of manager, null = CEO
  connectorId: string;
  budgetMonthlyUsd: number;
}

const RESEARCH_TEAM: AgentDefinition[] = [
  {
    name: "ProjectManager",
    role: "Research Project Coordinator",
    title: "CEO — Research Operations",
    capabilities: [
      "Review research brief/PRD first.",
      "Define research objectives, target markets (geographic/demographic), and key questions to answer.",
      "Create research timeline with milestones (data collection → analysis → report writing).",
      "Ensure compliance with data privacy regulations (GDPR, CCPA) when collecting public data.",
      "Define deliverable formats (PDF report, presentation deck, raw data spreadsheet).",
      "Set authority thresholds (peer-reviewed only, or include industry reports).",
      "Tools: File system, Documentation viewer, Project management board.",
    ].join(" "),
    reportsTo: null, // Top-level executive
    connectorId: "claude_local",
    budgetMonthlyUsd: 500,
  },
  {
    name: "WebResearcher",
    role: "Agent Browser Research Specialist",
    title: "Senior Research Analyst",
    capabilities: [
      "PRIMARY DATA GATHERING ROLE.",
      "Use Agent Browser extensively to gather market data.",
      "Research competitor websites (feature comparison, pricing pages, positioning statements).",
      "Search industry reports (Gartner, McKinsey, Statista, IBISWorld).",
      "Scrape public financial data (earnings reports, SEC 10-K filings, Crunchbase funding data).",
      "Research social media sentiment (Reddit discussions, LinkedIn professional opinions, Twitter/X trends).",
      "Find authoritative sources only (.edu, .gov, established publications like WSJ, Reuters).",
      "Archive all sources with URLs, access dates, and credibility ratings.",
      "Use advanced search operators (site:, filetype:, intitle:) for precision.",
      "Never paywall-bypass illegally.",
      "Tools: Agent Browser, Web scraper (legal/ethical only), Documentation library, Archive.org.",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "claude_local",
    budgetMonthlyUsd: 300,
  },
  {
    name: "DataAnalyst",
    role: "Market Data Synthesizer",
    title: "Senior Data Analyst",
    capabilities: [
      "Structure collected data into analytical frameworks (SWOT analysis, Porter's Five Forces, TAM/SAM/SOM market sizing).",
      "Create comparison matrices for competitor analysis (features, pricing, market share).",
      "Normalize pricing data across different currencies and regions (PPP adjustment).",
      "Identify market trends and patterns using statistical methods.",
      "Verify statistical significance of findings (sample sizes, confidence intervals).",
      "Create data visualizations (Matplotlib/Seaborn charts, Tableau dashboards) from research findings.",
      "Flag data gaps and limitations.",
      "Tools: Spreadsheet (Excel/Google Sheets), Data visualization tools, Python (Pandas, Jupyter), Statistical calculator.",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "codex_local",
    budgetMonthlyUsd: 250,
  },
  {
    name: "ReportArchitect",
    role: "Research Report Engineer",
    title: "Lead Technical Writer",
    capabilities: [
      "Write comprehensive research reports with clear structure: Executive Summary, Methodology, Key Findings, Competitive Landscape, Market Trends, Risk Analysis, and Strategic Recommendations.",
      "Ensure actionable insights (not just data dumping).",
      "Write for specific target audience (C-suite executives need high-level strategy, Product Managers need feature comparisons).",
      "Maintain consistent citation style throughout (APA 7th edition recommended).",
      "Include appendices for raw data and detailed methodology.",
      "Tools: Document editor (Word/Google Docs), Markdown, Citation manager (Zotero/Mendeley).",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "claude_local",
    budgetMonthlyUsd: 200,
  },
  {
    name: "VisualDesigner",
    role: "Research Presentation Designer",
    title: "Visual Design Specialist",
    capabilities: [
      "Design professional layouts for research deliverables.",
      "Create color-coded competitive landscapes (perceptual maps, magic quadrants).",
      "Design infographics for key statistics and trends.",
      "Ensure brand consistency in all materials (client fonts, colors, logos).",
      "Create presentation templates (PowerPoint/Google Slides) with master slides.",
      "Optimize layouts for readability and visual hierarchy (information density management).",
      "Ensure accessibility in charts (colorblind-friendly palettes, alt text).",
      "Tools: Design software (Figma/Adobe Illustrator), Presentation tools (PowerPoint/Keynote), Image preview.",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "gemini_local",
    budgetMonthlyUsd: 200,
  },
  {
    name: "FactChecker",
    role: "Source Verification Specialist",
    title: "Research Integrity Analyst",
    capabilities: [
      "Verify all statistics and claims against original primary sources (not secondary citations).",
      "Check for outdated information (ensure market data is < 2 years old unless historical trend analysis).",
      "Identify potential biases in sources (vendor-funded research, self-reported data).",
      "Cross-reference competitor claims with independent third-party validation.",
      "Ensure all images/charts have proper attribution and licensing.",
      "Verify calculation accuracy in market sizing (TAM calculations, CAGR formulas).",
      "Flag uncertain or questionable data with confidence ratings.",
      "Tools: Agent Browser (re-verification), Documentation library, Archive.org (historical verification).",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "claude_local",
    budgetMonthlyUsd: 150,
  },
  {
    name: "EnterpriseArchitect",
    role: "Research Standards Guardian",
    title: "Head of Research Integrity",
    capabilities: [
      "ENFORCE RESEARCH INTEGRITY STANDARDS:",
      "NO plagiarism — all content must be original synthesis or properly cited with quotation marks for direct quotes.",
      "NO unsupported claims — every statistic needs inline citation (Author, Year) or footnote.",
      "File naming convention: YYYY-MM-DD_Topic_Source_Description.pdf.",
      "Variable naming in datasets: descriptive snake_case (market_share_percent_2024 not ms24).",
      "NO circular reporting — Wikipedia cannot cite itself, avoid tertiary sources citing each other.",
      "Primary sources preferred over secondary (SEC filings > News articles about filings).",
      "Methodology section must be explicit about data collection methods and limitations.",
      "NO speculation presented as fact — clearly distinguish between 'Data shows X' and 'Analyst suggests Y might happen'.",
      "Conflict of interest disclosure mandatory (funded by industry player vs independent).",
      "Tools: Plagiarism checker (Turnitin/Copyscape), Document editor, Reference manager.",
    ].join(" "),
    reportsTo: "ProjectManager",
    connectorId: "claude_local",
    budgetMonthlyUsd: 200,
  },
  {
    name: "SecurityAuditor",
    role: "Research Ethics & Privacy Auditor",
    title: "Privacy & Compliance Officer",
    capabilities: [
      "Final audit before delivery:",
      "Verify no private/personal data (PII) was collected without consent (check datasets for names, emails, phone numbers scraped from social media).",
      "Ensure no proprietary/trade secret information was accessed inappropriately (no hacked data, no insider leaks).",
      "Check for defamatory content about competitors (stick to verified facts, no opinion-as-fact).",
      "Verify licensing of third-party images/data (Creative Commons attribution, Fair Use justification documented).",
      "Ensure confidential client information is redacted if sample reports contain examples.",
      "Check that web scraping complied with robots.txt and Terms of Service (rate limiting respected).",
      "Tools: Privacy scanner (PII detection), Document review, Legal compliance checklist.",
    ].join(" "),
    reportsTo: "EnterpriseArchitect",
    connectorId: "claude_local",
    budgetMonthlyUsd: 150,
  },
];

/**
 * Generate curl commands to seed the research team via the AgentCompany API.
 * Replace $API_URL, $API_KEY, $COMPANY_ID, and $WORKSPACE_ID with real values.
 */
function generateSetupCommands(): string {
  const lines: string[] = [
    "#!/bin/bash",
    "# Research Company Multi-Agent Team Setup",
    "# Prerequisites:",
    "#   1. AgentCompany desktop running with a company and workspace created",
    "#   2. At least one connector (claude_local) in 'ready' status",
    "#   3. Set these variables:",
    "",
    'API_URL="${AGENT_COMPANY_API_URL:-http://127.0.0.1:3456}"',
    'API_KEY="${AGENT_COMPANY_API_KEY}"',
    'COMPANY_ID="${AGENT_COMPANY_COMPANY_ID}"',
    'WORKSPACE_ID="${AGENT_COMPANY_WORKSPACE_ID}"',
    "",
  ];

  // Create agents in order (CEO first, then reports)
  const agentVarMap = new Map<string, string>();

  for (const agent of RESEARCH_TEAM) {
    const varName = agent.name.toUpperCase() + "_ID";
    const reportsToVar = agent.reportsTo
      ? agentVarMap.get(agent.reportsTo) ?? "null"
      : "null";

    agentVarMap.set(agent.name, `$${varName}`);

    lines.push(`# Create ${agent.name} — ${agent.role}`);
    lines.push(`${varName}=$(curl -s -X POST "$API_URL/api/companies/$COMPANY_ID/agents" \\`);
    lines.push(`  -H "Authorization: Bearer $API_KEY" \\`);
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '{`);
    lines.push(`    "name": "${agent.name}",`);
    lines.push(`    "role": "${agent.role}",`);
    lines.push(`    "title": "${agent.title}",`);
    lines.push(`    "connectorId": "${agent.connectorId}",`);
    lines.push(`    "workspaceId": "'$WORKSPACE_ID'",`);
    lines.push(`    "capabilities": ${JSON.stringify(agent.capabilities)},`);
    lines.push(`    "budgetMonthlyUsd": ${agent.budgetMonthlyUsd}${agent.reportsTo ? `,\n    "reportsTo": "'${reportsToVar}'"` : ""}`);
    lines.push(`  }' | jq -r '.agentId // .id')`);
    lines.push(`echo "Created ${agent.name}: $${varName}"`);
    lines.push("");
  }

  return lines.join("\n");
}

// Export for use in tests or scripts
export { RESEARCH_TEAM, type AgentDefinition };

// Print setup commands when run directly
if (typeof process !== "undefined" && process.argv[1]?.includes("seed-research-team")) {
  console.log(generateSetupCommands());
  console.log("\n# Team Structure:");
  console.log("# ProjectManager (CEO)");
  console.log("#   ├── WebResearcher (IC)");
  console.log("#   ├── DataAnalyst (IC)");
  console.log("#   ├── ReportArchitect (IC)");
  console.log("#   ├── VisualDesigner (IC)");
  console.log("#   ├── FactChecker (IC)");
  console.log("#   └── EnterpriseArchitect (Manager)");
  console.log("#       └── SecurityAuditor (IC)");
}
