/** Toolkit display names and logo.dev domains. */
const BRANDS: Record<string, { name: string; domain: string }> = {
  airtable: { name: "Airtable", domain: "airtable.com" },
  attio: { name: "Attio", domain: "attio.com" },
  cal: { name: "Cal.com", domain: "cal.com" },
  calendly: { name: "Calendly", domain: "calendly.com" },
  canva: { name: "Canva", domain: "canva.com" },
  cloudflare: { name: "Cloudflare", domain: "cloudflare.com" },
  discord: { name: "Discord", domain: "discord.com" },
  elevenlabs: { name: "ElevenLabs", domain: "elevenlabs.io" },
  figma: { name: "Figma", domain: "figma.com" },
  firecrawl: { name: "Firecrawl", domain: "firecrawl.dev" },
  github: { name: "GitHub", domain: "github.com" },
  gmail: { name: "Gmail", domain: "gmail.com" },
  google_analytics: { name: "Google Analytics", domain: "analytics.google.com" },
  googleads: { name: "Google Ads", domain: "ads.google.com" },
  googlecalendar: { name: "Google Calendar", domain: "calendar.google.com" },
  googledocs: { name: "Google Docs", domain: "docs.google.com" },
  googledrive: { name: "Google Drive", domain: "drive.google.com" },
  googlesheets: { name: "Google Sheets", domain: "sheets.google.com" },
  googletasks: { name: "Google Tasks", domain: "tasks.google.com" },
  heygen: { name: "HeyGen", domain: "heygen.com" },
  junglescout: { name: "Jungle Scout", domain: "junglescout.com" },
  linear: { name: "Linear", domain: "linear.app" },
  linkedin: { name: "LinkedIn", domain: "linkedin.com" },
  mailchimp: { name: "Mailchimp", domain: "mailchimp.com" },
  monday: { name: "Monday", domain: "monday.com" },
  notion: { name: "Notion", domain: "notion.so" },
  one_drive: { name: "OneDrive", domain: "onedrive.com" },
  outlook: { name: "Outlook", domain: "outlook.com" },
  perplexityai: { name: "Perplexity", domain: "perplexity.ai" },
  reddit: { name: "Reddit", domain: "reddit.com" },
  salesforce: { name: "Salesforce", domain: "salesforce.com" },
  sentry: { name: "Sentry", domain: "sentry.io" },
  share_point: { name: "SharePoint", domain: "sharepoint.com" },
  shopify: { name: "Shopify", domain: "shopify.com" },
  slack: { name: "Slack", domain: "slack.com" },
  stripe: { name: "Stripe", domain: "stripe.com" },
  supabase: { name: "Supabase", domain: "supabase.com" },
  tavily: { name: "Tavily", domain: "tavily.com" },
  twitter: { name: "X", domain: "x.com" },
  whatsapp: { name: "WhatsApp", domain: "whatsapp.com" },
  zoho: { name: "Zoho", domain: "zoho.com" },
};

export function connectorDisplayName(slug: string): string {
  const brand = BRANDS[slug];
  if (brand) return brand.name;
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function connectorLogoUrl(slug: string, logoDevToken: string | null): string | null {
  const brand = BRANDS[slug];
  if (!brand || !logoDevToken) return null;
  return `https://img.logo.dev/${brand.domain}?token=${encodeURIComponent(logoDevToken)}`;
}
