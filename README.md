# FIAT LUX CHOICE

耀光（广州）电子竞技有限公司及类似中国境内 1–2 人团队的内部公司治理与运营 Web App。

当前状态：**受控候选，尚未宣布或批准 V1 完成**。仓库已经包含实质业务实现、PWA、API、worker、38 张业务表与 11 个迁移（`0000`–`0010`）、内网部署和恢复资产。2026-07-20 不可变实现提交 `101d2f0938adfa0caa8ed576f6587a5c78ae74a5` 已通过 Biome 206 文件、ShellCheck/Actionlint、7 项类型检查、177/177 单元、API 89/89、worker 25/25、真实 MinIO 2/2、mock 46+6、隔离真实栈 desktop/mobile 4/4、fresh/上一版本迁移、fresh/legacy 最小权限和生产构建；同一提交又重建七个 arm64 镜像和独立 production-like Compose，验证六服务健康、重启持久性、桌面/390×844 移动端、PWA 10 条缓存/0 安装性错误、73 条来源保持未复核、Trivy 0.70.0 HIGH/CRITICAL 0、7 份 Syft 1.42.3 SPDX，以及 age+Ed25519 一致性备份在随机全新卷精确恢复 38 表、11 migration、pg-boss 24 和逐对象 SHA。脱敏记录见[当前候选验收证据](docs/delivery/evidence/production-like-acceptance-101d2f0-20260720.json)。这些仍是本机 arm64 和底层恢复演练，不是 GHCR 双平台、经审批生产 `restore.sh`、耀光广州目标办公内网或真机证明。候选分支对应 Draft PR #12；GitHub CI/Security 仍因账户付款失败或 Actions spending limit 不足在 runner 启动前被平台阻断，尚未执行 workflow step。其余未完成闸门包括最终 Git/GitHub/GHCR 跨层身份统一与绿色 CI、经批准的生产候选/N−1 和目标环境复演、经审批生产恢复入口、耀光目标办公内网与真实受管设备、真实 LLM/GitHub 适配器、73 条真实专业复核、MinIO 长期维护/支持风险决策和专业合规/业务批准。详情见[V1 验收矩阵](docs/delivery/v1-acceptance-matrix.md)和[受控候选交付报告](docs/delivery/final-delivery-report.md)。

后继不可变实现 `5eec8cc3f4cbd0b9a12372240bca9f56d65ae5f9` 已补齐合规升级任务的协调人选择、站内通知和任务/通知/来源审计链，并把 CI/release 构建显式固定为 production 语义。该提交完成 10/10 定向 PostgreSQL、完整 worker 28/28、全仓检查、独立七镜像 production-like Compose、真实 pg-boss 组织级 sweep、桌面/移动/PWA 和 worker 镜像安全验收；脱敏记录见[协调升级增量证据](docs/delivery/evidence/compliance-coordinator-acceptance-5eec8cc-20260720.json)。这项增量证据不替代 `101d2f0…` 的完整备份恢复证据，也不关闭 GitHub、GHCR、目标内网、真机、真实适配器或专业批准闸门。

不可变容量保护增量 `51ebb28999319eaa220ac204f2a6a23bee0b4caa` 将新导入的 73 条来源分散到 7 个每日时间桶，并把每组织定时 sweep 默认限制为最早到期的 12 条。该提交完成 11/11 定向 PostgreSQL、182/182 单元、API 89/89、worker 29/29、真实 MinIO 2/2、生产构建、隔离 production Compose、桌面/移动/PWA 和安全复验；真实 pg-boss 积压断言得到 12 已领取、61 待后续、`hasMoreDue=true`，没有伪造抓取、任务、通知或专业复核。脱敏记录见[首次监控容量增量证据](docs/delivery/evidence/compliance-monitor-batch-acceptance-51ebb28-20260720.json)。它同样不替代完整恢复、GHCR、目标内网和专业批准证据。

