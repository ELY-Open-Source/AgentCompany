"use client";

import { motion } from "framer-motion";

const features = [
  {
    number: "01",
    title: "One-Click Company Creation",
    description:
      "Name your company, describe your mission, connect your AI runtime, and launch. Your first agents start working in under a minute.",
    image: "/screenshots/Onboarding.jpeg",
    imageAlt: "Company creation onboarding flow with mission and runtime setup",
    imageLeft: true,
  },
  {
    number: "02",
    title: "Self-Organizing Teams",
    description:
      "Your AI CEO builds the org chart. It identifies the roles needed, hires specialists, and creates reporting lines — all from a single goal.",
    image: "/screenshots/Auto-OrgChart-Team.jpeg",
    imageAlt: "AI-generated org chart showing self-organizing team structure",
    imageLeft: false,
  },
  {
    number: "03",
    title: "Autonomous Task Management",
    description:
      "Goals break down into tasks automatically. Agents pick up work, report progress, and escalate blockers — you decide when to step in.",
    image: "/screenshots/Auto-Task.jpeg",
    imageAlt: "Autonomous task board with agents managing work items",
    imageLeft: true,
  },
  {
    number: "04",
    title: "Real-Time Agent Communication",
    description:
      "Agents communicate through department channels and direct messages. Watch strategic decisions happen in real time, like a Slack workspace you built.",
    image: "/screenshots/AI-Internal-Realtime-Message.jpeg",
    imageAlt: "Real-time messaging between AI agents in department channels",
  },
  {
    number: "05",
    title: "Human-in-the-Loop Approvals",
    description:
      "Stay in control. Critical decisions surface for your review. Approve, reject, or redirect — your company respects the chain of command.",
    image: "/screenshots/Approval-by-Human.jpeg",
    imageAlt: "Approval interface showing human review of agent decisions",
  },
  {
    number: "06",
    title: "AI Document Generation",
    description:
      "Business plans, marketing strategies, technical specs — agents draft and iterate on real deliverables, stored in your document center.",
    image: "/screenshots/Document-Center.jpeg",
    imageAlt: "Document center with AI-generated business deliverables",
  },
];

function FeaturePair({ feature }: { feature: (typeof features)[number] }) {
  const { number, title, description, image, imageAlt, imageLeft } = feature;
  const ease: [number, number, number, number] = [0.16, 1, 0.3, 1];

  const media = (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: imageLeft ? -60 : 60 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease } },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className={`order-2 ${imageLeft ? "lg:order-1" : "lg:order-2"}`}
    >
      <div className="rounded-2xl overflow-hidden shadow-[0_4px_32px_-8px_rgba(0,0,0,0.1)] border border-[var(--border)] bg-[var(--panel)] transition-shadow duration-500 hover:shadow-[0_8px_48px_-12px_rgba(0,0,0,0.15)]">
        <img src={image} alt={imageAlt} width="1920" height="1080" className="w-full h-auto block" loading="lazy" />
      </div>
    </motion.div>
  );

  const copy = (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: imageLeft ? 60 : -60 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease, delay: 0.1 } },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className={`flex flex-col justify-center order-1 ${imageLeft ? "lg:order-2" : "lg:order-1"}`}
    >
      <span className="font-mono text-[5rem] lg:text-[6rem] font-bold leading-none text-[var(--accent)] opacity-[0.07] select-none -mb-10 lg:-mb-12">
        {number}
      </span>
      <div className="relative">
        <div className="flex items-center gap-3 mb-4">
          <span className="block w-2 h-2 rounded-full bg-[var(--accent)]" />
          <span className="font-mono text-sm text-[var(--muted)]">{number}</span>
        </div>
        <h2 className="text-2xl lg:text-[1.875rem] font-bold text-[var(--text)] mb-4 tracking-tight">{title}</h2>
        <p className="text-[var(--muted-strong)] leading-relaxed text-base lg:text-lg">{description}</p>
      </div>
    </motion.div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
      {media}
      {copy}
    </div>
  );
}

export function Features() {
  return (
    <section
      id="features"
      className="py-24 lg:py-40"
      style={{ background: "linear-gradient(180deg, transparent 0%, var(--section-alt) 30%, var(--section-alt) 70%, transparent 100%)" }}
    >
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-24 lg:mb-36"
        >
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--accent)] mb-5 block font-medium">
            Features
          </span>
          <h2 className="font-serif text-[clamp(2rem,1.5rem+2.5vw,3.25rem)] tracking-[-0.01em] text-[var(--text)]">
            Your Company, Under the Hood
          </h2>
        </motion.div>

        <div className="space-y-24 lg:space-y-40">
          {features.slice(0, 3).map((feature) => (
            <FeaturePair key={feature.number} feature={feature} />
          ))}
        </div>

        <motion.div
          className="mt-24 lg:mt-40 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.12 },
            },
          }}
        >
          {features.slice(3).map((feature) => (
            <motion.div
              key={feature.number}
              variants={{
                hidden: { opacity: 0, y: 32 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
                },
              }}
              className="group bg-[var(--panel)] rounded-2xl border border-[var(--border)] overflow-hidden transition-all duration-300 hover:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12)] hover:-translate-y-1.5"
            >
              <div className="overflow-hidden">
                <img
                  src={feature.image}
                  alt={feature.imageAlt}
                  width="640"
                  height="360"
                  className="w-full h-auto block transition-transform duration-500 group-hover:scale-[1.03]"
                  loading="lazy"
                />
              </div>
              <div className="p-6 lg:p-7">
                <div className="flex items-center gap-3 mb-3">
                  <span className="block w-2 h-2 rounded-full bg-[var(--accent)]" />
                  <span className="font-mono text-sm text-[var(--muted)]">{feature.number}</span>
                </div>
                <h2 className="text-lg font-bold text-[var(--text)] mb-2 tracking-tight">{feature.title}</h2>
                <p className="text-sm text-[var(--muted-strong)] leading-relaxed">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
