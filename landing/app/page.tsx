import { DownloadSection } from "../components/download-section";
import { FAQ } from "../components/faq";
import { Features } from "../components/features";
import { Footer } from "../components/footer";
import { Hero } from "../components/hero";
import { HowItWorks } from "../components/how-it-works";
import { Navbar } from "../components/navbar";

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
        <Features />
        <HowItWorks />
        <FAQ />
        <DownloadSection />
      </main>

      <Footer />
    </>
  );
}
