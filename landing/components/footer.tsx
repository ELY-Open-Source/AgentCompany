import { AsciiBackground } from "./ascii-background";
import { IconMark } from "./icon-mark";
import { CONTACT_EMAIL, WEBSITE_URL } from "./site-constants";
import { platformDownloads } from "./release-links.generated";
import { ThemeToggle } from "./theme-toggle";

function findAsset(platformId: string, assetId: string) {
  const platform = platformDownloads.find((entry) => entry.id === platformId);
  if (!platform) {
    throw new Error(`Missing platform download entry for ${platformId}`);
  }
  const asset = platform.assets.find((entry) => entry.id === assetId);
  if (!asset) {
    throw new Error(`Missing asset ${assetId} for ${platformId}`);
  }
  return asset.href;
}

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "FAQ", href: "#faq" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Downloads",
    links: [
      { label: "Apple Silicon", href: findAsset("macos", "macos-arm64-dmg"), external: true },
      { label: "Intel Mac", href: findAsset("macos", "macos-x64-dmg"), external: true },
      { label: "Windows Installer", href: findAsset("windows", "windows-universal-installer"), external: true },
      { label: "Linux x64 AppImage", href: findAsset("linux", "linux-x64-appimage"), external: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Website", href: WEBSITE_URL, external: true },
      { label: "Contact", href: `mailto:${CONTACT_EMAIL}`, external: true },
      { label: "Download Center", href: "#download" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-[var(--border)] overflow-hidden">
      <AsciiBackground cssVar="--accent" baseOpacity={0.04} speed={0.5} />

      <div className="relative z-10 mx-auto max-w-6xl px-6 lg:px-8 pt-16 lg:pt-20 pb-10 lg:pb-12">
        <div className="flex flex-col lg:flex-row gap-y-12 gap-x-8">
          <div className="shrink-0 lg:w-64 mb-4 lg:mb-0">
            <a href="#" className="inline-flex items-center gap-2.5" aria-label="AgentCompany home">
              <IconMark size={28} />
              <span className="text-[var(--text)] font-semibold text-lg tracking-tight">AgentCompany</span>
            </a>
            <p className="mt-4 text-sm leading-relaxed text-[var(--muted)] max-w-xs">
              Local-first desktop control plane for autonomous AI companies.
            </p>
          </div>

          <div className="flex-1 flex flex-wrap gap-y-12 gap-x-8 justify-between">
            {footerGroups.map((group) => (
              <div key={group.title} className="min-w-[120px]">
                <h3 className="text-sm font-semibold text-[var(--text)] tracking-tight mb-4">{group.title}</h3>
                <ul className="space-y-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors duration-200"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 lg:mt-16 pt-6 border-t border-[var(--border)]" />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
            <span>© {year} AgentCompany</span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              Cloudflare-hosted desktop builds
            </span>
          </div>

          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
