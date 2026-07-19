# 模块化单体架构

## 1. 架构目标

FIAT LUX CHOICE 面向 1–2 人极小团队。架构必须把身份、权限、审计、业务状态和高风险审批放在一致事务边界内，同时允许 Web、API 和后台任务独立运行与扩容。

选择结果是：一个 TypeScript monorepo、一个 PostgreSQL 业务数据库、一个对象存储、一个 API 进程和一个 worker 进程。它是模块化单体，不是把所有代码堆在单个文件中的“巨石”，也不是微服务集合。

相关决策见[ADR-001](./adr-001-modular-monolith.md)。

## 2. 运行时拓扑

~~~mermaid
flowchart LR
    U["桌面 / 移动 PWA"] --> G["Caddy HTTPS 网关"]
    G --> W["React / Vite Web"]
    G --> A["Fastify API"]
    A --> D[("PostgreSQL + pg-boss")]
    A --> O[("MinIO / S3")]
    K["后台 Worker"] --> D
    K --> O
    K --> L["LLM 适配器"]
    K --> H["GitHub 只读适配器"]
    A --> M["人工 / Mock 外部动作边界"]
~~~

生产 Compose 只发布 Caddy 端口。PostgreSQL 和 MinIO 位于 internal backend 网络；API 与 worker 通过 edge 访问经批准的外部适配器。

## 3. 代码结构

| 目录 | 职责 | 不应承担 |
| --- | --- | --- |
| apps/web | 路由、响应式页面、查询缓存、表单、PWA 和客户端权限体验 | 最终授权判断、法律或财务业务规则 |
| apps/api | HTTP、认证、权限钩子、事务编排、资源与操作路由、Swagger | 长时间后台执行、外部系统成功假设 |
| apps/worker | 顾问、工作流、通知、GitHub、逾期扫描和备份任务 | 用户同步请求或前端展示 |
| packages/contracts | Zod 输入契约、资源名称、顾问输出结构、共享类型 | 数据库访问或网络调用 |
| packages/domain | 权限、审批、外部动作状态机、顾问范围与证据规则 | Fastify、React 或具体存储客户端 |
| packages/db | Drizzle schema、迁移、种子和数据库连接 | HTTP 或 UI 逻辑 |
| packages/integrations | LLM、GitHub、对象存储、pg-boss 和外部动作适配器 | 公司业务决策 |
| infra 与 Dockerfile | Compose、Caddy、systemd、环境模板和容器构建 | 应用领域规则 |

依赖方向应从 apps 指向 packages。domain 不依赖具体 Web 框架或外部供应商；integrations 实现端口，不能反向决定领域状态。

## 4. 领域模块

模块在同一个数据库中，但用资源、权限、路由和审计类型保持边界：

| 模块 | 核心记录 | 关键规则 |
| --- | --- | --- |
| 身份与访问 | organizations、users、memberships、roles、sessions | 组织作用域、服务端 RBAC、角色变更审批 |
| 审计与文件 | audit_events、files | 审计无更新/删除业务接口；文件校验和私有对象键 |
| 执行 | objectives、projects、tasks、decisions | 乐观并发、状态与负责人 |
| 治理合规 | compliance_items、compliance_events、obligations、risks、contracts、professional_review 审计 | 证据型来源复核、版本锁定、截止日、风险处置、签署审批 |
| 财务 | financial_entries、invoices、cash_flow_entries | 金额以分存储；外部付款/申报/红冲分离 |
| 产品增长 | products、opportunities、github_insights | 机会到交付映射；外部技术内容视为不可信 |
| 协作自动化 | notifications、workflow_definitions、workflow_runs | 受限步骤类型、后台执行、明确失败 |
| 审批与外部动作 | approvals、external_actions | 高风险默认审批、真实状态机、回执证据 |
| AI 顾问 | prompt_versions、advisor_runs、model/tool calls、citations、edits | 双重权限过滤、上下文快照、证据白名单 |
| 运维 | integration_checks、backups | 检查结果审计；生产完整备份走受控适配器 |

模块之间通过记录 ID、领域函数和同库事务协作，不通过内部 HTTP。

## 5. 请求与事务

一次受保护 API 请求的典型路径：

