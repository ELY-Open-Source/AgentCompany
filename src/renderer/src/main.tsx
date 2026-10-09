import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { FailureToasts } from "./shared/FailureToasts";
import { ErrorBoundary } from "./shared/ErrorBoundary";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/components.css";
import "./overlays.css";
import "./styles/pixel.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
    <FailureToasts />
  </React.StrictMode>,
);