不可变运营可见性增量 `ba25c69954015c406c6a61ff9fadadd3830741c3` 新增组织隔离、`compliance-items:read` 权限保护的合规监控状态 API 与响应式面板，分别呈现当前待领取、有效租约、首次未抓取、失败/变化和复核关注，并把历史 `hasMoreDue` 明确限定为“当时”事实。该提交完成 212 文件静态检查、186/186 单元、API 90/90、worker 29/29、真实 MinIO 2/2、mock 46+6、生产构建和独立 production Compose；真实桌面/移动/PWA、六服务重启、三镜像 Trivy/SPDX 与临时资源清理均通过。脱敏记录见[监控运营状态增量证据](docs/delivery/evidence/compliance-monitoring-status-acceptance-ba25c69-20260720.json)。面板刷新不会抓取或复核，任何指标都不证明法规有效、适用或已获专业批准；本增量也不替代基线恢复、GitHub/GHCR、目标内网和真实责任人验收。

## 能力

- 用户、组织、数据库会话、四级 RBAC 和追加审计。
- 文件、目标、项目、任务、决策、公司义务、合规日历、风险和合同。
- 简易收支、发票、现金流、产品组合、市场机会和 GitHub 技术情报。
- 人工审批、真实外部动作状态、站内通知和后台工作流。
- 顾问、工作流和备份 `lease_expired` 的组织隔离人工处置看板；证据化关闭不修改或重放原失败运行。
- 总经理、财务、法务合规、产品研发、市场机会、人力行政和信息安全七类 AI 顾问。
- React/Vite 响应式前端、移动导航和可安装 PWA。
- Fastify API、PostgreSQL/Drizzle、MinIO/S3、pg-boss worker。
- Docker Compose 内网拓扑、Caddy TLS、迁移、健康检查、CI、安全扫描、备份恢复和升级回滚资产。
- 73 条中国、广东、广州官方合规来源、受控抓取/哈希、到期/变化/连续失败自动建人工任务，以及实名、机构、胜任依据、缺失信息、版本与证据锁定的追加式专业复核工作流。
- 4 篇面向中国境内成年人的版本化电竞教育基础内容，包含 Schema、来源、权利、AI 披露、人工复核和 WordPress 手工发布边界。

高风险动作不会被自动执行。银行付款、税务申报、发票红冲、合同正式签署、合同终止、人事处分、关键权限修改和对外法律承诺共八类动作必须人工批准；创建请求只接受 `manual` 或 `mock`，`real` 会被拒绝。`manual` 必须凭外部回执推进，`mock` 只能得到 simulated/cancelled，不能伪造外部成功；合同签署、合同终止和发票红冲只有在 confirmed 时才与目标合同/发票状态原子更新。

关键一致性边界：

- 通知创建时只能是 `queued`；客户端不能直接写入 sent/failed，投递 worker 将根据真实结果推进状态。
- GitHub 刷新在排队时固定 `expectedVersion`，worker 以 CAS 写回；人工或其他任务先修改记录时，陈旧网络结果不得覆盖新数据。
- 工作流运行创建时保存定义版本和不可变步骤快照；之后编辑工作流定义不会改写已排队运行。
- 已关联草稿支出的银行付款若在受支持状态取消，或人工审批驳回，系统在同一事务解除台账关联并增加版本，使修正后的新申请可重新关联。
- 顾问运行默认只对发起人可见；只有具有 `advisor-runs:read-all` 或全局权限的用户才可读取他人运行，且仍必须拥有该顾问入口和所有上下文资源的读权限。
- 义务和合规日历将法规来源 `sourceId` 与完成凭证 `evidenceFileId` 分开维护；凭证必须是本组织已完成上传的文件，关联来源本身不等于规则已经人工判定适用。
- 合规来源人工复核到期、已有正文哈希变化或连续第三次抓取失败时，worker 在来源状态事务内创建高优先级任务：人工触发优先指派执行时仍有效且仍有 `compliance-items:update` 权限的触发者，定时触发或触发者已停用/失权时确定性指派最早加入的有效 owner，并原子生成已送达的站内通知和关联审计。该人只是协调责任人，不会自动认定其具备专业资质，也不会认定法规有效、适用或已复核；邮件/企业协作仍需经批准适配器。
- 新导入的合规目录按 7 个每日时间桶分散；worker 每组织每次默认按最早到期顺序领取 12 条，`monitor_dispatch.hasMoreDue` 明示剩余积压。该容量保护不限制有权用户逐条人工检查，也不削弱连续第三次失败的人工升级。
- 文件二进制 PUT 在进入对象存储前校验实际内容：文本/JSON、PDF/图片格式信封及 OOXML 包结构、主部件、展开上限和活动内容边界；该门禁仍不是反病毒、PDF/图片完整语义解析或 DLP，所有附件继续按不可信内容处理。
- 角色分配/移除审批保存 membership 的 `expectedVersion` 与幂等键；等待审批期间成员或角色关系已变更时，旧审批冲突失败，不会在新版本上静默执行。
- 顾问、工作流或备份租约失效后保持 `failed`，owner/admin 必须核对 partial output 与外部状态。“运行异常处置”要求证据、必要的补偿引用和禁止自动重放确认；提交只追加人工审计，同一事件只能关闭一次，不会调用队列、模型、工作流或备份命令。

