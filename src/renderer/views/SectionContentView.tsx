import { AnimatePresence, motion } from "framer-motion";
import { WarningCircle } from "../components/ui/icons";
import type { SectionId } from "@shared/types";
import type { AppErrorNotice } from "../lib/desktop";
import { ErrorBoundary } from "../components/ui";
import { OrganizationSections } from "./sections/OrganizationSections";
import { ExecutionSections } from "./sections/ExecutionSections";
import { OperationsSections } from "./sections/OperationsSections";

interface SectionContentViewProps {
  section: SectionId;
  error: AppErrorNotice | null;
  pageTransition: { duration: number; ease?: readonly [number, number, number, number] } | { duration: number };
}

export function SectionContentView({ section, error, pageTransition }: SectionContentViewProps) {
  const isCommunication = section === "communication";
  return (
    <div className={`flex-1 ${isCommunication ? "flex flex-col overflow-hidden" : "overflow-auto"}`}>
      <div className={isCommunication ? "flex min-h-0 flex-1 flex-col" : "mx-auto flex w-full max-w-[1040px] flex-col px-6 py-6 lg:px-10 lg:py-8"}>

        {error ? (
          <div
            role="alert"
            className={`flex items-start gap-3 rounded-lg bg-destructive-muted px-4 py-3 text-destructive ${isCommunication ? "mx-6 mt-4" : "mb-6"}`}
          >
            <WarningCircle size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
                  {error.code}
                </span>
                <span className="min-w-0 text-[13px] font-semibold leading-5">{error.actionHint}</span>
              </div>
              <div className="mt-1 break-words text-[12px] leading-5 text-destructive/80">{error.message}</div>
            </div>
          </div>
        ) : null}

        <div className={isCommunication ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1"}>
          <ErrorBoundary>
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={pageTransition}
                className={isCommunication ? "flex min-h-0 flex-1 flex-col" : "space-y-14"}
                style={isCommunication ? { height: "100%" } : undefined}
              >
                <OrganizationSections section={section} />
                <ExecutionSections section={section} />
                <OperationsSections section={section} />
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
