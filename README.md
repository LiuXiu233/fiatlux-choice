# FIAT LUX CHOICE

耀光（广州）电子竞技有限公司及类似中国境内 1–2 人团队的内部公司治理与运营 Web App。

当前状态：**受控候选，尚未宣布或批准 V1 完成**。仓库已经包含实质业务实现、PWA、API、worker、数据库、内网部署和恢复资产。2026-07-18 的本地候选验证已通过静态检查、类型检查、单元/真实集成/聚合/E2E、生产构建、本机 production-like HTTPS 冒烟、最终 age 加密备份、独立恢复以及两个候选标签之间的实际升级/回滚。尚未完成的闸门是不可变 Git/GitHub CI 证据、耀光目标办公内网与真实受管设备、真实 LLM/GitHub 适配器、MinIO OSS 未修复漏洞风险决策和专业合规/业务批准。详情见[V1 验收矩阵](docs/delivery/v1-acceptance-matrix.md)和[受控候选交付报告](docs/delivery/final-delivery-report.md)。

## 能力

- 用户、组织、数据库会话、四级 RBAC 和追加审计。
- 文件、目标、项目、任务、决策、公司义务、合规日历、风险和合同。
- 简易收支、发票、现金流、产品组合、市场机会和 GitHub 技术情报。
- 人工审批、真实外部动作状态、站内通知和后台工作流。
- 总经理、财务、法务合规、产品研发、市场机会、人力行政和信息安全七类 AI 顾问。
- React/Vite 响应式前端、移动导航和可安装 PWA。
- Fastify API、PostgreSQL/Drizzle、MinIO/S3、pg-boss worker。
- Docker Compose 内网拓扑、Caddy TLS、迁移、健康检查、CI、安全扫描、备份恢复和升级回滚资产。
- 72 条中国、广东、广州官方合规来源及人工复核工作流。

高风险动作不会被自动执行。付款、报税、发票红冲、正式签署、人事处分、关键权限修改和对外法律承诺默认需要人工批准；manual/mock 不会伪造外部成功。

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
./scripts/compose.sh up -d --build --wait
./scripts/compose.sh run --rm api node packages/db/dist/seed-cli.js
./scripts/compose.sh ps
~~~

访问 http://localhost:8080。初始账号来自 INITIAL_ADMIN_EMAIL 和 INITIAL_ADMIN_PASSWORD。

`seed-cli` 是显式初始化步骤，不会随普通启动自动执行；重复运行会把引导 owner 的密码重置为当前环境变量中的值。首次登录后应在“设置 → 登录密码”立即改为新的独立密码，确认其他会话已撤销，并停止分发引导密码。生产步骤和重跑限制见[内网部署手册](docs/admin/intranet-deployment.md#5-首次启动与初始化)。

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
pnpm test:e2e
pnpm build
pnpm check
~~~

pnpm check 必须全部通过才能发布。不要因为单独的 build 通过就跳过类型、测试或生产部署验证。

数据库：

~~~sh
pnpm db:migrate
pnpm db:seed
~~~

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
| infra | Caddy、环境、systemd 和部署资产 |
| scripts | Compose、验证、备份、恢复、升级和回滚 |
| docs | 产品、用户、架构、安全、合规、API、运维与交付文档 |

## 文档

### 产品与用户

- [产品范围](docs/product/product-scope.md)
- [电竞教育在线业务策略](docs/product/esports-education-strategy.md)
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

Swagger 当前以路由、标签和摘要为主，部分 Zod 请求/响应结构尚未完整进入 OpenAPI。集成前请阅读[API 指南](docs/api/api-guide.md)和 `packages/contracts/src/index.ts`；文件上传必须依次完成元数据声明、二进制 PUT 和 `POST /files/:id/complete`。

## 安全与数据

- 不要提交 .env、生产数据库、附件、备份、Cookie、LLM/GitHub token 或 age 私钥。
- 生产只通过 Caddy 暴露 HTTPS，数据库和 MinIO 不发布到办公网。
- 默认 LLM_DRIVER=mock、GITHUB_INTEGRATION_MODE=manual；启用真实适配器前完成权限、供应商和数据处理复核。
- 合规来源默认 pending/draft。只有 reviewed 且 active 的记录才可进入顾问事实上下文。
- 备份只有在独立恢复演练通过后才有效。

安全问题按[事件响应流程](docs/security/incident-response.md)处理，不在公开 issue 中粘贴凭据或公司数据。

## 许可证

本项目采用专有许可，版权归耀光（广州）电子竞技有限公司所有。除非另有书面协议，不授予使用、复制、修改、发布、分发、再许可或销售权；完整条款见 [LICENSE](LICENSE)。