1. Caddy 转发请求并保留可信请求信息。
2. Fastify 为请求建立 request ID。
3. 会话 Cookie 解码后，再以 sessions 表确认未过期、未撤销。
4. API 根据 orgId 和 userId 计算角色权限。
5. 路由检查资源动作权限并用 Zod 验证输入。
6. Repository 查询强制 orgId，并排除 archivedAt 非空记录。
7. 修改记录时使用 expectedVersion 做乐观并发控制。
8. 业务记录和 audit_event 尽量在同一数据库事务写入。
9. 响应使用 data 包装；列表另有 meta。

客户端传入的 orgId、actor 或权限都不能覆盖会话上下文。

## 6. 数据一致性

### 事务边界

以下操作必须原子完成：

- 用户、成员关系、初始角色审批和审计。
- 角色批准、membership_roles 变更和审计。
- 外部动作、必要审批和审计。
- 顾问运行、上下文工具记录、引用和审计。
- 顾问人工修改、编辑历史和审计。
- 合规来源专业复核、当前 provenance、证据引用和追加审计。

对 PostgreSQL 与 MinIO 的跨存储操作无法使用单个数据库事务，因此文件采用“声明元数据—上传内容—校验完成”的状态流程。专业复核只能引用已经完成该流程的 `uploaded` 文件；当前行和历史 `professional_review` 审计都会阻止证据软归档。备份默认暂停写入以减少数据库和对象存储时间点不一致。

### 并发

可更新业务记录带 version。PATCH 需要 expectedVersion；数据库更新条件同时比较版本。冲突返回 409，客户端必须重新读取和人工合并，不能静默覆盖。

### 删除

常规 DELETE 是软归档，设置 archivedAt 并写审计。审计事件没有业务更新或删除接口。对象的法定销毁与软归档是不同流程。

## 7. 后台任务

pg-boss 与业务共用 PostgreSQL，避免为小团队维护额外消息系统。业务迁移、pg-boss 迁移与常驻 DML 身份分离：一次性 migrator 安装/升级 schema 和声明队列，API/worker 使用无 DDL 的 runtime 且以 `migrate:false` 启动。当前队列：

| 队列 | 作用 |
| --- | --- |
| advisor.run | 调用模型、校验结构和引用、写模型审计 |
| workflow.run | 顺序执行通知、建任务、请求审批或发起顾问 |
| notification.deliver | 投递站内通知；未配置渠道明确失败 |
| github.refresh | 读取 GitHub 仓库快照并更新情报 |
| compliance-source.monitor | 每日领取到期官方来源并受控抓取；人工复核到期、正文变化或连续第三次失败时，在来源状态事务内创建高优先级人工任务与关联审计 |
| obligation.sweep | 每小时按 Asia/Shanghai 扫描逾期义务和合规事件 |
| backup.create | 调用受控备份命令；内置降级只支持数据库。队列 active lease 为 2 小时 10 分钟，长于 worker 的 2 小时数据库 claim lease；超时重投只会把仍未完成的 running 记录标记为人工复核失败，不会自动重新执行可能产生部分结果的备份 |

普通任务最多重试 5 次，带退避和有效期。处理器必须使用 orgId、幂等状态和审计，重复投递不能产生虚假外部动作。备份任务的队列有效期必须与数据库 claim lease 对齐；不要把通用 10 分钟 active expiry 复用于可能运行一小时的备份命令。

## 8. 集成适配器

### 对象存储

ObjectStorage 提供 healthCheck、putVerified、head、get 和 delete。开发或测试可使用内存实现；生产使用 S3/MinIO。文件键由 orgId 和随机 UUID 组成，不使用原始文件名。

### LLM

LlmProvider 有 compatible、mock 和 disabled 模式。业务层只接收结构化 AdvisorOutput；供应商响应必须经过 schema 和证据校验。compatible 模式的 `LLM_BASE_URL` 在 API、worker 和适配器边界都必须使用 HTTPS，HTTP（包括生产环回地址）会在启动前失败；模型请求禁止跟随重定向，避免凭据或上下文被转送到未批准端点。配置或传输失败时返回失败，不允许未标识地改用另一供应商。

### GitHub

GitHubReader 只读取公开或 token 允许的仓库信息。manual 模式与真实读取必须明确区分；GitHub 内容作为不可信外部数据。

### 外部业务动作

