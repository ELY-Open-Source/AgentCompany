"use client";

import { useEffect, useState } from "react";
import { Menu } from "reicon-react/icons/Menu";
import { Xmark } from "reicon-react/icons/Xmark";
import { Container } from "../ui/container";
import { Button } from "../ui/button";
import { IconMark } from "../brand/icon-mark";
import { ThemeToggle } from "../theme/theme-toggle";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <nav
      className={[
        "enter-nav sticky top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      ].join(" ")}
    >
      <Container>
        <div className="flex h-16 items-center justify-between">
          <a href="#" className="flex shrink-0 items-center gap-2.5" aria-label="AgentCompany home">
            <IconMark size={28} />
            <span className="text-lg font-medium tracking-[-0.02em] text-[var(--text)]">AgentCompany</span>
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                className="eyebrow rounded-full px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              >
                {label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <Button href="#download" size="sm">
              Download
            </Button>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[var(--text)] transition-colors hover:bg-[var(--panel-soft)]"
            >
              {mobileOpen ? <Xmark size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </Container>

      <div
        id="mobile-nav"
        className={[
          "overflow-hidden border-b transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:hidden",
          mobileOpen ? "max-h-72 border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-xl" : "max-h-0 border-transparent",
        ].join(" ")}
      >
        <Container className="flex flex-col gap-1 pb-4 pt-1">
          {navLinks.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className="eyebrow rounded-lg px-3 py-2.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--panel-soft)] hover:text-[var(--text)]"
            >
              {label}
            </a>
          ))}
          <Button href="#download" size="sm" className="mt-2 w-full">
            Download
          </Button>
        </Container>
      </div>
    </nav>
  );
}
