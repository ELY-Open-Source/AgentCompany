import { Component, type ErrorInfo, type ReactNode } from "react";
import { GameOver } from "./GameOver";
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
      <div style={{ padding: 24 }}>
        <GameOver
          title={page ? t("This page could not be shown.") : t("AgentCompany hit an error it could not recover from here.")}
          error={error.message}
          note={page ? t("The rest of the app still works; Continue tries this page again.") : t("Continue reloads the window; your data is kept.")}
          onContinue={page ? () => this.setState({ error: null }) : () => window.location.reload()}
        />
      </div>
    );
  }
}
