import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  Bot,
  BriefcaseBusiness,
  Code2,
  FilePenLine,
  Play,
  Scale,
  ShieldCheck,
  Telescope,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Modal, Spinner, StatusBadge, useToast } from "../components/ui";
import { ApiError, api, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatConfidence, formatDateTime, recordLabel } from "../lib/format";
import type { AdvisorDefinition, AdvisorRun, BusinessRecord } from "../lib/types";

interface AdvisorVisual {
  code: string;
  name: string;
  remit: string;
  icon: LucideIcon;
  templates: string[];
  scopes: string[];
}

const advisorVisuals: AdvisorVisual[] = [
  {
    code: "general_manager",
    name: "总经理顾问",
    remit: "经营重点、资源取舍与跨模块决策",
    icon: BriefcaseBusiness,
    templates: ["生成本周经营简报", "识别三项最高优先级", "复盘未达成目标"],
    scopes: ["objectives", "projects", "tasks", "decisions", "risks", "financial-entries"],
  },
  {
    code: "finance",
    name: "财务顾问",
    remit: "现金流、收支、发票与经营预警",
    icon: BadgeDollarSign,
    templates: ["评估 90 天现金流", "检查异常收支", "整理待处理发票"],
    scopes: ["financial-entries", "invoices", "cash-flow", "contracts"],
  },
  {
    code: "legal_compliance",
    name: "法务合规顾问",
    remit: "合同、义务、法规来源与适用条件",
    icon: Scale,
    templates: ["检查本月合规义务", "识别合同履约风险", "列出待人工复核政策"],
    scopes: ["compliance-items", "compliance-events", "obligations", "risks", "contracts"],
  },
  {
    code: "product_rnd",
    name: "产品研发顾问",
    remit: "产品组合、研发节奏与 GitHub 技术信号",
    icon: Code2,
    templates: ["评估产品组合", "整理技术债优先级", "分析 GitHub 仓库健康度"],
    scopes: ["products", "projects", "tasks", "github-insights", "risks"],
  },
  {
    code: "market_opportunity",
    name: "市场机会顾问",
    remit: "机会管道、电竞教育与合作推进",
    icon: Telescope,
    templates: ["评估机会管道", "规划电竞教育试点", "生成下周跟进动作"],
    scopes: ["opportunities", "products", "contracts", "objectives"],
  },
  {
    code: "hr_admin",
    name: "人力行政顾问",
    remit: "人员安排、劳动用工与行政义务",
    icon: UsersRound,
    templates: ["检查用工义务", "评估团队负荷", "整理行政到期事项"],
    scopes: ["tasks", "objectives", "obligations", "risks"],
  },
  {
    code: "information_security",
    name: "信息安全顾问",
    remit: "权限、审计、数据与供应链风险",
    icon: ShieldCheck,
    templates: ["检查关键权限", "分析近期安全审计", "评估数据处理风险"],
    scopes: ["risks", "compliance-items", "github-insights", "audit-events"],
  },
];

const scopeLabels: Record<string, string> = {
  objectives: "目标",
  projects: "项目",
  tasks: "任务",
  decisions: "决策",
  obligations: "义务",
  "compliance-items": "合规知识",
  "compliance-events": "合规日历",
  risks: "风险",
  contracts: "合同",
  "financial-entries": "收支",
  invoices: "发票",
  "cash-flow": "现金流",
  products: "产品",
  opportunities: "机会",
  "github-insights": "GitHub",
  "audit-events": "审计",
};

export function promptAllowedScopes(
  visualScopes: readonly string[],
  promptScopes?: readonly string[],
) {
  if (!promptScopes) return [...visualScopes];
  const allowed = new Set(promptScopes);
  return visualScopes.filter((scope) => allowed.has(scope));
}

export function advisorAvailableScopes(
  visualScopes: readonly string[],
  promptScopes?: readonly string[],
  permissionScopes: readonly string[] = visualScopes,
) {
  const permitted = new Set(permissionScopes);
  return promptAllowedScopes(visualScopes, promptScopes).filter((scope) => permitted.has(scope));
}

