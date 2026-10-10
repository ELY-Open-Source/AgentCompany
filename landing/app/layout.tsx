import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PaletteClock } from "../components/pixel";
import { description, faqs } from "../lib/content";
import { RELEASE_PAGE_URL, releaseVersion } from "../lib/release-links";
import { WEBSITE_URL } from "../lib/site-constants";

const title = "AgentCompany · Run an autonomous AI company on your desktop";

export const metadata: Metadata = {
  metadataBase: new URL(WEBSITE_URL),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: "AgentCompany",
    locale: "en_US",
    type: "website",
    images: [{ url: "/images/og.png", width: 1200, height: 630, alt: "AgentCompany in 8-bit: run an autonomous AI company on your desktop" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/images/og.png"] },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any", type: "image/x-icon" },
      { url: "/icon.png?v=2", type: "image/png" },
    ],
    apple: "/icon.png?v=2",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AgentCompany",
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS, Windows, Linux",
    softwareVersion: releaseVersion,
    url: WEBSITE_URL,
    downloadUrl: RELEASE_PAGE_URL,
    description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    inLanguage: ["en", "zh-Hans"],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer.join(" ") },
    })),
  },
];

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/FusionPixel-12px-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        <PaletteClock>{children}</PaletteClock>
      </body>
    </html>
  );
}
