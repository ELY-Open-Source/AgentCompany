import { DownloadSection } from "../components/sections/download-section";
import { FAQ } from "../components/sections/faq";
import { Features } from "../components/sections/features";
import { Footer } from "../components/layout/footer";
import { Hero } from "../components/sections/hero";
import { HowItWorks } from "../components/sections/how-it-works";
import { Navbar } from "../components/layout/navbar";
import { Runtimes } from "../components/sections/runtimes";

export default function Page() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-[var(--accent)] focus:text-[var(--text-on-accent)] focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      <Navbar />

      <main id="main">
        <Hero />
        <Runtimes />
        <Features />
        <HowItWorks />
        <FAQ />
        <DownloadSection />
      </main>

      <Footer />
    </>
  );
}
