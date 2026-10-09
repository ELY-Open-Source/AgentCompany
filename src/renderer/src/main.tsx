import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { FailureToasts } from "./shared/FailureToasts";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/components.css";
import "./overlays.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <FailureToasts />
  </React.StrictMode>,
);
