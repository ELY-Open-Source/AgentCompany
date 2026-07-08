import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";
import { Button } from "../ui/button";
import { IconMark } from "../brand/icon-mark";
import { getTrackedDownloadHref } from "../../lib/downloads";
import { CONTACT_EMAIL, WEBSITE_URL } from "../../lib/site-constants";

type FooterLink = { label: string; href: string; external?: boolean };

const footerGroups: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "FAQ", href: "#faq" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Downloads",
    links: [
      { label: "Apple Silicon", href: getTrackedDownloadHref("macos-arm64-dmg"), external: true },
      { label: "Intel Mac", href: getTrackedDownloadHref("macos-x64-dmg"), external: true },
      { label: "Windows Installer", href: getTrackedDownloadHref("windows-universal-installer"), external: true },
      { label: "Linux x64 AppImage", href: getTrackedDownloadHref("linux-x64-appimage"), external: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Website", href: WEBSITE_URL, external: true },
      { label: "Contact", href: `mailto:${CONTACT_EMAIL}`, external: true },
      { label: "Download center", href: "#download" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[var(--footer-bg)] text-[var(--footer-text)]">
      <Container>
        <div className="border-b border-white/10 py-24 text-center md:py-32">
          <Reveal>
            <h2 className="font-display text-[clamp(2.75rem,1.8rem+4vw,5.5rem)] leading-[1] tracking-[-0.02em]">
              Launch your company now.
            </h2>
            <div className="mt-8 flex justify-center">
              <Button href="#download" variant="inverted">
                Download
              </Button>
            </div>
          </Reveal>
        </div>

        <div className="grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <a href="#" className="inline-flex items-center gap-2.5" aria-label="AgentCompany home">
              <IconMark size={28} />
              <span className="text-lg font-medium tracking-[-0.02em]">AgentCompany</span>
            </a>
            <p className="mt-4 max-w-[32ch] text-sm leading-relaxed opacity-60">
              Local-first desktop control plane for autonomous AI companies.
            </p>
          </div>

          {footerGroups.map((group) => (
            <div key={group.title}>
              <h3 className="eyebrow text-xs opacity-50">{group.title}</h3>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="text-sm opacity-75 transition-opacity hover:opacity-100"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 py-6">
          <p className="text-xs opacity-45">© {year} AgentCompany</p>
        </div>
      </Container>
    </footer>
  );
}
