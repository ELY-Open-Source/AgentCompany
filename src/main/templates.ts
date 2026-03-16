import type { CompanyTemplate, DepartmentId } from "@shared/types";

/**
 * Pre-built company templates for one-click company setup.
 * Each template defines a complete organizational structure with
 * agents, goals, and role definitions.
 */
export const COMPANY_TEMPLATES: CompanyTemplate[] = [
  {
    id: "software-startup",
    name: "Software Startup",
    description: "A lean engineering team for building software products. CEO leads a CTO, a Product Lead, and a QA Lead who each manage their own specialists.",
    icon: "Cpu",
    agents: [
      {
        name: "Alex Chen",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Strategic planning, goal decomposition, team coordination, project oversight, stakeholder communication. Delegates all technical and product work to reports.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Jordan Park",
        role: "CTO",
        title: "Chief Technology Officer",
        department: "engineering",
        capabilities: "Technical architecture, code review, engineering management, infrastructure decisions, technical debt management. Manages backend and frontend engineers.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 300,
      },
      {
        name: "Sam Rivera",
        role: "Product Lead",
        title: "VP of Product",
        department: "product",
        capabilities: "Product strategy, feature prioritization, user research synthesis, requirements writing, UX review, sprint planning. Translates goals into actionable product specs.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Taylor Kim",
        role: "Senior Backend Engineer",
        title: "Senior Backend Engineer",
        department: "engineering",
        capabilities: "Backend development, API design, database optimization, server-side logic, performance tuning, microservices architecture. Expert in Node.js, Python, and Go.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Morgan Lee",
        role: "Senior Frontend Engineer",
        title: "Senior Frontend Engineer",
        department: "engineering",
        capabilities: "Frontend development, React/Next.js, UI implementation, responsive design, accessibility, frontend testing, component architecture. Pixel-perfect implementation.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Casey Quinn",
        role: "QA Engineer",
        title: "Quality Assurance Engineer",
        department: "engineering",
        capabilities: "Test planning, automated testing, bug reporting, regression testing, E2E test suites, CI/CD pipeline testing. Ensures quality before releases.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 150,
      },
    ],
    goals: [
      {
        title: "Build and ship the core product",
        description: "Design, implement, test, and deploy the initial version of the product with core features. Focus on code quality, test coverage, and a solid architecture foundation.",
      },
      {
        title: "Establish development workflows",
        description: "Set up CI/CD pipelines, code review processes, testing standards, and deployment procedures. Ensure the team can ship reliably and frequently.",
      },
    ],
  },
  {
    id: "marketing-agency",
    name: "Marketing Agency",
    description: "A digital marketing team focused on content, analytics, and growth. CEO leads a CMO who manages content creators and an analytics specialist.",
    icon: "Megaphone",
    agents: [
      {
        name: "Diana Cross",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Business strategy, client relations, campaign oversight, budget management, team coordination. Ensures all marketing efforts align with business goals.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Ryan Torres",
        role: "CMO",
        title: "Chief Marketing Officer",
        department: "marketing",
        capabilities: "Marketing strategy, campaign planning, brand management, channel optimization, growth hacking, market research, competitive analysis. Manages all marketing operations.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Mia Johnson",
        role: "Content Lead",
        title: "Senior Content Strategist",
        department: "marketing",
        capabilities: "Content strategy, copywriting, blog posts, social media content, email campaigns, SEO content, brand voice development. Creates compelling narratives that drive engagement.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Liam Foster",
        role: "Analytics Lead",
        title: "Data Analyst",
        department: "marketing",
        capabilities: "Marketing analytics, A/B testing, conversion optimization, funnel analysis, reporting dashboards, KPI tracking, audience segmentation. Data-driven decision making.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Emma Zhang",
        role: "Design Specialist",
        title: "Visual Designer",
        department: "design",
        capabilities: "Graphic design, social media visuals, brand assets, presentation design, infographics, UI mockups. Creates visually compelling marketing materials.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
    ],
    goals: [
      {
        title: "Launch comprehensive marketing campaign",
        description: "Plan and execute a multi-channel marketing campaign including content creation, social media, email marketing, and analytics tracking. Focus on measurable outcomes.",
      },
      {
        title: "Build brand presence and content library",
        description: "Create a consistent brand identity, develop a content calendar, and build a library of reusable marketing assets. Establish the brand voice across all channels.",
      },
    ],
  },
  {
    id: "research-lab",
    name: "Research Lab",
    description: "An AI research team for exploring ideas, writing papers, and building prototypes. Lead Researcher manages specialized researchers and an engineer.",
    icon: "Flask",
    agents: [
      {
        name: "Dr. Sarah Mitchell",
        role: "Research Director",
        title: "Principal Investigator",
        department: "research",
        capabilities: "Research direction, paper review, experiment design, grant writing, research team management, technical mentoring. Sets research agenda and ensures scientific rigor.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Dr. Wei Liu",
        role: "Senior Researcher",
        title: "Senior Research Scientist",
        department: "research",
        capabilities: "Deep learning research, model architecture design, experiment execution, paper writing, literature review, mathematical analysis. Expert in transformer architectures and optimization.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Arun Patel",
        role: "ML Engineer",
        title: "Machine Learning Engineer",
        department: "engineering",
        capabilities: "Model implementation, training pipeline development, distributed computing, MLOps, benchmarking, reproducibility. Turns research ideas into working code.",
        reportsToIndex: 0,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Nina Kowalski",
        role: "Research Analyst",
        title: "Research Analyst",
        department: "research",
        capabilities: "Data analysis, experiment tracking, results visualization, statistical testing, dataset curation, documentation. Supports research with rigorous analysis.",
        reportsToIndex: 0,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 150,
      },
    ],
    goals: [
      {
        title: "Conduct research and produce findings",
        description: "Explore the research topic, design and run experiments, analyze results, and produce a comprehensive report or paper with actionable findings.",
      },
      {
        title: "Build working prototype",
        description: "Implement a working prototype that demonstrates the key research findings. Include benchmarks, documentation, and reproducibility instructions.",
      },
    ],
  },
  {
    id: "fullstack-team",
    name: "Full-Stack Product Team",
    description: "A complete product development team with frontend, backend, DevOps, and design capabilities. Built for shipping production applications.",
    icon: "Stack",
    agents: [
      {
        name: "Chris Walker",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Product vision, team leadership, strategic planning, stakeholder management, resource allocation. Orchestrates the entire product development lifecycle.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Rachel Green",
        role: "Engineering Manager",
        title: "VP of Engineering",
        department: "engineering",
        capabilities: "Engineering management, technical architecture, code review, sprint planning, technical debt management, hiring. Ensures engineering excellence and team velocity.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "David Park",
        role: "Backend Engineer",
        title: "Senior Backend Developer",
        department: "engineering",
        capabilities: "API development, database design, authentication, server architecture, performance optimization, testing. Expert in Node.js, PostgreSQL, and REST/GraphQL APIs.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Lisa Wang",
        role: "Frontend Engineer",
        title: "Senior Frontend Developer",
        department: "engineering",
        capabilities: "React/Next.js development, TypeScript, CSS/Tailwind, responsive design, accessibility, state management, component architecture, frontend testing.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Marcus Cole",
        role: "DevOps Engineer",
        title: "Infrastructure Engineer",
        department: "engineering",
        capabilities: "CI/CD pipelines, Docker/Kubernetes, cloud infrastructure (AWS/GCP), monitoring, logging, security, deployment automation, database administration.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Sophie Anderson",
        role: "UX Designer",
        title: "Product Designer",
        department: "design",
        capabilities: "User research, wireframing, UI design, design systems, prototyping, usability testing, accessibility design. Creates intuitive and beautiful interfaces.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
    ],
    goals: [
      {
        title: "Build production-ready application",
        description: "Design and implement a full-stack application with proper architecture, testing, CI/CD, and deployment. Focus on scalability, security, and user experience.",
      },
      {
        title: "Establish infrastructure and DevOps",
        description: "Set up cloud infrastructure, CI/CD pipelines, monitoring, and automated deployment. Ensure the team can ship safely and roll back quickly.",
      },
    ],
  },
  {
    id: "solo-developer",
    name: "Solo Developer + AI Assistant",
    description: "A minimal setup with just a technical lead who does everything. Perfect for small projects or quick prototypes.",
    icon: "Code",
    agents: [
      {
        name: "Pat Developer",
        role: "Technical Lead",
        title: "Full-Stack Developer",
        department: "engineering",
        capabilities: "Full-stack development, system design, testing, deployment, debugging, code review. A versatile developer who can handle any technical task from frontend to backend to infrastructure.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 300,
      },
    ],
    goals: [
      {
        title: "Complete the project",
        description: "Analyze requirements, design the solution, implement it, test it, and deploy it. Handle all aspects of development from start to finish.",
      },
    ],
  },

  // ── Fortune 500 Enterprise ────────────────────────────────────────────
  // A truly realistic, fully-staffed company with 37 agents across 12
  // departments. Modeled after a mature tech company or Fortune 500 org
  // with every function needed to operate at scale.
  {
    id: "fortune500-enterprise",
    name: "Fortune 500 Enterprise",
    description: "A fully-staffed enterprise with 37 agents across 12 departments: Executive, Engineering, Product, Design, Marketing, Sales, HR, Finance, Legal, Customer Success, Operations, and Research. Every role, reporting line, and department you would find in a real Fortune 500 technology company.",
    icon: "Buildings",
    departments: [
      { id: "executive", name: "Executive Suite", description: "C-level leadership responsible for corporate strategy, capital allocation, board governance, and cross-functional alignment." },
      { id: "engineering", name: "Engineering", description: "Software development, platform infrastructure, quality assurance, application security, and data engineering." },
      { id: "product", name: "Product Management", description: "Product strategy, roadmap prioritization, feature specification, and data-informed experimentation." },
      { id: "design", name: "Design", description: "User experience research, interaction design, visual design, and design-system stewardship." },
      { id: "marketing", name: "Marketing", description: "Brand strategy, demand generation, content marketing, public relations, and growth analytics." },
      { id: "sales", name: "Sales", description: "Revenue strategy, enterprise account management, outbound prospecting, and pipeline forecasting." },
      { id: "hr", name: "People & Culture", description: "Talent acquisition, employer branding, people operations, DEI initiatives, benefits, and organizational development." },
      { id: "finance", name: "Finance", description: "Financial planning and analysis, accounting, treasury, expense management, and investor relations." },
      { id: "legal", name: "Legal & Compliance", description: "Corporate law, intellectual property, contract negotiation, data privacy, and regulatory compliance." },
      { id: "customer_support", name: "Customer Success", description: "Customer retention, technical support, onboarding, NPS tracking, and account expansion." },
      { id: "operations", name: "Operations", description: "Business process optimization, program management, vendor management, and OKR coordination." },
      { id: "research", name: "Research & Innovation", description: "Applied research, competitive intelligence, prototyping, and publication of thought-leadership papers." },
    ],
    agents: [
      // ────────────────────────────────────────────────────────────────────
      // EXECUTIVE SUITE — indices 0-4
      // ────────────────────────────────────────────────────────────────────
      {
        // index 0
        name: "Victoria Sterling",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Corporate vision and multi-year strategy, board of directors reporting, quarterly earnings narratives, M&A evaluation, organizational design, executive hiring and termination decisions, capital allocation across business units, crisis communication, company culture embodiment. Sets the north-star mission, chairs the executive committee, approves all budgets above $50k, and is the final escalation point for any cross-department conflict.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 1
        name: "James Whitfield",
        role: "COO",
        title: "Chief Operating Officer",
        department: "executive",
        capabilities: "Day-to-day operational cadence, cross-functional coordination, OKR framework ownership, business process re-engineering, vendor and partner management, operational metrics dashboards (cycle time, throughput, MTTR), company-wide meeting cadence (standups, all-hands, sprint ceremonies), office/remote workplace strategy, disaster-recovery and business-continuity planning. Acts as the connective tissue between every department and translates CEO strategy into executable operational plans.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 220,
      },
      {
        // index 2
        name: "Marcus Chen",
        role: "CTO",
        title: "Chief Technology Officer",
        department: "executive",
        capabilities: "Technical vision and 3-year technology roadmap, system architecture governance, build-vs-buy analysis, technology radar evaluation, security posture oversight, engineering culture and hiring bar, open-source strategy, cloud cost optimization, platform reliability targets (SLOs/SLAs), vendor technology evaluations, patent and IP review for technical inventions. Owns the technical strategy and ensures engineering investments align with business goals.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 3
        name: "Priya Sharma",
        role: "CFO",
        title: "Chief Financial Officer",
        department: "executive",
        capabilities: "Financial planning and analysis, 13-week cash-flow forecasting, annual budget cycle, department budget approvals, investor relations and fundraising decks, revenue recognition policy, tax strategy, audit preparation, financial risk assessment, burn-rate monitoring, unit-economics analysis (CAC/LTV), board financial reporting, expense policy enforcement. Controls every dollar and ensures the company remains solvent and investment-ready.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 4
        name: "Nadira Osei-Mensah",
        role: "CHRO",
        title: "Chief Human Resources Officer",
        department: "executive",
        capabilities: "People strategy and workforce planning, organizational development, employer brand positioning, total-rewards philosophy (comp, equity, benefits), DEI program design and measurement, succession planning for key roles, leadership development programs, employee engagement surveys (eNPS), labor-law compliance, culture rituals (offsites, recognition programs), conflict resolution at the executive level. Ensures the company attracts, retains, and grows world-class talent.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },

      // ────────────────────────────────────────────────────────────────────
      // ENGINEERING — indices 5-12
      // ────────────────────────────────────────────────────────────────────
      {
        // index 5
        name: "Elena Rodriguez",
        role: "VP Engineering",
        title: "Vice President of Engineering",
        department: "engineering",
        capabilities: "Engineering management across multiple squads, sprint planning and velocity tracking, hiring pipeline and technical interviews, code-review process governance, incident-commander rotation scheduling, engineering budget and headcount planning, technical debt prioritization, on-call rotation management, engineering all-hands facilitation, promotion and calibration cycles. Ensures the engineering org ships high-quality software on predictable cadences.",
        reportsToIndex: 2,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 220,
      },
      {
        // index 6
        name: "Tomasz Kowalski",
        role: "Principal Engineer",
        title: "Principal Software Engineer",
        department: "engineering",
        capabilities: "System-wide architecture design and review, RFC authorship and cross-team technical alignment, tech-debt reduction strategy, performance optimization at scale, database sharding and replication design, distributed-systems patterns (CQRS, event sourcing, saga), mentoring senior and mid-level engineers, evaluating new languages/frameworks, writing architecture decision records (ADRs), leading design reviews and post-mortems. The technical conscience of the org.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 280,
      },
      {
        // index 7
        name: "Kai Nakamura",
        role: "Senior Backend Engineer",
        title: "Senior Backend Engineer",
        department: "engineering",
        capabilities: "REST and GraphQL API design, microservice development in Node.js/Go/Python, PostgreSQL schema design and query optimization, Redis caching strategies, message-queue integration (Kafka, RabbitMQ), authentication and authorization (OAuth2, RBAC), rate limiting, database migration scripting, writing comprehensive unit and integration tests, performance profiling and load testing. Writes production-grade, well-tested backend code daily.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 8
        name: "Sofia Andersson",
        role: "Senior Frontend Engineer",
        title: "Senior Frontend Engineer",
        department: "engineering",
        capabilities: "React 19 and Next.js application development, TypeScript strict-mode, state management (Zustand, React Query), component architecture and monorepo structuring, CSS-in-JS and Tailwind, WCAG 2.2 accessibility compliance, Storybook component documentation, frontend performance budgets (LCP, CLS, FID), E2E testing with Playwright, design-system token consumption, SSR/ISR rendering strategies. Implements pixel-perfect UIs and maintains frontend architecture standards.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 9
        name: "Omar Hassan",
        role: "Platform / DevOps Engineer",
        title: "Senior Platform Engineer",
        department: "engineering",
        capabilities: "CI/CD pipeline design (GitHub Actions, GitLab CI), Infrastructure-as-Code (Terraform, Pulumi), container orchestration (Docker, Kubernetes, Helm), cloud platform management (AWS/GCP/Azure), observability stack (Datadog, Grafana, Prometheus, OpenTelemetry), secrets management (Vault, AWS SSM), database administration and backup automation, cost-optimization reviews, incident response runbooks, zero-downtime deployment strategies, SOC2 infrastructure controls. Keeps the platform reliable and the deploy pipeline under 5 minutes.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 10
        name: "Yuki Tanaka",
        role: "QA Lead",
        title: "Quality Assurance Lead",
        department: "engineering",
        capabilities: "Test strategy for unit, integration, E2E, and contract tests, test-automation framework selection and maintenance, CI quality gates and flaky-test management, performance and load-test design (k6, Locust), visual-regression testing, mobile-device testing matrix, bug-triage process ownership, release-readiness checklists, test coverage reporting, accessibility auditing, chaos-engineering experiments. No feature ships without QA sign-off. Expert in Playwright, Jest, and Cypress.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 11
        name: "Amina Diallo",
        role: "Security Engineer",
        title: "Application Security Engineer",
        department: "engineering",
        capabilities: "Application security reviews and threat modeling (STRIDE), static analysis tooling (Semgrep, CodeQL), dependency vulnerability scanning (Snyk, Dependabot), penetration testing coordination, OWASP Top-10 remediation, secrets-rotation policy, SOC2 and ISO 27001 compliance evidence collection, security incident response playbooks, developer security training, API authentication hardening, data-encryption-at-rest and in-transit audits. Guardian of the codebase against external and internal threats.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 12
        name: "Ravi Krishnamurthy",
        role: "Data Engineer",
        title: "Senior Data Engineer",
        department: "engineering",
        capabilities: "ETL/ELT pipeline development (dbt, Airflow, Dagster), data-warehouse design (Snowflake, BigQuery, Redshift), real-time streaming (Kafka, Flink), data-quality frameworks (Great Expectations), analytics-infrastructure provisioning, BI tool integration (Looker, Metabase), data-catalog and lineage documentation, PII anonymization pipelines, cost-per-query optimization, data-model governance. Builds the plumbing that turns raw data into trustworthy business insights.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },

      // ────────────────────────────────────────────────────────────────────
      // PRODUCT & DESIGN — indices 13-16
      // ────────────────────────────────────────────────────────────────────
      {
        // index 13
        name: "Amara Okafor",
        role: "VP Product",
        title: "Vice President of Product",
        department: "product",
        capabilities: "Product vision and multi-quarter roadmap, RICE/ICE prioritization frameworks, PRD and BRD authorship, competitive landscape analysis, user-interview synthesis, stakeholder alignment workshops, A/B test design and read-outs, launch-readiness reviews, pricing and packaging strategy input, product-led growth metrics (activation, retention, expansion), OKR definition for product squads. Owns what gets built, why it gets built, and how success is measured.",
        reportsToIndex: 2,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 14
        name: "Daniel Okonkwo",
        role: "Senior Product Manager",
        title: "Senior Product Manager",
        department: "product",
        capabilities: "Feature specification and user-story writing, sprint backlog grooming, JIRA/Linear workflow management, customer-feedback triage (Productboard, Canny), data-analysis for feature decisions (Amplitude, Mixpanel), A/B test configuration and statistical significance review, go-to-market coordination with marketing, release-notes drafting, beta-program management, competitive feature benchmarking. Translates user needs into shippable increments every sprint.",
        reportsToIndex: 13,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 15
        name: "Ingrid Johansson",
        role: "UX Director",
        title: "Director of User Experience",
        department: "design",
        capabilities: "User-research program management (interviews, surveys, diary studies, card sorts), usability-testing facilitation, persona and journey-map creation, information-architecture design, wireframe and low-fidelity prototype creation, heuristic evaluation, accessibility audit leadership, design-ops process (critique cadence, handoff standards), cross-functional design-sprint facilitation. Ensures every product decision is grounded in real user evidence.",
        reportsToIndex: 13,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 16
        name: "Leo Moretti",
        role: "UI Designer",
        title: "Senior UI Designer",
        department: "design",
        capabilities: "Visual design in Figma (components, auto-layout, variants, tokens), design-system creation and maintenance, icon and illustration production, motion and micro-interaction design, responsive-layout specifications, dark-mode and theming support, design-token export for engineering consumption (Style Dictionary), brand-consistency auditing, high-fidelity prototyping (Figma prototypes, Framer), print and presentation collateral. Turns wireframes into polished, production-ready visual designs.",
        reportsToIndex: 15,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },

      // ────────────────────────────────────────────────────────────────────
      // MARKETING — indices 17-20
      // ────────────────────────────────────────────────────────────────────
      {
        // index 17
        name: "Jasmine Delacroix",
        role: "CMO",
        title: "Chief Marketing Officer",
        department: "marketing",
        capabilities: "Integrated marketing strategy, brand architecture and positioning, demand-generation funnel design, marketing-budget allocation across channels, marketing-ops tooling (HubSpot, Marketo, Segment), campaign ROI modeling, competitive positioning and battlecards, analyst-relations (Gartner, Forrester), executive storytelling, board-level marketing updates. Drives awareness, pipeline, and brand equity across every touchpoint.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 18
        name: "Noah Park",
        role: "Content Director",
        title: "Director of Content",
        department: "marketing",
        capabilities: "Editorial strategy and content calendar management, long-form blog authorship and editing, SEO keyword research and on-page optimization (Ahrefs, Semrush), white-paper and e-book production, case-study interviews and writing, email-newsletter curation, thought-leadership ghostwriting for executives, content-repurposing workflows (blog to social to video), content-performance analytics (traffic, engagement, conversion). Produces compelling content that drives organic traffic and positions the company as a category leader.",
        reportsToIndex: 17,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 19
        name: "Zara Ahmed",
        role: "Growth Marketing Manager",
        title: "Growth Marketing Manager",
        department: "marketing",
        capabilities: "Paid-acquisition management (Google Ads, LinkedIn Ads, Meta Ads), social-media channel strategy and posting, conversion-rate optimization (landing pages, CTAs, forms), marketing-automation workflows (drip campaigns, lead scoring), influencer and partnership outreach, referral-program design, funnel analytics and attribution modeling, A/B testing of ad creatives and copy, community management (Discord, Slack communities), event marketing and webinar production. Owns the growth engine from first touch to MQL.",
        reportsToIndex: 17,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
      {
        // index 20
        name: "Clara Dubois",
        role: "Brand & PR Manager",
        title: "Brand & Public Relations Manager",
        department: "marketing",
        capabilities: "Public-relations strategy and media outreach, press-release drafting and distribution, journalist relationship management, crisis-communication playbooks, brand-guideline enforcement, event sponsorship evaluation, award-submission management, social-listening and reputation monitoring, executive media training, conference speaking-slot procurement. Protects and amplifies the company's public image.",
        reportsToIndex: 17,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },

      // ────────────────────────────────────────────────────────────────────
      // SALES — indices 21-23
      // ────────────────────────────────────────────────────────────────────
      {
        // index 21
        name: "Daniel Brooks",
        role: "VP Sales",
        title: "Vice President of Sales",
        department: "sales",
        capabilities: "Revenue strategy and annual quota planning, sales-team hiring and enablement, pipeline inspection and forecasting (Salesforce, Clari), deal-desk governance, discount-approval authority, territory and account-assignment strategy, compensation-plan design, sales-engineering coordination, quarterly business reviews, competitive win/loss analysis, partner-channel strategy. Owns the number and ensures every rep has the tools and training to hit quota.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 22
        name: "Grace Kimura",
        role: "Enterprise Account Executive",
        title: "Enterprise Account Executive",
        department: "sales",
        capabilities: "Enterprise sales cycle management (6-18 months), executive-level relationship building, multi-threaded deal navigation, RFP and security-questionnaire completion, value-engineering and ROI presentations, contract negotiation and red-lining, custom demo and POC coordination, champion-building within target accounts, CRM hygiene and pipeline stage accuracy, cross-sell and upsell within install base. Closes six- and seven-figure deals by understanding customer pain and articulating value.",
        reportsToIndex: 21,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 23
        name: "Marcus Adebayo",
        role: "SDR Manager",
        title: "Sales Development Representative Manager",
        department: "sales",
        capabilities: "Outbound prospecting strategy and sequence design, SDR coaching and call shadowing, lead-qualification frameworks (BANT, MEDDPICC), email-cadence optimization and A/B testing, cold-call scripting and objection handling, CRM data enrichment (ZoomInfo, Apollo), meeting-booked metrics and conversion tracking, SDR-to-AE handoff process, intent-signal monitoring, account-based marketing collaboration. Fills the top of the funnel with qualified opportunities.",
        reportsToIndex: 21,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },

      // ────────────────────────────────────────────────────────────────────
      // HR / PEOPLE — indices 24-26
      // ────────────────────────────────────────────────────────────────────
      {
        // index 24
        name: "Olivia Nguyen",
        role: "VP People",
        title: "Vice President of People",
        department: "hr",
        capabilities: "Talent strategy and workforce planning, employer-brand campaigns (Glassdoor, LinkedIn), DEI program design and metrics, leadership coaching and executive development, employee engagement survey design (Culture Amp), retention analysis and flight-risk modeling, performance-calibration facilitation, organizational restructuring advisory, exit-interview trend analysis. Shapes the company culture and ensures every team has the right people in the right seats.",
        reportsToIndex: 4,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
      {
        // index 25
        name: "Farid Al-Rashidi",
        role: "Recruiting Lead",
        title: "Head of Talent Acquisition",
        department: "hr",
        capabilities: "Full-cycle recruiting (sourcing, screening, interviewing, closing), ATS management (Greenhouse, Lever), Boolean-search sourcing on LinkedIn and GitHub, hiring-committee facilitation, interview-rubric design and interviewer training, offer-letter preparation and compensation benchmarking (Pave, Levels.fyi), diversity-sourcing strategies, university-relations and intern-program management, recruiting-metric dashboards (time-to-fill, pass-through rates, source mix). Fills open roles with top-tier talent on schedule.",
        reportsToIndex: 24,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 140,
      },
      {
        // index 26
        name: "Hannah Johansson",
        role: "People Operations Manager",
        title: "People Operations Manager",
        department: "hr",
        capabilities: "New-hire onboarding program design and execution, HRIS administration (Rippling, Workday), benefits enrollment and vendor management, payroll coordination, PTO and leave-policy management, employee-handbook maintenance, office and remote-work policy administration, compliance training scheduling (harassment, security), offboarding workflows, people-analytics reporting, employee-recognition programs. Keeps the people engine running smoothly from day one to departure.",
        reportsToIndex: 24,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 120,
      },

      // ────────────────────────────────────────────────────────────────────
      // FINANCE & LEGAL — indices 27-29
      // ────────────────────────────────────────────────────────────────────
      {
        // index 27
        name: "Richard Okonkwo",
        role: "VP Finance",
        title: "Vice President of Finance",
        department: "finance",
        capabilities: "Financial planning and analysis (3-statement modeling, scenario planning), annual and quarterly budgeting, department-budget review and approval, revenue forecasting and cohort analysis, investor-relations materials (board decks, data rooms), fundraising financial due diligence, KPI dashboards (ARR, MRR, NRR, gross margin), cash-runway monitoring, tax-strategy coordination with external counsel, audit committee reporting. Ensures every financial decision is data-driven and defensible.",
        reportsToIndex: 3,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 28
        name: "Mei-Ling Wu",
        role: "Financial Controller",
        title: "Financial Controller",
        department: "finance",
        capabilities: "Accounts payable and receivable management, general-ledger maintenance, month-end and quarter-end close processes, revenue-recognition (ASC 606) compliance, expense-report auditing and policy enforcement, bank-reconciliation, vendor payment processing, sales-tax calculation and filing, intercompany transfers, external-audit support and evidence preparation, budget-vs-actual variance analysis. The operational backbone of the finance department.",
        reportsToIndex: 27,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 140,
      },
      {
        // index 29
        name: "Alejandro Vega",
        role: "General Counsel",
        title: "General Counsel",
        department: "legal",
        capabilities: "Corporate governance and board-resolution drafting, SaaS contract negotiation (MSA, DPA, SLA, BAA), intellectual-property strategy (patents, trademarks, trade secrets), employment-law advisory (offer letters, separation agreements, non-competes), data-privacy program (GDPR, CCPA, SOC2 policy), regulatory-compliance monitoring, litigation management and outside-counsel coordination, M&A legal due-diligence, open-source license review, terms-of-service and privacy-policy drafting. The legal safeguard for every business decision.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },

      // ────────────────────────────────────────────────────────────────────
      // CUSTOMER SUCCESS — indices 30-32
      // ────────────────────────────────────────────────────────────────────
      {
        // index 30
        name: "Aisha Williams",
        role: "VP Customer Success",
        title: "Vice President of Customer Success",
        department: "customer_support",
        capabilities: "Customer-retention strategy, net-promoter-score (NPS) and CSAT program management, customer-health scoring model design, churn-risk identification and intervention playbooks, QBR (quarterly business review) facilitation with key accounts, support-tier escalation policy, customer-advisory-board coordination, voice-of-customer reporting to product, expansion-revenue targets, customer-journey mapping, onboarding-program design. Ensures customers achieve value and renew.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 31
        name: "Sergei Volkov",
        role: "Senior Support Engineer",
        title: "Senior Technical Support Engineer",
        department: "customer_support",
        capabilities: "Tier-2 and Tier-3 technical troubleshooting, bug reproduction and detailed bug-report filing to engineering, log analysis and root-cause investigation, API-integration debugging with customers, knowledge-base article authorship, internal runbook creation, on-call support rotation, SLA adherence tracking, customer-communication during incidents, Zendesk/Intercom workflow management. The bridge between customers experiencing issues and engineering teams who fix them.",
        reportsToIndex: 30,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 160,
      },
      {
        // index 32
        name: "Camila Reyes",
        role: "Customer Success Manager",
        title: "Customer Success Manager",
        department: "customer_support",
        capabilities: "Post-sale customer onboarding and implementation, product-adoption tracking and usage analytics, proactive check-in cadence with assigned accounts, renewal forecasting and risk flagging, expansion and upsell opportunity identification, customer-training webinars and enablement materials, internal champion cultivation, feature-request aggregation for product, reference-customer development, success-plan creation. The customer's advocate inside the company.",
        reportsToIndex: 30,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 140,
      },

      // ────────────────────────────────────────────────────────────────────
      // OPERATIONS — indices 33-34
      // ────────────────────────────────────────────────────────────────────
      {
        // index 33
        name: "Kenji Watanabe",
        role: "Director of Operations",
        title: "Director of Operations",
        department: "operations",
        capabilities: "Business-process mapping and optimization (Lean, Six Sigma), vendor procurement and contract negotiation, SaaS-tool stack rationalization, internal tooling roadmap, office and facilities management, company-wide policy documentation, business-continuity and disaster-recovery planning, insurance and risk-management coordination, operational-budget management, cross-functional process audits. Removes friction from every team so they can focus on their core work.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },
      {
        // index 34
        name: "Laura Petrov",
        role: "Program Manager",
        title: "Senior Program Manager",
        department: "operations",
        capabilities: "Cross-functional initiative coordination, OKR tracking and quarterly scoring, executive status reporting, risk-register maintenance and mitigation planning, dependency mapping across teams, Gantt and timeline management, steering-committee facilitation, post-mortem and retrospective orchestration, resource-conflict resolution, change-management communication. Ensures multi-team programs land on time and scope.",
        reportsToIndex: 33,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },

      // ────────────────────────────────────────────────────────────────────
      // RESEARCH — indices 35-36
      // ────────────────────────────────────────────────────────────────────
      {
        // index 35
        name: "Dr. Lena Hoffmann",
        role: "Director of Research",
        title: "Director of Research & Innovation",
        department: "research",
        capabilities: "Research-agenda setting and quarterly planning, grant and funding proposals, academic-partnership management, publication strategy (conference papers, journal submissions), patent-filing coordination with legal, competitive-intelligence analysis, emerging-technology evaluation, internal tech-talk and brown-bag facilitation, research-to-product technology transfer, ethical-AI review board participation. Steers the research program and ensures insights reach production.",
        reportsToIndex: 2,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 36
        name: "Dr. Aarav Mehta",
        role: "Research Scientist",
        title: "Research Scientist",
        department: "research",
        capabilities: "Hypothesis formulation and experiment design, statistical analysis (frequentist and Bayesian), prototype development in Python/PyTorch, benchmark dataset curation, literature survey and related-work summarization, paper writing (LaTeX, Overleaf), internal technical-report authorship, reproducibility packaging (Docker, Weights & Biases), ML-model evaluation and ablation studies, presenting findings to engineering and product. Generates new knowledge and translates it into practical improvements.",
        reportsToIndex: 35,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 200,
      },
    ],
    goals: [
      {
        title: "Launch the flagship product to market",
        description: "Coordinate across Engineering, Product, Design, Marketing, Sales, and Customer Success to design, build, test, market, sell, and support the initial product. Engineering builds it, Product defines it, Design makes it intuitive, Marketing drives awareness, Sales converts pipeline, and Customer Success ensures retention.",
      },
      {
        title: "Establish company-wide operational excellence",
        description: "COO and Director of Operations lead the effort to implement OKR cadence, sprint ceremonies, cross-department communication protocols, budget processes, and performance review cycles. Every department should have documented workflows and measurable KPIs within the first quarter.",
      },
      {
        title: "Build and scale a world-class team",
        description: "CHRO and VP People collaborate with every department head to define role descriptions, hiring rubrics, onboarding programs, performance calibration, and career ladders. Identify capability gaps early, hire to fill them, and maintain an eNPS above 50.",
      },
      {
        title: "Achieve financial sustainability and growth",
        description: "CFO and VP Finance work with Sales and Marketing to model revenue projections, control burn rate, optimize marketing spend, and drive toward profitability. Monthly financial reviews, budget-vs-actual tracking, and board-ready reporting are mandatory.",
      },
      {
        title: "Create a category-defining brand and market presence",
        description: "CMO leads content strategy, paid acquisition, PR, and brand development. Coordinate with Product for launch messaging and Sales for competitive battlecards. Track brand awareness, share of voice, and marketing-sourced pipeline as primary KPIs.",
      },
      {
        title: "Deliver enterprise-grade security and compliance",
        description: "Security Engineer and General Counsel collaborate to achieve SOC2 Type II certification, implement data-privacy controls (GDPR, CCPA), harden application security, and establish incident-response playbooks. Every product release must pass security review.",
      },
      {
        title: "Build a data-driven decision culture",
        description: "Data Engineer and Research team build analytics infrastructure, dashboards, and experimentation frameworks so every department makes decisions based on evidence rather than intuition. Establish a single source of truth for company metrics.",
      },
      {
        title: "Drive customer success and net revenue retention",
        description: "VP Customer Success ensures customers achieve value, renew, and expand. Implement health scoring, proactive support, QBRs, and onboarding programs. Target net revenue retention above 120% and NPS above 60.",
      },
      {
        title: "Advance R&D and maintain competitive moat",
        description: "Director of Research and Research Scientist drive applied research, publish findings, and transfer innovations to the product. Evaluate emerging technologies, file patents where appropriate, and maintain a 6-month technical lead over competitors.",
      },
      {
        title: "Scale cross-functional program delivery",
        description: "Program Manager and Operations coordinate multi-team initiatives, manage dependencies, track OKRs, and run steering committees. Ensure that company-wide programs (platform migrations, new-market entry, compliance certifications) land on time with clear accountability.",
      },
    ],
  },

  // ── E-Commerce Company ──────────────────────────────────────────────
  {
    id: "ecommerce-company",
    name: "E-Commerce Business",
    description: "A complete e-commerce operation with product, engineering, marketing, and fulfillment. Optimized for building and running an online store.",
    icon: "ShoppingCart",
    agents: [
      {
        name: "Rebecca Sterling",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "E-commerce strategy, marketplace positioning, vendor relations, pricing strategy, team leadership, P&L management. Drives the overall business direction.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        name: "Tom Chen",
        role: "CTO",
        title: "Chief Technology Officer",
        department: "engineering",
        capabilities: "Platform architecture, payment integration, inventory systems, search/recommendation engines, performance optimization, security compliance (PCI-DSS).",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 220,
      },
      {
        name: "Nina Patel",
        role: "Full-Stack Developer",
        title: "Senior Full-Stack Developer",
        department: "engineering",
        capabilities: "Storefront development (React/Next.js), cart/checkout flow, payment gateway integration, order management API, product catalog, responsive design, SEO markup.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Carlos Mendez",
        role: "Product Manager",
        title: "Senior Product Manager",
        department: "product",
        capabilities: "Product catalog strategy, conversion optimization, user journey mapping, A/B testing, feature prioritization, competitive analysis, pricing experiments.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Sophie Liu",
        role: "Marketing Manager",
        title: "Digital Marketing Manager",
        department: "marketing",
        capabilities: "SEO/SEM, email marketing campaigns, social commerce, influencer partnerships, retargeting, conversion funnel optimization, promotional calendar, loyalty programs.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        name: "David Osei",
        role: "Operations Manager",
        title: "Operations & Fulfillment Manager",
        department: "operations",
        capabilities: "Inventory management, order fulfillment, shipping logistics, supplier coordination, warehouse operations, returns processing, demand forecasting.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 120,
      },
      {
        name: "Amy Zhao",
        role: "Customer Support",
        title: "Customer Experience Manager",
        department: "customer_support",
        capabilities: "Order support, returns/refunds, product inquiries, review management, complaint resolution, FAQ/help center maintenance, live chat support, customer satisfaction tracking.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 100,
      },
    ],
    goals: [
      {
        title: "Build and launch the online store",
        description: "Design and implement a full e-commerce platform with product catalog, cart, checkout, payment processing, and order management. Mobile-responsive with fast load times.",
      },
      {
        title: "Drive traffic and conversions",
        description: "Execute marketing strategy across SEO, email, social, and paid channels. Optimize the conversion funnel. Target specific revenue and customer acquisition goals.",
      },
      {
        title: "Establish operational excellence",
        description: "Set up inventory management, fulfillment workflows, shipping integrations, and customer support processes. Achieve sub-24h response times for support.",
      },
    ],
  },

  // ── Consulting Firm ──────────────────────────────────────────────────
  {
    id: "consulting-firm",
    name: "Consulting Firm",
    description: "A professional services firm with strategy, technical, and delivery capabilities. Built for client engagements, proposals, and project delivery.",
    icon: "Briefcase",
    agents: [
      {
        name: "Michael Grant",
        role: "Managing Director",
        title: "Managing Director",
        department: "executive",
        capabilities: "Client relationship management, engagement scoping, proposal writing, resource allocation, quality assurance, strategic advisory, thought leadership, revenue management.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Sarah Kim",
        role: "Strategy Consultant",
        title: "Senior Strategy Consultant",
        department: "operations",
        capabilities: "Market analysis, competitive strategy, business model design, financial modeling, due diligence, stakeholder interviews, presentation design, executive communication.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        name: "Alex Rivera",
        role: "Technical Consultant",
        title: "Principal Technical Consultant",
        department: "engineering",
        capabilities: "Architecture assessment, technology evaluation, implementation planning, code review, cloud migration strategy, security audit, performance optimization, technical documentation.",
        reportsToIndex: 0,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        name: "Emily Chen",
        role: "Delivery Lead",
        title: "Delivery Manager",
        department: "operations",
        capabilities: "Project planning, client communication, risk management, timeline tracking, team coordination, status reporting, scope management, quality gates, retrospectives.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        name: "Jordan Taylor",
        role: "Research Analyst",
        title: "Research Analyst",
        department: "research",
        capabilities: "Industry research, data analysis, competitive benchmarking, market sizing, report writing, visualization, survey design, trend analysis. Supports consultants with data-driven insights.",
        reportsToIndex: 0,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 130,
      },
    ],
    goals: [
      {
        title: "Win and deliver client engagement",
        description: "Develop a compelling proposal, scope the engagement, plan delivery, execute work streams, and deliver high-quality recommendations with measurable impact.",
      },
      {
        title: "Build firm knowledge base",
        description: "Document methodologies, case studies, frameworks, and reusable deliverable templates. Create a knowledge management system that makes the firm smarter over time.",
      },
    ],
  },

  // ── AI Research Company ───────────────────────────────────────────────
  // Modeled after organizations like OpenAI, Anthropic, and DeepMind.
  // Research-first with strong engineering to ship models into production.
  {
    id: "ai-research-company",
    name: "AI Research Company",
    description: "An AI/ML research company with 18 agents across Research, Engineering, Product, Safety, and Business functions. Modeled after frontier AI labs like OpenAI, Anthropic, and DeepMind — built to discover, build, and responsibly deploy AI systems.",
    icon: "Brain",
    departments: [
      { id: "executive", name: "Executive Leadership", description: "Company strategy, fundraising, research direction, and public representation of the organization." },
      { id: "research", name: "Research", description: "Fundamental and applied AI research, model architecture, training methodologies, and evaluation." },
      { id: "engineering", name: "Engineering & Infrastructure", description: "ML platform, training infrastructure, model serving, API development, and reliability." },
      { id: "product", name: "Product", description: "Product strategy, user experience, API design, and go-to-market for model offerings." },
      { id: "design", name: "Design", description: "Interface design, developer experience, and documentation for AI products and APIs." },
      { id: "operations", name: "Safety & Operations", description: "AI safety, alignment research, red-teaming, policy, and responsible-deployment processes." },
      { id: "marketing", name: "Marketing & Communications", description: "Research communications, developer relations, brand, and public affairs." },
      { id: "hr", name: "People", description: "Talent acquisition for research and engineering, organizational development, and culture." },
      { id: "finance", name: "Finance", description: "GPU-budget management, fundraising, financial planning, and compute-cost optimization." },
      { id: "legal", name: "Legal & Policy", description: "IP strategy, regulatory affairs, AI governance, data licensing, and compliance." },
    ],
    agents: [
      // ── Executive (0-1) ──
      {
        // index 0
        name: "Dr. Julian Crane",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Company vision and AGI-timeline strategy, investor relations and fundraising (Series B+), board governance, public representation and congressional testimony, research-direction approval, partnership strategy with cloud providers and enterprises, organizational design for rapid scaling, crisis management. Sets the north star for the lab and ensures alignment between research ambitions and business sustainability.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 1
        name: "Dr. Mei-Xing Zhou",
        role: "Chief Scientist",
        title: "Chief Scientist",
        department: "research",
        capabilities: "Research agenda and multi-year roadmap, model-architecture decisions, compute-allocation prioritization, publication strategy (NeurIPS, ICML, ICLR), research-team hiring bar, external academic collaborations, technical advisory to CEO and board, safety/capabilities balance arbitration. The intellectual leader of the lab who decides what problems are worth solving next.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 280,
      },

      // ── Research (2-6) ──
      {
        // index 2
        name: "Dr. Sasha Petrov",
        role: "Research Lead — Pre-training",
        title: "Senior Research Scientist — Pre-training",
        department: "research",
        capabilities: "Large-scale pre-training methodology, data-mixture optimization, scaling-law experiments, loss-curve analysis, tokenizer design, multi-modal pre-training (text, code, vision), distributed-training orchestration, compute-efficiency research (MoE, sparse attention), training-run monitoring and intervention, ablation studies, paper authorship. Owns the pre-training pipeline from data to checkpoint.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 260,
      },
      {
        // index 3
        name: "Dr. Nneka Adeyemi",
        role: "Research Lead — Post-training",
        title: "Senior Research Scientist — RLHF & Fine-tuning",
        department: "research",
        capabilities: "Reinforcement learning from human feedback (RLHF/DPO/KTO), instruction-tuning methodology, reward-model training, preference-data collection design, constitutional-AI approaches, chain-of-thought elicitation, evaluation-benchmark development, red-team-finding remediation, model-behavior analysis, paper authorship. Transforms base models into helpful, harmless, and honest assistants.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 260,
      },
      {
        // index 4
        name: "Dr. Hiroshi Takeda",
        role: "Research Scientist — Reasoning",
        title: "Research Scientist — Reasoning & Agents",
        department: "research",
        capabilities: "Reasoning-capability research (chain-of-thought, tree-of-thought, self-reflection), tool-use and function-calling development, agentic-loop design, code-generation evaluation, math and logic benchmarking, multi-step planning, retrieval-augmented generation (RAG), context-window optimization, paper authorship, internal tech talks. Pushes the frontier on what models can do autonomously.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 240,
      },
      {
        // index 5
        name: "Dr. Amara Osei",
        role: "Research Scientist — Safety",
        title: "Research Scientist — AI Safety",
        department: "research",
        capabilities: "Alignment research (interpretability, honesty, corrigibility), red-teaming and adversarial evaluation, jailbreak analysis and mitigation, bias and fairness auditing, model-behavior monitoring in production, responsible-disclosure processes, safety-case documentation, system-prompt hardening, content-policy enforcement research, collaboration with policy team. Ensures models are safe to deploy and that capabilities do not outpace safety.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 240,
      },
      {
        // index 6
        name: "Lila Fernandez",
        role: "Research Engineer",
        title: "Senior Research Engineer",
        department: "research",
        capabilities: "Training-framework development (JAX, PyTorch), custom CUDA kernel optimization, distributed-training libraries (DeepSpeed, FSDP, Megatron), experiment-tracking infrastructure (W&B, MLflow), checkpoint management and model merging, data-pipeline engineering for training corpora, GPU-cluster scheduling, training-cost analysis, reproducibility tooling. Bridges research ideas and production-scale training.",
        reportsToIndex: 1,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },

      // ── Engineering (7-10) ──
      {
        // index 7
        name: "Rajiv Sundaram",
        role: "VP Engineering",
        title: "Vice President of Engineering",
        department: "engineering",
        capabilities: "Engineering organization management, API-platform strategy, inference-infrastructure roadmap, model-serving SLA definition, engineering hiring and team structure, on-call and incident management, cloud-cost optimization (GPU spend), vendor management (cloud providers, hardware), sprint cadence and delivery metrics, engineering all-hands. Ensures research outputs ship as reliable, scalable products.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 220,
      },
      {
        // index 8
        name: "Christine Bergstrom",
        role: "ML Infrastructure Engineer",
        title: "Senior ML Infrastructure Engineer",
        department: "engineering",
        capabilities: "Model-serving infrastructure (vLLM, TensorRT, Triton), GPU cluster management and scheduling (Slurm, Kubernetes), inference optimization (quantization, KV-cache, speculative decoding), autoscaling for variable demand, latency and throughput benchmarking, cost-per-token analysis, A/B model deployment, model-versioning and rollback, observability for inference (latency p50/p99, error rates), multi-region deployment. Keeps models running fast and cheap at scale.",
        reportsToIndex: 7,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 9
        name: "Andre Williams",
        role: "Backend Engineer",
        title: "Senior Backend Engineer",
        department: "engineering",
        capabilities: "API development (REST, streaming, WebSocket), rate limiting and usage metering, authentication (API keys, OAuth), billing integration (Stripe), database management (PostgreSQL, Redis), message queues for async inference, developer-SDK development (Python, TypeScript), playground and dashboard backend, webhook delivery, audit logging. Builds the API surface that developers interact with daily.",
        reportsToIndex: 7,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 10
        name: "Yuna Kim",
        role: "Frontend Engineer",
        title: "Senior Frontend Engineer",
        department: "engineering",
        capabilities: "React/Next.js application development, playground and chat UI implementation, real-time streaming interfaces, developer-documentation site (Mintlify, Nextra), API-reference auto-generation, usage-dashboard design, component library maintenance, accessibility, responsive design, Storybook. Builds the interfaces where developers and users experience the models.",
        reportsToIndex: 7,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 220,
      },

      // ── Product & Design (11-13) ──
      {
        // index 11
        name: "Tara Blackwell",
        role: "VP Product",
        title: "Vice President of Product",
        department: "product",
        capabilities: "API product strategy and packaging (tiers, pricing, rate limits), developer-experience roadmap, model-selection guidance and documentation, enterprise feature prioritization (SSO, fine-tuning, dedicated capacity), competitive analysis (pricing, features, benchmarks), launch coordination with research and marketing, customer-feedback synthesis, partnership integration strategy, product-led growth metrics. Decides what ships and how it is packaged for the market.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 12
        name: "Omar Khalil",
        role: "Product Manager — Developer Platform",
        title: "Product Manager — Developer Platform",
        department: "product",
        capabilities: "Developer-experience (DX) optimization, SDK and API usability testing, documentation quality assurance, developer-community feedback aggregation, changelog and migration-guide authorship, beta-program management, API-versioning strategy, error-message improvements, usage-analytics analysis, competitive DX benchmarking. Ensures developers love building with the platform.",
        reportsToIndex: 11,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },
      {
        // index 13
        name: "Vera Lindqvist",
        role: "Product Designer",
        title: "Senior Product Designer",
        department: "design",
        capabilities: "Playground and chat-interface design, API-documentation layout and information architecture, design-system for developer tools, usability testing with developers, data-visualization for usage dashboards, onboarding-flow design, accessibility compliance, prototyping in Figma, interaction design for streaming UIs. Makes complex AI products feel simple and intuitive.",
        reportsToIndex: 11,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },

      // ── Marketing & DevRel (14-15) ──
      {
        // index 14
        name: "Marcus Rhodes",
        role: "Head of Marketing",
        title: "Head of Marketing & Communications",
        department: "marketing",
        capabilities: "Research-announcement strategy and blog authorship, developer-marketing campaigns, social-media presence (Twitter/X, LinkedIn), conference speaking and sponsorship, developer-community building (Discord, GitHub), press and media coordination, brand-voice governance, competitive messaging, email marketing, analytics and attribution. Translates research breakthroughs into market excitement and developer adoption.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
      {
        // index 15
        name: "Priya Khatri",
        role: "Developer Advocate",
        title: "Senior Developer Advocate",
        department: "marketing",
        capabilities: "Technical blog-post and tutorial authorship, sample-application development, conference talks and workshop facilitation, developer-community management (Discord, forums), cookbook and quickstart-guide creation, customer-use-case storytelling, YouTube and livestream content, GitHub-issue triage from community, feedback pipeline to product, hackathon organization. The face of the platform in the developer community.",
        reportsToIndex: 14,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 170,
      },

      // ── People & Finance & Legal (16-17) ──
      {
        // index 16
        name: "Danielle Moreau",
        role: "Head of People",
        title: "Head of People",
        department: "hr",
        capabilities: "Research-talent acquisition strategy (top ML PhDs, top-tier engineers), compensation benchmarking against frontier labs, equity-grant management, onboarding programs for researchers and engineers, culture-building in a research-first organization, performance reviews, retention analysis, DEI initiatives, immigration and visa sponsorship coordination, team-health surveys. Ensures the lab attracts and retains the best minds in AI.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        // index 17
        name: "Gabriel Souza",
        role: "Head of Legal & Policy",
        title: "Head of Legal & Policy",
        department: "legal",
        capabilities: "AI-regulation monitoring and compliance (EU AI Act, US executive orders), data-licensing and training-data legal review, intellectual-property strategy (model weights, API terms), customer-contract negotiation (enterprise, government), privacy-policy and acceptable-use-policy drafting, open-source licensing decisions, government-affairs and congressional engagement, responsible-disclosure framework, export-control compliance. The legal shield for a company operating on the frontier of AI.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
    ],
    goals: [
      {
        title: "Train and ship the next frontier model",
        description: "Pre-training and post-training research teams collaborate with infrastructure engineering to train, evaluate, red-team, and deploy the next generation model. Target state-of-the-art benchmarks while maintaining safety.",
      },
      {
        title: "Build a world-class developer platform",
        description: "Product, Engineering, and Design collaborate to deliver a best-in-class API, playground, SDKs, and documentation. Measure developer satisfaction, time-to-first-token, and platform reliability (99.9% uptime).",
      },
      {
        title: "Advance AI safety and alignment",
        description: "Safety research scientist leads red-teaming, alignment research, and responsible-deployment processes. Every model release must pass safety evaluation. Publish safety research openly.",
      },
      {
        title: "Grow developer adoption and revenue",
        description: "Marketing, DevRel, and Product drive developer awareness and adoption. Track MAU, API call volume, revenue growth, and developer NPS. Build a thriving open-source and community ecosystem.",
      },
      {
        title: "Recruit and retain top AI talent",
        description: "Head of People builds a world-class talent pipeline for ML researchers, research engineers, and infrastructure engineers. Maintain competitive compensation, publish cutting-edge research, and foster an intellectually stimulating culture.",
      },
      {
        title: "Navigate the evolving AI regulatory landscape",
        description: "Legal & Policy team monitors global AI regulation, ensures compliance, manages data-licensing risks, and engages constructively with policymakers. Proactively build trust through transparency.",
      },
    ],
  },

  // ── Digital Agency ────────────────────────────────────────────────────
  // A full-service digital agency that designs, builds, and markets
  // digital products for clients.
  {
    id: "digital-agency",
    name: "Full-Service Digital Agency",
    description: "A 14-agent digital agency with Creative, Development, Strategy, and Account Management teams. Built for delivering end-to-end client projects: branding, web development, digital marketing, and ongoing optimization.",
    icon: "PaintBrush",
    departments: [
      { id: "executive", name: "Leadership", description: "Agency leadership, business development, and client-portfolio management." },
      { id: "design", name: "Creative & Design", description: "Brand identity, visual design, UX, motion graphics, and creative direction." },
      { id: "engineering", name: "Development", description: "Full-stack web development, CMS integration, e-commerce builds, and DevOps." },
      { id: "marketing", name: "Digital Marketing", description: "SEO, paid media, social media, email marketing, and analytics." },
      { id: "product", name: "Strategy & Content", description: "Client strategy, content production, copywriting, and project management." },
      { id: "operations", name: "Operations", description: "Resource planning, process management, and quality assurance." },
    ],
    agents: [
      // ── Leadership (0-1) ──
      {
        // index 0
        name: "Isabelle Fontaine",
        role: "Managing Director",
        title: "Managing Director",
        department: "executive",
        capabilities: "Agency P&L management, new-business pitches and proposals, client-portfolio oversight, agency positioning and brand, team hiring and culture, partnership development, industry networking, pricing strategy, executive client relationships. Runs the agency and wins new business.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 1
        name: "Victor Nascimento",
        role: "Account Director",
        title: "Account Director",
        department: "executive",
        capabilities: "Client-relationship management across all active accounts, scope and SOW negotiation, project-budget tracking, client status-meeting facilitation, cross-team coordination for deliverables, change-request management, client-satisfaction surveys, renewal and upsell conversations, conflict resolution. The primary client contact and internal advocate for client needs.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },

      // ── Creative & Design (2-4) ──
      {
        // index 2
        name: "Saoirse O'Brien",
        role: "Creative Director",
        title: "Creative Director",
        department: "design",
        capabilities: "Creative-concept development, brand-identity systems (logo, typography, color, voice), campaign creative direction, pitch-deck visual storytelling, team creative-review and feedback, trend forecasting, client-presentation of creative work, quality-bar enforcement across all visual output. Sets the creative vision and ensures every deliverable is on brand.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 3
        name: "Mateo Cruz",
        role: "UX/UI Designer",
        title: "Senior UX/UI Designer",
        department: "design",
        capabilities: "User-research interviews and synthesis, wireframing and information architecture, UI design in Figma, responsive-design specifications, design-system creation, prototype-testing facilitation, accessibility review, developer-handoff documentation (Zeplin, Figma Dev Mode), animation and micro-interaction design. Turns research into beautiful, usable interfaces.",
        reportsToIndex: 2,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
      {
        // index 4
        name: "Yuki Aoyama",
        role: "Motion & Visual Designer",
        title: "Motion & Visual Designer",
        department: "design",
        capabilities: "Motion-graphics production (After Effects, Lottie), social-media visual assets, presentation design, infographic creation, video editing and post-production, brand-collateral design (business cards, decks, one-pagers), illustration, photo editing, asset-library management. Produces scroll-stopping visual content across all formats.",
        reportsToIndex: 2,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 140,
      },

      // ── Development (5-7) ──
      {
        // index 5
        name: "Nadia Kowalczyk",
        role: "Technical Director",
        title: "Technical Director",
        department: "engineering",
        capabilities: "Technical architecture for client projects, technology-stack selection, development-estimate creation, code-review and quality standards, CMS platform evaluation (WordPress, Sanity, Contentful), hosting and deployment strategy, performance optimization, client technical consulting, developer mentoring. The technical decision-maker for every build.",
        reportsToIndex: 0,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 220,
      },
      {
        // index 6
        name: "Kwame Asante",
        role: "Full-Stack Developer",
        title: "Senior Full-Stack Developer",
        department: "engineering",
        capabilities: "React/Next.js and Vue development, headless-CMS integration, e-commerce platform builds (Shopify, WooCommerce), custom API development, database design, third-party integration (payment gateways, CRM, analytics), responsive implementation, SEO technical markup, performance optimization, automated testing. Builds production-ready websites and web applications.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 7
        name: "Elina Koskinen",
        role: "Frontend Developer",
        title: "Frontend Developer",
        department: "engineering",
        capabilities: "HTML/CSS/JavaScript implementation, CSS animation and transitions, Tailwind and SCSS, design-to-code translation, cross-browser and cross-device testing, WordPress theme customization, page-speed optimization, Google Tag Manager setup, analytics snippet integration, A/B test implementation. Turns design comps into pixel-perfect, performant web pages.",
        reportsToIndex: 5,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 180,
      },

      // ── Digital Marketing (8-10) ──
      {
        // index 8
        name: "Tariq Benali",
        role: "Head of Digital",
        title: "Head of Digital Marketing",
        department: "marketing",
        capabilities: "Integrated digital-marketing strategy, channel-budget allocation, campaign planning and performance review, marketing-tech stack management (HubSpot, Google Analytics 4, Hotjar), client reporting and insights, team mentoring, pitch support for new-business proposals. Orchestrates all digital-marketing efforts for client accounts.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 9
        name: "Jessica Torres",
        role: "SEO & Content Specialist",
        title: "SEO & Content Specialist",
        department: "marketing",
        capabilities: "Technical SEO audits, keyword research and clustering (Ahrefs, Semrush), on-page optimization, content-brief creation, link-building strategy, local SEO, Google Search Console monitoring, schema markup implementation, content-performance reporting, competitor SEO analysis. Drives organic traffic and search visibility for clients.",
        reportsToIndex: 8,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
      {
        // index 10
        name: "Ryan Gallagher",
        role: "Paid Media Specialist",
        title: "Paid Media Specialist",
        department: "marketing",
        capabilities: "Google Ads (Search, Display, Shopping, Performance Max), Meta Ads, LinkedIn Ads, programmatic buying, bid-strategy optimization, audience segmentation and retargeting, conversion tracking and attribution, ad-creative testing, budget pacing, monthly performance reporting. Manages paid campaigns to hit CPA and ROAS targets.",
        reportsToIndex: 8,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },

      // ── Strategy & Content (11-12) ──
      {
        // index 11
        name: "Ananya Chakraborty",
        role: "Strategy Lead",
        title: "Digital Strategy Lead",
        department: "product",
        capabilities: "Discovery workshops and stakeholder interviews, competitive-landscape analysis, customer-persona development, user-journey mapping, content strategy and editorial calendars, conversion-funnel design, analytics setup and KPI definition, quarterly strategy reviews, pitch-deck strategy sections. Defines the strategic foundation that all creative and development work builds on.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 12
        name: "Liam O'Sullivan",
        role: "Copywriter",
        title: "Senior Copywriter",
        department: "product",
        capabilities: "Website copywriting (headlines, body, CTAs), brand-voice development, tagline and naming workshops, blog-post and article authorship, email-campaign copy, social-media caption writing, ad-copy variations for A/B testing, SEO-informed copywriting, editing and proofreading, tone-of-voice guidelines. Crafts words that convert, inform, and inspire.",
        reportsToIndex: 11,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },

      // ── Operations (13) ──
      {
        // index 13
        name: "Sandra Muller",
        role: "Project Manager",
        title: "Senior Project Manager",
        department: "operations",
        capabilities: "Project planning and timeline creation, resource allocation across concurrent client projects, Asana/Monday/ClickUp workflow management, sprint facilitation, budget tracking and profitability analysis, risk identification and mitigation, client status reports, internal retrospectives, QA process coordination, scope-change documentation. Keeps every project on time, on budget, and on scope.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 150,
      },
    ],
    goals: [
      {
        title: "Win and deliver flagship client projects",
        description: "Pitch, scope, and deliver end-to-end digital projects (brand identity, website, marketing campaigns) for key clients. Measure success by client satisfaction, on-time delivery, and project profitability.",
      },
      {
        title: "Build repeatable creative and development processes",
        description: "Establish standardized workflows for discovery, design, development, and launch. Create reusable templates, component libraries, and process documentation that improve quality and reduce delivery time.",
      },
      {
        title: "Grow retainer revenue through digital marketing results",
        description: "Drive measurable marketing results (traffic, leads, revenue) for clients to convert project work into ongoing retainers. Track and report on SEO, paid media, and social KPIs monthly.",
      },
      {
        title: "Establish the agency as a thought leader",
        description: "Publish case studies, blog posts, and social content showcasing the agency's work and expertise. Win industry awards, speak at conferences, and build a recognizable agency brand.",
      },
    ],
  },

  // ── B2B SaaS Company ──────────────────────────────────────────────────
  // A product-led B2B SaaS company with the complete set of functions
  // needed to build, sell, and support a subscription software product.
  {
    id: "saas-company",
    name: "B2B SaaS Company",
    description: "A 20-agent B2B SaaS company with Engineering, Product, Sales, Marketing, Customer Success, and Finance teams. Built for the full SaaS lifecycle: build the product, acquire customers, drive adoption, and maximize net revenue retention.",
    icon: "CloudArrowUp",
    departments: [
      { id: "executive", name: "Executive Team", description: "Company strategy, fundraising, and cross-functional leadership." },
      { id: "engineering", name: "Engineering", description: "Product development, infrastructure, quality assurance, and data engineering." },
      { id: "product", name: "Product", description: "Product strategy, roadmap, feature specification, and analytics." },
      { id: "design", name: "Design", description: "User experience research, UI design, and design-system management." },
      { id: "marketing", name: "Marketing", description: "Demand generation, content, product marketing, and developer relations." },
      { id: "sales", name: "Sales", description: "Pipeline generation, enterprise sales, and partnerships." },
      { id: "customer_support", name: "Customer Success & Support", description: "Customer onboarding, retention, technical support, and expansion." },
      { id: "finance", name: "Finance", description: "SaaS metrics, billing operations, financial planning, and investor relations." },
      { id: "hr", name: "People", description: "Recruiting, onboarding, culture, and people operations." },
    ],
    agents: [
      // ── Executive (0-1) ──
      {
        // index 0
        name: "Nathan Cross",
        role: "CEO",
        title: "Chief Executive Officer",
        department: "executive",
        capabilities: "Company vision and go-to-market strategy, fundraising and investor relations, board management, executive hiring, pricing and packaging decisions, strategic partnerships, company culture, crisis management. The ultimate owner of the company's trajectory from seed to scale.",
        reportsToIndex: null,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 1
        name: "Samira Rostami",
        role: "CTO",
        title: "Chief Technology Officer",
        department: "executive",
        capabilities: "Technical vision and platform architecture, build-vs-buy decisions, engineering hiring bar, security posture, infrastructure cost management, technology radar, API strategy, integration ecosystem design. Owns the technical foundation that the entire business runs on.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 240,
      },

      // ── Engineering (2-6) ──
      {
        // index 2
        name: "Derek Johansson",
        role: "VP Engineering",
        title: "Vice President of Engineering",
        department: "engineering",
        capabilities: "Engineering management across product and platform teams, sprint planning and delivery metrics, technical-debt prioritization, code-review standards, incident response, engineering hiring pipeline, on-call scheduling, engineering budget management, architectural-review facilitation. Ensures engineering ships reliably every sprint.",
        reportsToIndex: 1,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 210,
      },
      {
        // index 3
        name: "Priya Venkatesh",
        role: "Senior Backend Engineer",
        title: "Senior Backend Engineer",
        department: "engineering",
        capabilities: "Multi-tenant SaaS backend development, REST and GraphQL API design, PostgreSQL and Redis, background-job processing (Sidekiq, BullMQ), webhook delivery systems, RBAC and team-management features, billing integration (Stripe), audit-logging, rate limiting, database migration management, comprehensive testing. Builds the core SaaS platform backend.",
        reportsToIndex: 2,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 250,
      },
      {
        // index 4
        name: "Luis Mendoza",
        role: "Senior Frontend Engineer",
        title: "Senior Frontend Engineer",
        department: "engineering",
        capabilities: "React/Next.js SaaS application development, TypeScript, state management (Zustand, React Query), data-table and dashboard components, real-time collaboration features, onboarding flow implementation, settings and admin panels, design-system consumption, accessibility (WCAG 2.2), Playwright E2E testing, performance optimization. Builds the product interface customers use every day.",
        reportsToIndex: 2,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 240,
      },
      {
        // index 5
        name: "Anika Bergman",
        role: "Platform Engineer",
        title: "Senior Platform Engineer",
        department: "engineering",
        capabilities: "CI/CD pipeline (GitHub Actions), Infrastructure-as-Code (Terraform), Kubernetes cluster management, observability (Datadog, Sentry), secrets management, zero-downtime deployment, auto-scaling configuration, database backup and disaster recovery, SOC2 infrastructure controls, cost-per-customer analysis. Keeps the SaaS platform available, secure, and cost-efficient.",
        reportsToIndex: 2,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 230,
      },
      {
        // index 6
        name: "Tomoko Sato",
        role: "QA Engineer",
        title: "Quality Assurance Engineer",
        department: "engineering",
        capabilities: "Test strategy for SaaS (multi-tenant edge cases, billing scenarios, RBAC permutations), test-automation framework (Playwright, Jest), CI quality gates, regression-test suites, performance load testing, accessibility testing, release-readiness checklists, bug-triage, cross-browser testing matrix. Quality gatekeeper for every release.",
        reportsToIndex: 2,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 180,
      },

      // ── Product & Design (7-9) ──
      {
        // index 7
        name: "Rachel Abrams",
        role: "VP Product",
        title: "Vice President of Product",
        department: "product",
        capabilities: "Product vision and quarterly roadmap, pricing and packaging strategy, competitive analysis and feature benchmarking, PRD authorship, customer-interview synthesis, product analytics (Amplitude, Mixpanel), A/B test design, launch-readiness reviews, product-led growth strategy (free trial, onboarding, activation), integration-ecosystem prioritization. Decides what the product becomes next.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 8
        name: "Jake Morrison",
        role: "Product Manager",
        title: "Product Manager",
        department: "product",
        capabilities: "Feature specification and user-story writing, sprint backlog grooming, customer-feedback triage (Productboard), data analysis for feature decisions, A/B test configuration, release-notes and changelog, beta-program management, competitive feature mapping, integration-partner coordination, go-to-market alignment with marketing. Turns user needs into shipped features.",
        reportsToIndex: 7,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
      {
        // index 9
        name: "Chloe Laurent",
        role: "Product Designer",
        title: "Senior Product Designer",
        department: "design",
        capabilities: "User research (interviews, surveys, analytics review), wireframing and prototyping in Figma, UI design and design-system stewardship, usability testing, information architecture, onboarding-flow optimization, dashboard and data-visualization design, accessibility compliance, developer-handoff documentation. Ensures the product is intuitive and delightful to use.",
        reportsToIndex: 7,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },

      // ── Marketing (10-12) ──
      {
        // index 10
        name: "Ava Richardson",
        role: "VP Marketing",
        title: "Vice President of Marketing",
        department: "marketing",
        capabilities: "Integrated marketing strategy, demand-generation funnel design, marketing-budget allocation, brand positioning and messaging, marketing-ops tooling (HubSpot, Segment), campaign ROI analysis, product-marketing launch plans, competitive battlecard creation, analyst-relations. Drives pipeline and brand for the SaaS product.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 190,
      },
      {
        // index 11
        name: "Benjamin Hart",
        role: "Content Marketing Manager",
        title: "Content Marketing Manager",
        department: "marketing",
        capabilities: "Blog strategy and authorship, SEO keyword research and optimization, e-book and white-paper production, case-study writing, email-newsletter management, webinar content, social-media content calendar, thought-leadership ghostwriting, content-performance analytics. Produces content that drives organic traffic and educates buyers.",
        reportsToIndex: 10,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },
      {
        // index 12
        name: "Daria Volkov",
        role: "Growth & Demand Gen Manager",
        title: "Growth & Demand Generation Manager",
        department: "marketing",
        capabilities: "Paid-acquisition campaigns (Google, LinkedIn, Meta), marketing-automation workflows (lead scoring, nurture sequences), landing-page optimization, webinar and event marketing, referral-program management, product-led growth experiments (free-trial optimization, in-app messaging), attribution modeling, MQL-to-SQL conversion tracking. Fills the pipeline with qualified leads.",
        reportsToIndex: 10,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 160,
      },

      // ── Sales (13-15) ──
      {
        // index 13
        name: "Carter Ellison",
        role: "VP Sales",
        title: "Vice President of Sales",
        department: "sales",
        capabilities: "Sales strategy and annual quota planning, sales-team hiring and enablement, pipeline inspection and forecasting, deal-desk governance, discount-approval authority, territory planning, compensation-plan design, sales-engineering coordination, quarterly business reviews, competitive win/loss analysis. Owns the revenue number.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 200,
      },
      {
        // index 14
        name: "Nina Johansson",
        role: "Enterprise Account Executive",
        title: "Enterprise Account Executive",
        department: "sales",
        capabilities: "Enterprise sales cycle management, multi-stakeholder deal navigation, custom demo and POC coordination, value-engineering and ROI presentations, security-questionnaire completion, contract negotiation, CRM pipeline accuracy, champion-building within accounts, cross-sell and upsell in install base, reference-customer development. Closes large deals by understanding buyer pain.",
        reportsToIndex: 13,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 15
        name: "Travis Chen",
        role: "SDR Lead",
        title: "Sales Development Representative Lead",
        department: "sales",
        capabilities: "Outbound-prospecting strategy and sequence design, cold-email and cold-call cadences, lead-qualification framework (BANT/MEDDPICC), CRM data enrichment (ZoomInfo, Apollo), meeting-booked metrics, SDR-to-AE handoff process, intent-signal monitoring, account-based outreach coordination, objection-handling scripts. Fills the top of the pipeline with qualified opportunities.",
        reportsToIndex: 13,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 130,
      },

      // ── Customer Success & Support (16-18) ──
      {
        // index 16
        name: "Miriam Okafor",
        role: "VP Customer Success",
        title: "Vice President of Customer Success",
        department: "customer_support",
        capabilities: "Customer-retention strategy, health-score model design, churn-risk intervention, QBR facilitation, NPS and CSAT program management, onboarding-program design, expansion-revenue targets, voice-of-customer reporting to product, support-team management, customer-advisory-board coordination. Ensures customers adopt the product and renew.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 180,
      },
      {
        // index 17
        name: "Alex Petridis",
        role: "Customer Success Manager",
        title: "Customer Success Manager",
        department: "customer_support",
        capabilities: "Post-sale onboarding and implementation support, product-adoption tracking, proactive check-ins with assigned accounts, renewal forecasting, expansion and upsell identification, customer-training sessions, internal-champion cultivation, feature-request aggregation, success-plan creation, reference-customer development. The customer's partner inside the company.",
        reportsToIndex: 16,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 140,
      },
      {
        // index 18
        name: "Rina Tanaka",
        role: "Support Engineer",
        title: "Technical Support Engineer",
        department: "customer_support",
        capabilities: "Tier-1 and Tier-2 technical support, bug reproduction and engineering escalation, knowledge-base article creation, Zendesk/Intercom workflow management, SLA-adherence tracking, API-integration troubleshooting, customer-facing incident communication, internal runbook creation, canned-response optimization. Resolves customer issues quickly and feeds patterns back to engineering.",
        reportsToIndex: 16,
        connectorPreference: "codex_local",
        budgetMonthlyUsd: 140,
      },

      // ── Finance & People (19) ──
      {
        // index 19
        name: "Henrik Larsen",
        role: "Head of Finance",
        title: "Head of Finance",
        department: "finance",
        capabilities: "SaaS-metrics tracking (ARR, MRR, NRR, churn, CAC, LTV), financial planning and modeling, billing-operations management (Stripe, invoicing), budget-vs-actual reporting, fundraising data-room preparation, revenue recognition (ASC 606), expense-policy enforcement, vendor-contract negotiation, board-financial reporting, cash-runway monitoring. The financial engine of the SaaS business.",
        reportsToIndex: 0,
        connectorPreference: "claude_local",
        budgetMonthlyUsd: 170,
      },
    ],
    goals: [
      {
        title: "Ship a product customers love",
        description: "Engineering, Product, and Design collaborate to build, ship, and iterate on the core SaaS product. Measure success by product adoption, feature usage, and customer satisfaction (NPS > 50).",
      },
      {
        title: "Build a repeatable sales engine",
        description: "Sales, Marketing, and Customer Success create a predictable pipeline-to-revenue machine. Track CAC payback period, MQL-to-SQL conversion, and sales-cycle length. Achieve predictable quarterly revenue growth.",
      },
      {
        title: "Maximize net revenue retention",
        description: "Customer Success drives onboarding, adoption, and expansion. Target net revenue retention above 120% by reducing churn, increasing product adoption, and identifying upsell opportunities within the install base.",
      },
      {
        title: "Drive efficient demand generation",
        description: "Marketing generates qualified pipeline through content, paid acquisition, and product-led growth. Track marketing-sourced pipeline, content engagement, and free-trial-to-paid conversion rates.",
      },
      {
        title: "Build scalable engineering infrastructure",
        description: "Platform engineering delivers CI/CD, monitoring, auto-scaling, and SOC2 compliance. Target 99.95% uptime, sub-200ms API latency at p95, and deployment frequency of multiple times per day.",
      },
      {
        title: "Achieve efficient growth economics",
        description: "Finance and leadership monitor unit economics (CAC:LTV > 3:1, CAC payback < 18 months, gross margin > 75%). Maintain financial discipline while investing aggressively in growth.",
      },
    ],
  },
];

export function getTemplate(id: string): CompanyTemplate | undefined {
  return COMPANY_TEMPLATES.find(t => t.id === id);
}
