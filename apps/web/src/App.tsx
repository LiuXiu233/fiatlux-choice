import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { RequireAuth } from "./lib/auth";
import { AdvisorsPage } from "./pages/advisors-page";
import { ApprovalsPage } from "./pages/approvals-page";
import { DashboardPage } from "./pages/dashboard-page";
import { LoginPage } from "./pages/login-page";
import { MenuPage } from "./pages/menu-page";
import { NotFoundPage } from "./pages/not-found-page";
import { ResourcePage } from "./pages/resource-page";
import { SettingsPage } from "./pages/settings-page";

const EducationPage = lazy(async () => {
  const module = await import("./pages/education-page");
  return { default: module.EducationPage };
});

const OperationsPage = lazy(async () => {
  const module = await import("./pages/operations-page");
  return { default: module.OperationsPage };
});

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RouteLoading({ label }: { label: string }) {
  return (
    <div className="app-loading route-loading" role="status" aria-live="polite">
      <span>{label}</span>
    </div>
  );
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="resources/:resourceKey" element={<ResourcePage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="advisors" element={<AdvisorsPage />} />
          <Route
            path="operations"
            element={
              <Suspense fallback={<RouteLoading label="正在加载运行异常处置…" />}>
                <OperationsPage />
              </Suspense>
            }
          />
          <Route
            path="education"
            element={
              <Suspense fallback={<RouteLoading label="正在加载电竞教育内容…" />}>
                <EducationPage />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
