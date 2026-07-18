import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="not-found">
      <strong>404</strong>
      <h1>页面不存在</h1>
      <Link to="/" className="button secondary">
        <ArrowLeft aria-hidden="true" />
        返回工作台
      </Link>
    </div>
  );
}
