import { useState, useEffect, useCallback } from "react";
import { Copy, Minus, Square, X } from "./ui/icons";
import { useT } from "../i18n";

export default function TitleBar() {
  const t = useT();
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
          aria-label={t("titlebar.minimize")}
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => void window.agentCompany.windowMinimize()}
        >
          <Minus size={14} weight="bold" />
        </button>
        <button
          type="button"
          aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={() => {
            void window.agentCompany.windowMaximize().then(refreshMaximized);
          }}
        >
          {maximized ? (
            <Copy size={12} weight="bold" />
          ) : (
            <Square size={12} weight="bold" />
          )}
        </button>
        <button
          type="button"
          aria-label={t("titlebar.close")}
          className="titlebar-button flex h-full w-[46px] items-center justify-center text-muted-foreground transition hover:bg-destructive hover:text-primary-foreground"
          onClick={() => void window.agentCompany.windowClose()}
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
