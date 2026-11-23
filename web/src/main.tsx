import "@fontsource-variable/inter";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { SessionProvider } from "./session.tsx";
import { ToastProvider } from "./ui.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
