import { Bell, ChevronDown, Download, LogOut, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { buildInfo, formatBuildIdentity } from "../lib/build-info";
import { findNavItem, mobileNav, navGroups } from "../lib/navigation";
import { CommandPalette } from "./command-palette";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const currentItem = useMemo(() => findNavItem(location.pathname), [location.pathname]);

  useEffect(() => {
    document.title = `${currentItem?.label ?? "经营工作台"} · FIAT LUX CHOICE`;
  }, [currentItem]);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node))
        setProfileOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="FIAT LUX CHOICE 经营工作台">
          <img src="/fiatlux-logo.jpg" alt="" />
          <span>
            <strong>FIAT LUX</strong>
            <small>CHOICE</small>
          </span>
        </NavLink>

        <nav className="sidebar-nav" aria-label="主导航">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.permission || auth.can(item.permission),
            );
            if (visibleItems.length === 0) return null;
            return (
              <section key={group.label} className="nav-group">
                <h2>{group.label}</h2>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path} end={item.path === "/"}>
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </section>
            );
          })}
        </nav>

        <div className="sidebar-org">
          <span className="org-mark">耀</span>
          <div>
            <strong>耀光电竞</strong>
            <small>广州 · 内部工作区</small>
            <small className="build-identity" data-testid="build-identity">
              {formatBuildIdentity(buildInfo)}
            </small>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button type="button" className="global-search" onClick={() => setCommandOpen(true)}>
            <Search aria-hidden="true" />
            <span>搜索模块</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar-actions">
            {installPrompt ? (
              <button
                type="button"
                className="icon-button"
                onClick={install}
                aria-label="安装应用"
                title="安装应用"
              >
                <Download aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button notification-button"
              onClick={() => navigate("/resources/notifications")}
              aria-label="通知"
              title="通知"
            >
              <Bell aria-hidden="true" />
              <span className="notification-dot" />
            </button>
            <div className="profile-menu" ref={profileRef}>
              <button
                type="button"
                className="profile-trigger"
                onClick={() => setProfileOpen((open) => !open)}
                aria-expanded={profileOpen}
              >
                <span className="avatar">{auth.user?.displayName.slice(0, 1) ?? "耀"}</span>
                <span className="profile-label">
                  <strong>{auth.user?.displayName}</strong>
                  <small>{auth.user?.role}</small>
                </span>
                <ChevronDown aria-hidden="true" />
              </button>
              {profileOpen ? (
                <div className="profile-popover">
                  <p>{auth.user?.email}</p>
                  <p className="profile-build-identity" data-testid="profile-build-identity">
                    {formatBuildIdentity(buildInfo)}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await auth.logout();
                      navigate("/login");
                    }}
                  >
                    <LogOut aria-hidden="true" />
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="移动导航">
        {mobileNav
          .filter((item) => !item.permission || auth.can(item.permission))
          .map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} end={item.path === "/"}>
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
      </nav>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
