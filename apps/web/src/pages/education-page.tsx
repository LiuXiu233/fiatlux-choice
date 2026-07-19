import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardList,
  FileWarning,
  GraduationCap,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Spinner, StatusBadge } from "../components/ui";
import { ApiError, api, queryString } from "../lib/api";
import { formatDate, recordLabel } from "../lib/format";
import type { BusinessRecord } from "../lib/types";

const curriculumTracks = [
  {
    title: "竞技能力基础",
    audience: "有竞技提升需求的成年玩家",
    format: "自学单元 + 小班复盘",
    outcome: "目标设定、训练日志、回放分析与协作基础",
  },
  {
    title: "团队赛训体系",
    audience: "半职业战队与高校成年社团成员",
    format: "6 周小班项目",
    outcome: "角色分工、战术沟通、赛前准备与赛后复盘",
  },
  {
    title: "教练与赛事运营",
    audience: "教练、领队与赛事执行人员",
    format: "案例课程 + 实操任务",
    outcome: "训练设计、赛事流程、风险控制与记录归档",
  },
  {
    title: "电竞职业与数字素养",
    audience: "成年职业探索者；家长仅限公开内容",
    format: "公开课 + 职业访谈",
    outcome: "行业岗位、健康习惯、信息安全与职业边界",
  },
];

const launchGates = [
  "服务主体、地域、课程对象、年龄与身份条件已明确",
  "业务类型和可能涉及的教育或培训资质已由专业人员复核",
  "讲师、内容版权和素材授权证据已归档",
  "价格、退款、服务范围与合同条款已复核",
  "个人信息最小收集清单和保存期限已批准",
  "直播、社群、内容安全、作弊与账号交易规则已人工评估",
  "涉及未成年人时已暂停上线并完成专项评估",
  "投诉、内容纠错和安全事件流程已演练",
  "官网、广告、销售话术、案例和合同表述一致且有证据",
];

const contentPillars = [
  {
    title: "竞技训练方法",
    topics: "目标设定、有效练习、回放标注与版本复盘",
  },
  {
    title: "团队与教练能力",
    topics: "角色分工、沟通协议、反馈方法与冲突处理",
  },
  {
    title: "赛事运营实务",
    topics: "报名核验、赛程执行、应急处置与证据归档",
  },
  {
    title: "职业与经营认知",
    topics: "岗位地图、合同边界、收入不确定性与备选路径",
  },
  {
    title: "健康与数字安全",
    topics: "作息、人体工学、压力求助、账号与社群安全",
  },
  {
    title: "真实案例与行业事实",
    topics: "授权赛训案例、注明时点的规则与可核查来源",
  },
];

const publicSiteFindings = [
  "9 篇公开博文中 7 篇仍是模板占位文",
  "页面仍保留美国地域表述和已过期赛事时态",
  "联系表单缺少可见主体、隐私和投诉说明",
];

export function EducationPage() {
  const products = useQuery({
    queryKey: ["education-products"],
    queryFn: async () =>
      (
        await api.get<BusinessRecord[]>(
          `/products${queryString({ pageSize: 100, category: "online_education" })}`,
        )
      ).data,
  });
  const compliance = useQuery({
    queryKey: ["education-compliance"],
    queryFn: async () =>
      (
        await api.get<BusinessRecord[]>(
          `/compliance-events${queryString({ pageSize: 100, search: "教育" })}`,
        )
      ).data,
  });
  const productItems = products.data ?? [];

  return (
    <>
      <PageHeader
        title="电竞教育"
        description="在线教育产品筹备与内容运营"
        icon={GraduationCap}
        actions={
          <Link className="button primary" to="/resources/products?create=1">
            建立教育产品
            <ArrowRight aria-hidden="true" />
          </Link>
        }
      />

      <section className="education-band">
        <div>
          <span>业务依据</span>
          <strong>官网现有能力</strong>
          <p>选手发展、赛事管理、团队建设、社区参与与行业内容</p>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span>产品方向</span>
          <strong>可交付课程体系</strong>
          <p>训练方法、团队赛训、教练运营、职业与数字素养</p>
        </div>
        <ArrowRight aria-hidden="true" />
        <div>
          <span>首期策略</span>
          <strong>小规模人工试点</strong>
          <p>先验证成人小班，再依据合规复核扩展对象与渠道</p>
        </div>
      </section>

      <section className="education-section curriculum-section">
        <header>
          <div>
            <BookOpenCheck aria-hidden="true" />
            <h2>内容地图</h2>
          </div>
          <span>4 条课程线</span>
        </header>
        <div className="curriculum-table">
          <div className="curriculum-head">
            <span>课程线</span>
            <span>首期对象</span>
            <span>交付形式</span>
            <span>学习产出</span>
          </div>
          {curriculumTracks.map((track) => (
            <article key={track.title}>
              <strong>{track.title}</strong>
              <span>{track.audience}</span>
              <span>{track.format}</span>
              <span>{track.outcome}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="education-section content-program-section">
        <header>
          <div>
            <ClipboardList aria-hidden="true" />
            <h2>公开内容重建</h2>
          </div>
          <Link to="/resources/tasks?create=1">
            建立内容任务
            <ArrowRight aria-hidden="true" />
          </Link>
        </header>
        <div className="content-program-body">
          <aside className="site-audit-callout">
            <div>
              <FileWarning aria-hidden="true" />
              <span>官网公开盘点 · 2026-07-19</span>
            </div>
            <ul>
              {publicSiteFindings.map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
            <p>先撤回模板内容并核验主体、人员、赛事、见证和素材权利，再开展对外获客。</p>
          </aside>
          <div className="content-pillar-grid">
            {contentPillars.map((pillar, index) => (
              <article key={pillar.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{pillar.title}</strong>
                  <p>{pillar.topics}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="education-grid">
        <section className="education-section pilot-section">
          <header>
            <div>
              <UsersRound aria-hidden="true" />
              <h2>产品试点</h2>
            </div>
            <Link to="/resources/products">
              产品组合
              <ArrowRight aria-hidden="true" />
            </Link>
          </header>
          {products.isLoading ? (
            <Spinner />
          ) : products.isError ? (
            <ErrorState
              message={
                products.error instanceof ApiError ? products.error.message : "无法读取教育产品"
              }
            />
          ) : productItems.length === 0 ? (
            <EmptyState title="尚未建立教育产品" />
          ) : (
            <div className="pilot-list">
              {productItems.map((product) => (
                <Link to="/resources/products" key={product.id}>
                  <div>
                    <strong>{recordLabel(product)}</strong>
                    <small>
                      {String(product.stage ?? "筹备中")} · 下次评审{" "}
                      {formatDate(product.nextReviewAt)}
                    </small>
                  </div>
                  <StatusBadge status={product.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="education-section compliance-gates">
          <header>
            <div>
              <ShieldCheck aria-hidden="true" />
              <h2>上线门槛</h2>
            </div>
            <Link to="/resources/compliance-items">
              合规知识库
              <ArrowRight aria-hidden="true" />
            </Link>
          </header>
          <ol>
            {launchGates.map((gate, index) => (
              <li key={gate}>
                <span>{index + 1}</span>
                <p>{gate}</p>
              </li>
            ))}
          </ol>
          {compliance.isLoading ? (
            <Spinner label="正在读取复核事项" />
          ) : compliance.data?.length ? (
            <p className="gate-summary">当前有 {compliance.data.length} 项教育相关复核事项</p>
          ) : null}
        </section>
      </div>
    </>
  );
}
