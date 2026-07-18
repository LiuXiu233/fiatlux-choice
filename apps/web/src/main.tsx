import { registerSW } from "virtual:pwa-register";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import "./styles.css";

registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (attempt, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && attempt < 2,
    },
    mutations: {
      retry: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("缺少应用根节点");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