银行、税务、发票、签章、人事和法律承诺通过 ExternalAction 记录边界。manual 记录人工执行，mock 只能 simulated，real 必须有合法稳定接口、凭据、幂等和专项审批后才能启用。

### 备份

应用内 backup.create 只负责排队和审计。内置 database-only 导出不接触主机签名私钥，也不构成完整灾备点；生产 full/files 备份必须调用受控 BACKUP_COMMAND，或由运维脚本和 systemd timer 通过一次性容器完成 age 加密与 Ed25519 来源签名。恢复始终是管理员维护操作，不由普通 Web 请求触发。

## 9. 身份、安全与审计

- 密码使用 Argon2id 哈希。
- 会话使用 HttpOnly、SameSite=Strict Cookie；生产启用 Secure。
- 登录和全局请求限流；修改请求校验 Origin。
- CORS 只允许配置的 Web origin，并允许凭据。
- Helmet 提供通用响应头；Caddy 负责内网 TLS 和入口策略。
- 所有业务读取和修改按组织隔离。
- 高风险动作与角色分配进入人工审批。
- 审计记录请求 ID、操作者、资源、前后值、IP 和 User-Agent。
- 容器使用只读根文件系统、drop capabilities、no-new-privileges 和日志轮转。

完整分析见[安全威胁模型](../security/threat-model.md)。

## 10. PWA 与客户端

Vite 构建 manifest 和 service worker，使用 autoUpdate。缓存范围只包含静态 JS、CSS、HTML、图标、图片和字体；API 与 health 路径排除导航回退，且没有运行时 API 缓存。

桌面端使用分组侧栏，移动端使用固定五入口导航。两端访问同一 API 和权限模型，不维护第二套业务逻辑。

PWA 的目标是安装体验与弱网静态壳，不是离线数据库。敏感记录不能依赖浏览器离线缓存。

## 11. 部署与可观测性

Compose 服务包括 postgres、minio、minio-bootstrap、migrate、queue-migrate、database-permissions、api、worker、web、caddy，以及 operations profile 的 db-bootstrap、seed、backup-tools。

- 全新卷先显式执行一次 `db-bootstrap --rm`；常规启动依次完成 migrate、queue-migrate、database-permissions，成功后 API 和 worker 才启动。
- API/worker 只持有 `fiatlux_runtime`；迁移所有者、bootstrap 超级用户和 restore 身份不进入常驻应用环境。
- API 暴露 live/ready。worker 封装 pg-boss 的 `work/offWork/stop`，以本进程注册表要求七个唯一订阅，并每 10 秒通过 pg-boss 自身连接只读核对全部声明队列；两者都通过才刷新私有心跳，30 秒陈旧即失去容器健康。pg-boss 没有公开的空闲订阅最近 fetch 枚举，因此该信号不冒充逐任务吞吐证明。Caddy 的健康检查同时覆盖 API 与 Web 登录壳，避免只因网关进程存在就误报可用。
- live 检查进程存活；ready 检查数据库、队列和对象存储。
- JSON 容器日志按 10 MiB、5 个文件轮转。
- PostgreSQL、MinIO、API 和 Web 不直接发布宿主端口。
- 生产 overlay 强制关键密码、HTTPS origin、Secure Cookie 和资源限制。
- CI 配置静态检查、类型、单元、集成、浏览器、镜像、依赖和安全扫描。

部署配置存在不等于部署成功。实际证据要求见[部署验证](../admin/deployment-verification.md)和[验收矩阵](../delivery/v1-acceptance-matrix.md)。

## 12. 扩展规则

新增模块时必须：

1. 在 contracts 定义输入、状态和共享类型。
2. 在 domain 放置跨入口都必须遵守的规则。
3. 在 db 添加组织作用域 schema、索引和前向迁移。
4. 在 API 添加服务端权限、Zod 校验、乐观并发和审计。
5. 长任务进入 worker，不阻塞请求。
6. 外部系统通过 integrations 端口，不把 SDK 调用散落在领域代码。
7. Web 复用资源页或建立专用工作流页，并验证桌面与移动端。
8. 补充权限拒绝、跨组织、审计、集成和端到端测试。
9. 更新 API、用户、威胁模型和运维文档。

只有在出现独立扩容、独立故障域、独立数据所有权和独立团队责任这四类证据时，才考虑拆分服务。
