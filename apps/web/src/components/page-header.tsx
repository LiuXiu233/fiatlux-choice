import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-title-wrap">
        {Icon ? (
          <span className="page-icon" aria-hidden="true">
            <Icon />
          </span>
        ) : null}
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
