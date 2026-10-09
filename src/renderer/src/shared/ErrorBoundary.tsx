import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";
import { t } from "../i18n/i18n";

/** Contains a render error to the part of the app that threw, says what failed, and offers a way back; the error is logged with its component stack. */
export class ErrorBoundary extends Component<{ scope: "page" | "app"; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[render] ${this.props.scope} failed: ${error.message}`, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const page = this.props.scope === "page";
    return (
      <div role="alert" style={{ padding: 24, display: "grid", gap: 10, maxWidth: 560 }}>
        <strong>{page ? t("This page could not be shown.") : t("AgentCompany hit an error it could not recover from here.")}</strong>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-2)", wordBreak: "break-word" }}>{error.message}</div>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          {page ? t("The rest of the app still works; go to another page or try this one again.") : t("Reloading the window starts it again; your data is kept.")}
        </div>
        <div>
          {page
            ? <Button onClick={() => this.setState({ error: null })}>{t("Try again")}</Button>
            : <Button onClick={() => window.location.reload()}>{t("Reload")}</Button>}
        </div>
      </div>
    );
  }
}
