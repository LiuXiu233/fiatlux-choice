import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { RequireAuth } from "./lib/auth";
import { AdvisorsPage } from "./pages/advisors-page";
import { ApprovalsPage } from "./pages/approvals-page";
import { DashboardPage } from "./pages/dashboard-page";
import { EducationPage } from "./pages/education-page";
import { LoginPage } from "./pages/login-page";
import { MenuPage } from "./pages/menu-page";
import { NotFoundPage } from "./pages/not-found-page";
import { ResourcePage } from "./pages/resource-page";
import { SettingsPage } from "./pages/settings-page";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname) window.scrollTo(0, 0);
  }, [pathname]);
  return null;
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
          <Route path="education" element={<EducationPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
