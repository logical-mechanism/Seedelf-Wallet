import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { startI18n } from "../i18n";
import { App } from "./App";
import "./styles.css";

// The language the user chose, before anything is drawn: the first paint is
// already in it, so no screen is painted in English and then redrawn. Every
// locale is in the build, so this reads storage and nothing else — it asks no
// host for anything.
await startI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