## 架构

~~~text
桌面/移动 PWA -> Caddy -> Web + Fastify API -> PostgreSQL + MinIO
                                      |
                                      +-> pg-boss worker
                                           -> LLM / GitHub / 人工适配器
~~~

采用模块化单体：前端、API 和 worker 分离运行，contracts、domain、db、integrations 形成清晰包边界；核心业务和审计保留在同一 PostgreSQL 事务域。

阅读[架构说明](docs/architecture/modular-monolith.md)和[ADR-001](docs/architecture/adr-001-modular-monolith.md)。

## 快速启动

前置条件：

- Node.js 24 或更高
- pnpm 11
- Docker Engine
- Docker Compose v2

开发 Compose：

~~~sh
cp .env.example .env
~~~

先修改 .env 中的开发密码，不要在共享环境使用示例值，然后：

~~~sh
./scripts/compose.sh build
./scripts/bootstrap-database.sh
./scripts/compose.sh up -d --wait
SEED_MODE=bootstrap ./scripts/compose.sh run --rm seed
./scripts/compose.sh ps
~~~

访问 http://localhost:8080。初始账号来自 INITIAL_ADMIN_EMAIL 和 INITIAL_ADMIN_PASSWORD。

`bootstrap-database.sh` 先创建独立的 migration/runtime/backup/restore 身份，再迁移业务与 pg-boss schema；常驻 API/worker 没有 DDL。`seed` 是**非日常运维命令**，不得加入普通启动、重启、升级或定时任务。首次空组织必须显式使用 `SEED_MODE=bootstrap`；它创建组织、bootstrap user、active membership、owner assignment、四个内置角色及其权限基线，遇到既有组织 slug 会失败关闭，不会自动转成重跑。只有该模式接受并读取 admin name/password。首次 owner 和后台新建成员都带 `mustChangePassword`；首次改密前只能访问 `me`、`change-password` 和 `logout`，成功后保留当前会话并撤销其他会话。

