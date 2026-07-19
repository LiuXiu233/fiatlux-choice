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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RouteLoading() {
  return (
    <div className="app-loading route-loading" role="status" aria-live="polite">
      <span>正在加载电竞教育内容…</span>
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
            path="education"
            element={
              <Suspense fallback={<RouteLoading />}>
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
