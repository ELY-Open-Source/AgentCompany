"use client";

import { useEffect, useState } from "react";
import { IconMark } from "./icon-mark";
import { ThemeToggle } from "./theme-toggle";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
  { label: "Download", href: "#download" },
];

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <nav
      className={[
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 backdrop-blur-xl",
        scrolled ? "bg-[var(--panel)]/80 border-b border-[var(--border)] shadow-sm" : "bg-transparent border-b border-transparent",
      ].join(" ")}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 shrink-0" aria-label="AgentCompany home">
            <IconMark />
            <span className="text-[var(--text)] font-serif text-xl font-normal tracking-[-0.4px]">AgentCompany</span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map(({ label, href }) => (
              <a key={href} href={href} className="text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors duration-200">
                {label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />
            <a
              href="#download"
              className="inline-flex items-center px-5 py-2 rounded-full text-sm font-medium bg-[var(--cta)] text-[var(--text-on-cta)] hover:bg-[var(--cta-hover)] hover:scale-[1.03] active:scale-[0.98] transition-all duration-200"
            >
              Download
            </a>
          </div>

          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen((current) => !current)}
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-soft)] transition-colors duration-200"
            >
              <MenuIcon open={mobileOpen} />
            </button>
          </div>
        </div>
      </div>

      <div
        id="mobile-nav-menu"
        className={[
          "md:hidden overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          mobileOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0",
        ].join(" ")}
      >
        <div className="px-4 pb-4 pt-1 space-y-1 bg-[var(--panel)]/90 backdrop-blur-xl border-b border-[var(--border)]">
          {navLinks.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-soft)] transition-colors duration-200"
            >
              {label}
            </a>
          ))}
          <a
            href="#download"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2.5 rounded-full text-sm font-medium text-center bg-[var(--cta)] text-[var(--text-on-cta)] hover:bg-[var(--cta-hover)] transition-colors duration-200 mt-2"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}