既有组织必须显式选择 `SEED_MODE=metadata-only`；该模式不接受也不读取 admin name/password，不更新组织或人员字段，不创建/修改 membership、assignment、系统角色或权限，只补齐缺失的内置顾问提示词 v1，并按官方来源文件导入或更新合规来源元数据。每个实际新建的提示词版本都会写 system actor、seed mode、版本信息和提示词 SHA-256 的追加审计，CLI 输出对应 metadata requestId；既有提示词不被覆盖。来源元数据变化会保留人工复核证据并按规则标记 stale/uncertain。要补充新版 `SYSTEM_ROLE_PERMISSIONS`，必须取得关键权限变更的人工批准，显式选择 `SEED_MODE=system-role-maintenance`，并提供本组织 active owner 的 `SEED_MAINTENANCE_OPERATOR_EMAIL`、`SEED_MAINTENANCE_REASON`、`SEED_MAINTENANCE_APPROVAL_REFERENCE` 和唯一 `SEED_MAINTENANCE_REQUEST_ID`；该模式同样拒绝 admin name/password。维护模式只补缺失的内置角色/权限，并为每项 before/after 写追加审计；即使开启也绝不创建 membership 或恢复 owner assignment。生产步骤见[内网部署手册](docs/admin/intranet-deployment.md#5-首次启动与初始化)与[数据库角色手册](docs/admin/database-roles.md)。

### 唯一 owner 离线恢复

系统不提供公开或 API 密码恢复端点。唯一 active owner 忘记密码时，只能在完成线下身份核验和人工批准后，由受控生产主机运行一次性 CLI。CLI 要求精确的小写组织 slug 与 owner email、固定生产确认值、reason、批准/变更编号和唯一 requestId；目标必须仍是该组织未归档的 active owner。临时密码只能从 stdin 或重定向的 secret 文件读取，不能放入参数、环境变量、日志或文件命令行，且须为 14–256 字符并与旧密码不同。

生产 Compose one-off 示例（先在隐藏输入中读取临时密码，命令结束立即清除变量）：

~~~sh
read -r -s -p 'New temporary owner password: ' OWNER_RECOVERY_TEMPORARY_PASSWORD
printf '\n'
printf '%s\n' "$OWNER_RECOVERY_TEMPORARY_PASSWORD" | \
  docker compose --env-file /etc/fiatlux-choice/production.env \
    -f compose.yml -f compose.prod.yml --profile operations \
    run --rm -T --no-deps \
    -e OWNER_RECOVERY_ORG_SLUG=fiat-lux \
    -e OWNER_RECOVERY_EMAIL=owner@example.com \
    -e OWNER_RECOVERY_PRODUCTION_CONFIRMATION=RESET_ACTIVE_OWNER_PASSWORD_AND_REVOKE_ALL_SESSIONS \
    -e OWNER_RECOVERY_REASON='Approved offline identity recovery' \
    -e OWNER_RECOVERY_APPROVAL_REFERENCE=CHANGE-2026-0043 \
    -e OWNER_RECOVERY_REQUEST_ID=owner-recovery-2026-0043 \
    seed node packages/db/dist/owner-recovery-cli.js
recovery_status=$?
unset OWNER_RECOVERY_TEMPORARY_PASSWORD
test "$recovery_status" -eq 0
~~~

成功时同一数据库事务写入 Argon2id 临时密码、设置 `mustChangePassword=true`、撤销该用户在所有组织的全部未撤销会话并追加不含密码的审计。owner 用临时密码登录后仍只能访问 `me`、`change-password`、`logout`，必须立即设置新的独立密码。slug/email 不匹配、非 owner、inactive/archived membership 或 owner role、缺少批准控制、重复 requestId及同旧密码都会整体失败，不产生部分恢复。

停止服务：

~~~sh
./scripts/compose.sh down
~~~

生产环境不要直接沿用上述开发配置。按[内网部署手册](docs/admin/intranet-deployment.md)准备密钥、内网 DNS、CA、备份介质和生产 overlay。

## 本地开发

安装依赖：

~~~sh
pnpm install --frozen-lockfile
~~~

常用命令：

~~~sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:database-migrations
pnpm test:e2e
pnpm build
pnpm check
~~~

pnpm check 必须全部通过才能发布。不要因为单独的 build 通过就跳过类型、测试或生产部署验证。

数据库：

~~~sh
pnpm db:migrate
SEED_MODE=bootstrap pnpm db:seed
~~~

`pnpm db:seed` 同样只用于上述三种显式模式，不是开发服务器的日常启动命令。bootstrap 完成后应清除引导密码；metadata-only 和 system-role-maintenance 如果收到 `INITIAL_ADMIN_*` 或 `BOOTSTRAP_ADMIN_*` 身份字段会拒绝运行，不能使用任意占位密码。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| apps/web | React/Vite/PWA 前端 |
| apps/api | Fastify API |
| apps/worker | pg-boss 后台任务 |
| packages/contracts | Zod 契约和共享类型 |
| packages/domain | 权限、审批、外部动作和顾问领域规则 |
| packages/db | Drizzle schema、迁移和种子 |
| packages/integrations | LLM、GitHub、对象存储和队列适配器 |
| content/compliance | 结构化官方来源 |
| content/education | 版本化电竞教育文章、JSON Schema 与维护流程 |
| infra | Caddy、环境、systemd 和部署资产 |
| scripts | Compose、验证、备份、恢复、升级和回滚 |
| docs | 产品、用户、架构、安全、合规、API、运维与交付文档 |

## 文档

### 产品与用户

- [产品范围](docs/product/product-scope.md)
- [电竞教育在线业务策略](docs/product/esports-education-strategy.md)
- [成人电竞教育试点课程包](docs/product/adult-esports-pilot-curriculum.md)
- [电竞教育内容资产维护](content/education/README.md)
- [fiatlux.gg 公开业务与内容盘点](docs/research/fiatlux-gg-public-business-audit.md)
- [角色与权限](docs/user/roles-and-permissions.md)
- [核心业务操作](docs/user/core-workflows.md)
- [AI 顾问与审计](docs/user/ai-advisors-and-audit.md)

### 架构与 API

- [模块化单体架构](docs/architecture/modular-monolith.md)
- [ADR-001](docs/architecture/adr-001-modular-monolith.md)
- [API 指南](docs/api/api-guide.md)
- 运行后 Swagger UI：/api/docs

### 管理、安全与合规

- [内网部署](docs/admin/intranet-deployment.md)
- [运维手册](docs/admin/operations-runbook.md)
- [部署验证](docs/admin/deployment-verification.md)
- [备份与恢复](docs/admin/backup-restore.md)
- [升级与回滚](docs/admin/upgrade-rollback.md)
- [PostgreSQL 最小权限角色](docs/admin/database-roles.md)
- [安全加固](docs/security/hardening.md)
- [安全威胁模型](docs/security/threat-model.md)
- [事件响应](docs/security/incident-response.md)
- [合规资料索引](docs/compliance/README.md)
- [合规研究方法](docs/research/compliance-research-methodology.md)

### 交付与路线图

- [V1 验收矩阵](docs/delivery/v1-acceptance-matrix.md)
- [已知边界](docs/delivery/known-boundaries.md)
- [受控候选交付报告](docs/delivery/final-delivery-report.md)
- [最终交付报告模板](docs/delivery/final-delivery-report-template.md)
- [0–24 个月路线图](docs/delivery/roadmap.md)

## API

API 基础路径是 /api/v1，使用组织作用域的 HttpOnly 会话 Cookie。健康端点为 /health/live 和 /health/ready。

当前生成 OAS 3.1 候选文档；不可变实现提交 `101d2f0…` 已用标准 parser 和运行时清单对账 75 个 path、140 个 operation，并校验认证、参数、请求和响应 schema。GitHub/目标环境仍要复现，并建立兼容性 diff、弃用策略和受支持 SDK 生成交付。集成前请阅读[API 指南](docs/api/api-guide.md)；文件上传必须依次完成元数据声明、二进制 PUT 和 `POST /files/:id/complete`。

## 安全与数据

- 不要提交 .env、生产数据库、附件、备份、Cookie、LLM/GitHub token 或 age 私钥。
- 生产只通过 Caddy 暴露 HTTPS，数据库和 MinIO 不发布到办公网。
- 默认 LLM_DRIVER=mock、GITHUB_INTEGRATION_MODE=manual；启用真实适配器前完成权限、供应商和数据处理复核。
- 合规来源默认 pending/draft。只有具备完整复核人/机构/胜任依据/缺失信息/证据/站内登记人/版本 provenance、reviewed、active 且 `nextReviewAt` 尚未到期的记录才可进入顾问事实上下文；空复核日、legacy 部分状态与过期来源 fail closed，关联义务还要求来源结论为 applicable。
- 类型化关系已覆盖决策到目标/项目/任务、产品到项目、机会到产品/项目；API 会校验同组织活动记录，并强制同时填写的决策引用属于同一目标→项目→任务链、机会项目等于所选产品的活动项目。父记录改链或归档不能破坏现有活动引用。
- member/viewer 只能读取本人通知并通过专用 read 端点标记已读；admin/owner 可跨收件人创建、查看和归档，通知内容对所有角色都不可 PATCH。
- 合同或发票只能引用同组织、已 uploaded、未归档的文件；被合同或发票引用的文件不能归档，引用与归档检查由事务锁串行化。
- 备份只有在独立恢复演练通过后才有效。

安全问题按[事件响应流程](docs/security/incident-response.md)处理，不在公开 issue 中粘贴凭据或公司数据。

## 许可证

本项目采用专有许可，版权归耀光（广州）电子竞技有限公司所有。除非另有书面协议，不授予使用、复制、修改、发布、分发、再许可或销售权；完整条款见 [LICENSE](LICENSE)。