export function AdvisorsPage() {
  const auth = useAuth();
  const [running, setRunning] = useState<AdvisorVisual | null>(null);
  const [selected, setSelected] = useState<AdvisorRun | null>(null);
  const advisors = useQuery({
    queryKey: ["advisors"],
    queryFn: async () => (await api.get<AdvisorDefinition[]>("/advisors")).data,
  });
  const runs = useQuery({
    queryKey: ["advisor-runs"],
    queryFn: async () =>
      (await api.get<AdvisorRun[]>(`/advisor-runs${queryString({ pageSize: 20 })}`)).data,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "queued" || run.status === "running")
        ? 3000
        : false,
  });

  const merged = useMemo(
    () =>
      advisorVisuals
        .filter((visual) =>
          advisors.data?.some((advisor) => (advisor.code ?? advisor.key) === visual.code),
        )
        .map((visual) => {
          const definition = advisors.data?.find(
            (advisor) => (advisor.code ?? advisor.key) === visual.code,
          );
          return {
            ...visual,
            definition,
            scopes: advisorAvailableScopes(
              visual.scopes,
              definition?.promptVersion?.dataScopes,
              definition?.dataScopes,
            ),
            lastRun: runs.data?.find((run) => (run.advisorCode ?? run.advisorKey) === visual.code),
          };
        }),
    [advisors.data, runs.data],
  );
  const runItems = runs.data ?? [];

  return (
    <>
      <PageHeader
        title="AI 顾问"
        description="基于授权公司数据生成可追溯的事实、推断与建议"
        icon={Bot}
      />
      {advisors.isError ? (
        <ErrorState
          message={advisors.error instanceof ApiError ? advisors.error.message : "无法读取顾问配置"}
          onRetry={() => void advisors.refetch()}
        />
      ) : null}
      {advisors.isLoading ? (
        <div className="resource-loading">
          <Spinner label="正在读取授权顾问" />
        </div>
      ) : merged.length === 0 && !advisors.isError ? (
        <EmptyState title="当前角色没有可用顾问" />
      ) : (
        <section className="advisor-grid" aria-label="顾问列表">
          {merged.map((advisor) => {
            const Icon = advisor.icon;
            return (
              <article className="advisor-card" key={advisor.code}>
                <div className="advisor-card-header">
                  <span className="advisor-card-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <StatusBadge status={advisor.definition?.status ?? "active"} />
                </div>
                <h2>{advisor.name}</h2>
                <p>{advisor.remit}</p>
                <div className="advisor-last-run">
                  <span>最近分析</span>
                  <strong>
                    {advisor.lastRun ? formatDateTime(advisor.lastRun.createdAt) : "尚未运行"}
                  </strong>
                  {advisor.lastRun ? (
                    <small>
                      {advisor.lastRun.status === "completed"
                        ? `置信度 ${formatConfidence(advisor.lastRun.confidence)}`
                        : advisor.lastRun.status}
                    </small>
                  ) : null}
                </div>
                <div className="advisor-card-actions">
                  {advisor.lastRun ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        if (advisor.lastRun) setSelected(advisor.lastRun);
                      }}
                    >
                      查看结果
                    </button>
                  ) : (
                    <span />
                  )}
                  {auth.can("advisor-runs:create") ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => setRunning(advisor)}
                    >
                      <Play aria-hidden="true" />
                      运行分析
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="advisor-history">
        <header>
          <h2>最近运行</h2>
          <span>{runs.data?.length ?? 0} 条</span>
        </header>
        {runs.isLoading ? (
          <Spinner />
        ) : runs.isError ? (
          <ErrorState message="无法读取顾问运行记录" />
        ) : runItems.length === 0 ? (
          <EmptyState title="暂无运行记录" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>顾问</th>
                  <th>目标</th>
                  <th>状态</th>
                  <th>提示词版本</th>
                  <th>置信度</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runItems.map((run) => (
                  <tr key={run.id}>
                    <td>
                      {advisorVisuals.find(
                        (item) => item.code === (run.advisorCode ?? run.advisorKey),
                      )?.name ?? run.advisorKey}
                    </td>
                    <td className="primary-cell">
                      {run.title ?? run.question ?? run.summary ?? "分析任务"}
                    </td>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td>{run.promptVersion ?? run.promptVersionId ?? "—"}</td>
                    <td>{run.status === "completed" ? formatConfidence(run.confidence) : "—"}</td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button secondary compact"
                        onClick={() => setSelected(run)}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(running)}
        onClose={() => setRunning(null)}
        title={running ? `运行${running.name}` : "运行顾问"}
        size="large"
      >
        {running ? (
          <AdvisorRunForm
            advisor={running}
            onDone={() => setRunning(null)}
            onCancel={() => setRunning(null)}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="顾问分析结果"
        size="large"
      >
        {selected ? <AdvisorRunDetails run={selected} /> : null}
      </Modal>
    </>
  );
}

function AdvisorRunForm({
  advisor,
  onDone,
  onCancel,
}: {
  advisor: AdvisorVisual;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [objective, setObjective] = useState(advisor.templates[0] ?? "");
  const [scope, setScope] = useState<string[]>(advisor.scopes.slice(0, 3));
  const [context, setContext] = useState<
    Array<{ resourceType: string; resourceId: string; label: string }>
  >([]);
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<AdvisorRun>("/advisor-runs", {
        advisor: advisor.code,
        question: objective,
        context: context.map(({ resourceType, resourceId }) => ({ resourceType, resourceId })),
      }),
    onSuccess: async () => {
      toast.push("分析任务已进入后台队列", "success");
      await queryClient.invalidateQueries({ queryKey: ["advisor-runs"] });
      onDone();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法创建分析任务", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <form onSubmit={submit} className="advisor-run-form">
      <section>
        <h3>分析目标</h3>
        <div className="template-options">
          {advisor.templates.map((template) => (
            <button
              type="button"
              className={objective === template ? "selected" : undefined}
              key={template}
              onClick={() => setObjective(template)}
            >
              {template}
            </button>
          ))}
        </div>
        <textarea
          aria-label="分析目标"
          rows={4}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          required
        />
      </section>
      <section>
        <h3>授权数据范围</h3>
        <div className="scope-options">
          {advisor.scopes.map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={scope.includes(value)}
                onChange={(event) =>
                  setScope((current) => {
                    if (event.target.checked) return [...current, value];
                    setContext((selected) =>
                      selected.filter((item) => item.resourceType !== value),
                    );
                    return current.filter((item) => item !== value);
                  })
                }
              />
              <span>{scopeLabels[value] ?? value}</span>
            </label>
          ))}
        </div>
        <p className="muted">勾选模块不会自动送出数据；请在下方逐条选择本次需要的记录。</p>
        <div className="advisor-context-picker">
          {scope.map((resourceType) => (
            <AdvisorScopeRecords
              key={resourceType}
              resourceType={resourceType}
              selectedIds={
                new Set(
                  context
                    .filter((item) => item.resourceType === resourceType)
                    .map((item) => item.resourceId),
                )
              }
              onToggle={(record, checked) =>
                setContext((current) => {
                  if (checked) {
                    if (current.length >= 100) return current;
                    return [
                      ...current,
                      {
                        resourceType,
                        resourceId: record.id,
                        label: recordLabel(record),
                      },
                    ];
                  }
                  return current.filter(
                    (item) => item.resourceType !== resourceType || item.resourceId !== record.id,
                  );
                })
              }
            />
          ))}
        </div>
        <div className="advisor-context-summary" aria-live="polite">
          <strong>本次明确授权 {context.length} 条记录</strong>
          {context.length ? (
            <ul>
              {context.map((item) => (
                <li key={`${item.resourceType}:${item.resourceId}`}>
                  {scopeLabels[item.resourceType] ?? item.resourceType}：{item.label}
                </li>
              ))}
            </ul>
          ) : (
            <p>未选择公司记录；顾问只会收到分析目标和系统提示词。</p>
          )}
        </div>
      </section>
      <div className="advisor-boundary">
        <ShieldCheck aria-hidden="true" />
        <p>
          服务端会按当前用户权限重新过滤数据；提示词、模型、工具调用、引用和后续人工修改均写入审计。
        </p>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={mutation.isPending || scope.length === 0 || objective.trim().length < 4}
        >
          {mutation.isPending ? "正在入队…" : "开始分析"}
        </button>
      </div>
    </form>
  );
}

function AdvisorScopeRecords({
  resourceType,
  selectedIds,
  onToggle,
}: {
  resourceType: string;
  selectedIds: ReadonlySet<string>;
  onToggle: (record: BusinessRecord, checked: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const records = useQuery({
    queryKey: ["advisor-context-options", resourceType],
    queryFn: async () =>
      (await api.get<BusinessRecord[]>(`/${resourceType}${queryString({ pageSize: 100 })}`)).data,
  });
  const visibleRecords = (records.data ?? []).filter((record) =>
    recordLabel(record).toLocaleLowerCase("zh-CN").includes(search.toLocaleLowerCase("zh-CN")),
  );

  return (
    <section
      className="advisor-context-scope"
      aria-label={`${scopeLabels[resourceType] ?? resourceType}记录`}
    >
      <header>
        <h4>{scopeLabels[resourceType] ?? resourceType}</h4>
        <span>{records.data?.length ?? 0} 条可选</span>
      </header>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={`搜索${scopeLabels[resourceType] ?? resourceType}记录`}
        placeholder="按名称搜索"
      />
      {records.isLoading ? (
        <Spinner label="正在加载可授权记录" />
      ) : records.isError ? (
        <ErrorState message="记录加载失败，未授权任何数据" onRetry={() => void records.refetch()} />
      ) : visibleRecords.length === 0 ? (
        <p className="muted">没有可选记录</p>
      ) : (
        <div className="advisor-context-options">
          {visibleRecords.map((record) => (
            <label key={record.id}>
              <input
                type="checkbox"
                checked={selectedIds.has(record.id)}
                onChange={(event) => onToggle(record, event.target.checked)}
              />
              <span>
                <strong>{recordLabel(record)}</strong>
                <small>{String(record.status ?? record.category ?? "")}</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function AdvisorRunDetails({ run }: { run: AdvisorRun }) {
  const auth = useAuth();
  const detail = useQuery({
    queryKey: ["advisor-run", run.id],
    queryFn: async () => (await api.get<AdvisorRun>(`/advisor-runs/${run.id}`)).data,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running"
        ? 2500
        : false,
  });
  const current = detail.data ?? run;
  const output = current.output;
  const [editedOutput, setEditedOutput] = useState(() => JSON.stringify(run.output ?? {}, null, 2));
  const [reason, setReason] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();
  const editMutation = useMutation({
    mutationFn: () =>
      api.patch<AdvisorRun>(`/advisor-runs/${run.id}`, {
        output: JSON.parse(editedOutput) as unknown,
        reason,
        expectedVersion: Number(current.version ?? 1),
      }),
    onSuccess: async () => {
      toast.push("人工修订已保存并留痕", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["advisor-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["advisor-run", run.id] }),
      ]);
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : "保存失败", "error"),
  });

  if (detail.isError)
    return (
      <ErrorState
        message={detail.error instanceof ApiError ? detail.error.message : "无法读取完整运行记录"}
        onRetry={() => void detail.refetch()}
      />
    );
  if (current.status === "queued" || current.status === "running")
    return (
      <div className="advisor-running">
        <Spinner label={current.status === "queued" ? "正在等待后台任务" : "正在分析授权数据"} />
      </div>
    );
  if (current.status === "failed")
    return (
      <ErrorState
        message={
          typeof current.errorMessage === "string"
            ? current.errorMessage
            : "模型运行失败，未生成结论"
        }
      />
    );
  if (!output) return <EmptyState title="该运行尚无结构化输出" />;

  const modelName = current.model ?? current.modelCalls?.find((call) => call.model)?.model ?? "—";
  const citations = current.citations ?? [];
  const toolCalls = current.toolCalls ?? [];

  return (
    <div className="advisor-result">
      <header>
        <div>
          <StatusBadge status={current.status} />
          <span>置信度 {formatConfidence(current.confidence)}</span>
        </div>
        <dl>
          <div>
            <dt>模型</dt>
            <dd>{modelName}</dd>
          </div>
          <div>
            <dt>提示词</dt>
            <dd>{current.promptVersion ?? current.promptVersionId ?? "—"}</dd>
          </div>
          <div>
            <dt>运行时间</dt>
            <dd>{formatDateTime(current.createdAt)}</dd>
          </div>
        </dl>
      </header>
      <ResultSection
        title="事实"
        tone="fact"
        items={output.facts.map((item) => (
          <div key={item.claim}>
            <p>{item.claim}</p>
            <small>
              来源：
              {item.evidence
                .map((evidence) => `${evidence.sourceType}/${evidence.sourceId}`)
                .join("、")}
            </small>
          </div>
        ))}
      />
      <ResultSection
        title="推断"
        tone="inference"
        items={output.inferences.map((item) => (
          <div key={item.claim}>
            <p>{item.claim}</p>
            <small>
              依据：{item.basis.join("；")} · 置信度 {formatConfidence(item.confidence)}
            </small>
          </div>
        ))}
      />
      <ResultSection
        title="建议动作"
        tone="recommendation"
        items={output.recommendations.map((item) => (
          <div key={`${item.action}-${item.priority}`}>
            <span className={`priority-label priority-${item.priority}`}>{item.priority}</span>
            <p>{item.action}</p>
            <small>
              {item.rationale} · 风险：{item.risk}
            </small>
          </div>
        ))}
      />
      <ResultSection
        title="风险"
        tone="risk"
        items={output.risks.map((item) => (
          <div key={`${item.description}-${item.severity}`}>
            <StatusBadge status={item.severity} />
            <p>{item.description}</p>
            <small>{item.mitigation}</small>
          </div>
        ))}
      />
      <ResultSection
        title="缺失信息"
        tone="missing"
        items={output.missingInformation.map((item) => <p key={item}>{item}</p>)}
      />
      <section className="result-section citations">
        <h3>依据与引用</h3>
        {citations.length ? (
          citations.map((citation) =>
            citation.url ? (
              <a
                key={`${citation.title}-${citation.url}`}
                href={citation.url}
                target="_blank"
                rel="noreferrer"
              >
                {citation.title ?? citation.url}
              </a>
            ) : (
              <span key={`${citation.sourceType}-${citation.sourceId}`}>
                {citation.title ?? citation.sourceType} · {citation.recordId ?? citation.sourceId}
              </span>
            ),
          )
        ) : (
          <p className="muted">无</p>
        )}
      </section>
      {toolCalls.length ? (
        <section className="result-section tool-calls">
          <h3>工具调用</h3>
          {toolCalls.map((call) => (
            <span key={call.id ?? `${call.tool ?? call.toolName}-${call.status}`}>
              {call.tool ?? call.toolName}
              <StatusBadge status={call.status} />
            </span>
          ))}
        </section>
      ) : null}
      {auth.can("advisor-runs:update") ? (
        <section className="human-edit">
          <h3>
            <FilePenLine aria-hidden="true" />
            人工修订
          </h3>
          <textarea
            rows={12}
            value={
              editedOutput === "{}" && detail.data?.output
                ? JSON.stringify(detail.data.output, null, 2)
                : editedOutput
            }
            onChange={(event) => setEditedOutput(event.target.value)}
            aria-label="结构化输出 JSON"
          />
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="修订原因"
            aria-label="修订原因"
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => editMutation.mutate()}
            disabled={editMutation.isPending || reason.trim().length < 2}
          >
            {editMutation.isPending ? "正在保存…" : "保存人工修订"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

function ResultSection({
  title,
  tone,
  items,
}: {
  title: string;
  tone: string;
  items: ReactNode[];
}) {
  return (
    <section className={`result-section result-${tone}`}>
      <h3>{title}</h3>
      {items.length ? <div className="result-items">{items}</div> : <p className="muted">无</p>}
    </section>
  );
}
