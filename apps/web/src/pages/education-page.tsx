import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  FileWarning,
  GraduationCap,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Modal, Spinner, StatusBadge } from "../components/ui";
import { ApiError, api, queryString } from "../lib/api";
import { educationContent } from "../lib/education-content";
import type { EducationArticle } from "../lib/education-content-schema";
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

const reviewStatusLabels = {
  pending: "待人工复核",
  in_review: "复核中",
  changes_requested: "待修改",
  reviewed: "已复核",
} satisfies Record<EducationArticle["review"]["status"], string>;

const rightsStatusLabels = {
  pending_clearance: "权利待确认",
  cleared: "权利已确认",
  restricted: "限制使用",
} satisfies Record<EducationArticle["rights"]["status"], string>;

const referenceStatusLabels = {
  draft: "内部草案",
  pending: "待人工复核",
  reviewed: "已复核",
} as const;

export function EducationPage() {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
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
  const selectedArticle = educationContent.articles.find(
    (article) => article.id === selectedArticleId,
  );

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

      <section className="education-section education-library-section">
        <header>
          <div>
            <BookMarked aria-hidden="true" />
            <h2>版本化内部内容库</h2>
          </div>
          <span>
            {educationContent.articles.length} 篇 · v{educationContent.schemaVersion}
          </span>
        </header>
        <div className="education-library-summary">
          <div>
            <FileCheck2 aria-hidden="true" />
            <span>内容状态</span>
            <strong>内部草案</strong>
          </div>
          <div>
            <UsersRound aria-hidden="true" />
            <span>首期对象</span>
            <strong>中国境内成年人</strong>
          </div>
          <div>
            <CalendarClock aria-hidden="true" />
            <span>下次复核</span>
            <strong>{educationContent.nextReviewAt}</strong>
          </div>
          <div>
            <LockKeyhole aria-hidden="true" />
            <span>外部发布</span>
            <strong>WordPress 未发布</strong>
          </div>
        </div>
        <div className="education-article-grid">
          {educationContent.articles.map((article, index) => (
            <button
              type="button"
              className="education-article-card"
              key={article.id}
              onClick={() => setSelectedArticleId(article.id)}
              aria-label={`查看文章：${article.title}`}
            >
              <span className="education-article-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="education-article-card-body">
                <div className="education-article-badges">
                  <span className={`education-governance-badge review-${article.review.status}`}>
                    {reviewStatusLabels[article.review.status]}
                  </span>
                  <span className={`education-governance-badge rights-${article.rights.status}`}>
                    {rightsStatusLabels[article.rights.status]}
                  </span>
                </div>
                <h3>{article.title}</h3>
                <p>{article.summary}</p>
                <dl>
                  <div>
                    <dt>版本</dt>
                    <dd>v{article.version}</dd>
                  </div>
                  <div>
                    <dt>负责人</dt>
                    <dd>{article.review.ownerRole}</dd>
                  </div>
                </dl>
                <span className="education-article-open">
                  查看正文、模板与依据
                  <ArrowRight aria-hidden="true" />
                </span>
              </div>
            </button>
          ))}
        </div>
        <p className="education-publication-boundary">
          <FileWarning aria-hidden="true" />
          <span>{educationContent.publicationBoundary}</span>
        </p>
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

      <Modal
        open={Boolean(selectedArticle)}
        onClose={() => setSelectedArticleId(null)}
        title={selectedArticle?.title ?? "教育内容"}
        size="large"
      >
        {selectedArticle ? (
          <article className="education-article-detail">
            <div className="education-detail-state" role="status">
              <div>
                <span>{reviewStatusLabels[selectedArticle.review.status]}</span>
                <strong>v{selectedArticle.version}</strong>
              </div>
              <div>
                <span>{rightsStatusLabels[selectedArticle.rights.status]}</span>
                <strong>{selectedArticle.publication.externalStateLabel}</strong>
              </div>
            </div>

            <p className="education-detail-summary">{selectedArticle.summary}</p>

            <dl className="education-detail-metadata">
              <div>
                <dt>适用对象</dt>
                <dd>{selectedArticle.audience}</dd>
              </div>
              <div>
                <dt>内容负责人</dt>
                <dd>{selectedArticle.review.ownerRole}</dd>
              </div>
              <div>
                <dt>审阅角色</dt>
                <dd>{selectedArticle.review.reviewerRoles.join("、")}</dd>
              </div>
              <div>
                <dt>下次复核</dt>
                <dd>{selectedArticle.review.nextReviewAt}</dd>
              </div>
            </dl>

            <section className="education-detail-boundaries">
              <div>
                <h3>适用范围</h3>
                <ul>
                  {selectedArticle.applicability.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>不承诺事项</h3>
                <ul>
                  {selectedArticle.nonPromises.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="education-detail-safety">
              <h3>
                <ShieldCheck aria-hidden="true" />
                安全与停止边界
              </h3>
              <ul>
                {selectedArticle.safetyNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="education-detail-learning">
              <h3>学习目标</h3>
              <ol>
                {selectedArticle.learningObjectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ol>
            </section>

            <div className="education-detail-sections">
              {selectedArticle.sections.map((section) => (
                <section key={section.heading}>
                  <h3>{section.heading}</h3>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets ? (
                    <ul>
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                  {section.example ? (
                    <aside>
                      <strong>{section.example.label}</strong>
                      <p>{section.example.text}</p>
                    </aside>
                  ) : null}
                </section>
              ))}
            </div>

            <section className="education-detail-template">
              <header>
                <ClipboardList aria-hidden="true" />
                <div>
                  <span>可复用模板</span>
                  <h3>{selectedArticle.template.title}</h3>
                </div>
              </header>
              <p>{selectedArticle.template.instructions}</p>
              <div className="education-template-fields">
                {selectedArticle.template.fields.map((field) => (
                  <div key={field.label}>
                    <strong>{field.label}</strong>
                    <p>{field.guidance}</p>
                    <small>示例：{field.example}</small>
                  </div>
                ))}
              </div>
              <p className="education-completion-rule">
                <strong>完成条件：</strong>
                {selectedArticle.template.completionRule}
              </p>
            </section>

            <section className="education-detail-practice">
              <h3>{selectedArticle.practice.title}</h3>
              <p>{selectedArticle.practice.scenario}</p>
              <ol>
                {selectedArticle.practice.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>
                <strong>交付物：</strong>
                {selectedArticle.practice.deliverable}
              </p>
              <div>
                <strong>自查</strong>
                <ul>
                  {selectedArticle.practice.selfCheck.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="education-detail-sources">
              <h3>来源与适用边界</h3>
              <div>
                {selectedArticle.sourceRefs.map((sourceRef) => {
                  const reference = educationContent.references.find(({ id }) => id === sourceRef);
                  if (!reference) return null;
                  return (
                    <article key={reference.id}>
                      <header>
                        <div>
                          <strong>{reference.title}</strong>
                          <small>{reference.authority}</small>
                        </div>
                        <span
                          className={`education-source-status source-${reference.reviewStatus}`}
                        >
                          {referenceStatusLabels[reference.reviewStatus]}
                        </span>
                      </header>
                      <p>{reference.applicability}</p>
                      <p className="education-source-boundary">{reference.usageBoundary}</p>
                      {reference.kind === "official" ? (
                        <a href={reference.location} target="_blank" rel="noreferrer">
                          查看官方来源
                          <ExternalLink aria-hidden="true" />
                        </a>
                      ) : (
                        <code>{reference.location}</code>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="education-detail-ai">
              <h3>
                <Sparkles aria-hidden="true" />
                AI 辅助披露
              </h3>
              <p>{selectedArticle.aiDisclosure.disclosure}</p>
              <ul>
                {selectedArticle.aiDisclosure.prohibitedUses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="education-detail-review">
              <h3>人工复核问题</h3>
              <ol>
                {selectedArticle.reviewQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ol>
              <p>{selectedArticle.review.note}</p>
            </section>

            <footer className="education-detail-footer">
              <LockKeyhole aria-hidden="true" />
              <div>
                <strong>{selectedArticle.publication.externalStateLabel}</strong>
                <p>{selectedArticle.publication.manualBoundary}</p>
              </div>
            </footer>
          </article>
        ) : null}
      </Modal>
    </>
  );
}
