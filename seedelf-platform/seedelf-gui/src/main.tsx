import "@/styles/globals.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import App from "./app/App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </React.StrictMode>,
);
