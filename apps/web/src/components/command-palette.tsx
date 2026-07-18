import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { navGroups } from "../lib/navigation";
import { Modal } from "./ui";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const auth = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return navGroups
      .flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
      .filter((item) => !item.permission || auth.can(item.permission))
      .filter(
        (item) =>
          !normalized ||
          `${item.label} ${item.group}`.toLocaleLowerCase("zh-CN").includes(normalized),
      );
  }, [auth, query]);

  return (
    <Modal open={open} onClose={onClose} title="快速前往" size="small">
      <div className="command-search">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模块"
          aria-label="搜索模块"
        />
      </div>
      <div className="command-results">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.path}
              onClick={() => {
                navigate(item.path);
                onClose();
              }}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              <small>{item.group}</small>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
