import { NavLink } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { useAuth } from "../lib/auth";
import { navGroups } from "../lib/navigation";

export function MenuPage() {
  const auth = useAuth();
  return (
    <>
      <PageHeader title="全部模块" />
      <div className="mobile-menu-groups">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => !item.permission || auth.can(item.permission));
          if (!items.length) return null;
          return (
            <section key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path}>
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
