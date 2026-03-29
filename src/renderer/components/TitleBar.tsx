import { useState, useEffect, useCallback } from "react";
import { Minus, Square, X } from "@phosphor-icons/react";

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(() => {
    void window.agentCompany.windowIsMaximized().then(setMaximized);
  }, []);

  useEffect(() => {
    refreshMaximized();
    const onResize = () => refreshMaximized();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [refreshMaximized]);

  return (
    <div className="titlebar-drag flex h-[32px] shrink-0 select-none items-center justify-between bg-card border-b border-border">
      <div className="flex items-center gap-0.5 pl-3">
        <span className="text-[12px] font-semibold tracking-[-0.01em] text-muted-foreground">
          AgentCompany
        </span>
      </div>

      <div className="flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => void window.agentCompany.windowMinimize()}
        >
          <Minus size={14} weight="bold" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => {
            void window.agentCompany.windowMaximize();
            setTimeout(refreshMaximized, 50);
          }}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2" y="0" width="8" height="8" rx="1" />
              <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--card)" />
              <rect x="0" y="2" width="8" height="8" rx="1" />
            </svg>
          ) : (
            <Square size={12} weight="bold" />
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-red-500 hover:text-white"
          onClick={() => void window.agentCompany.windowClose()}
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
