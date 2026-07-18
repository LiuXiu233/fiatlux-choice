# V1 验收矩阵

基准日期：2026-07-18

版本状态：**受控候选，尚未达到“V1 完成并批准上线”条件**

## 1. 证据口径

| 状态 | 含义 |
| --- | --- |
| 本地候选已验证 | 在本地候选工作树或 production-like QA 环境得到可重复通过结果，但尚未绑定最终 Git SHA |
| 历史证据 | 结果真实有效，但其后源码或镜像已有变化，不能作为最终发布证据 |
| 已实现 / 待目标验证 | 代码和配置存在，尚缺最终 Git SHA、GitHub 或目标办公内网证据 |
| 边界 / 待决策 | 实现有明确能力边界，需补实现或由负责人决定是否阻断 V1 |
| 待执行 / 阻断 | 未完成前不能宣布 V1 完成 |

本矩阵严格区分代码存在、本机候选验证、GitHub CI、目标办公内网和真实外部集成。`https://choice.localhost:18443` 是开发机上的 production-like Docker Compose QA，不是耀光广州办公内网生产部署。本地候选数字都必须在最终提交的完整 Git SHA 上由 GitHub CI 或对应的受控运行环境复现，不能自动升级为最终发布证据。

## 2. 产品能力

| 验收项 | 当前实现与验证 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| 响应式 Web 与导航 | Playwright 共 10 个测试定义：9 个在桌面和 iPhone 14 Chromium 仿真各运行一次，另 1 个仅移动项目运行；结果 19 passed、桌面项目 1 个预期条件 skip。另完成桌面与仿真移动视觉检查 | 本地候选已验证 | 最终 Git SHA 复跑；目标受管设备至少完成一次真实手机浏览器验证，不能把仿真称为真机 |
| PWA 与离线边界 | 生产构建生成 manifest/service worker，9 项 precache；本机 HTTPS 验证 Service Worker、离线壳、离线隐藏工作区与登录表单、恢复网络后重新验证会话 | 本地候选已验证 | 最终 Git SHA 复跑安装、升级、离线和缓存清理；目标受管设备安装验证 |
| 身份与会话 | Argon2id、数据库会话、HttpOnly/Secure/SameSite Cookie、限流、改密并撤销其他会话；本机 HTTPS 中待审批成员登录返回 403 且没有会话 | 本地候选已验证 | 最终 Git SHA 复跑 owner/member/停用/改密；目标内网验证 CA 和 Cookie |
| 四级 RBAC | owner/admin/member/viewer，服务端权限 hook 与组织作用域；API 集成覆盖允许、拒绝、跨组织和待审批成员 | 本地候选已验证 | 最终 Git SHA 抽查跨组织、财务、文件、审计和关键权限拒绝 |
| 追加审计 | 请求 ID、人工/系统 actor、前后值、拒绝与 worker 事件；本机 HTTPS 验证 409 拒绝审计且不保存请求体 | 本地候选已验证 | 最终 Git SHA 抽查核心动作、拒绝、模型和后台任务；确认数据库/主机运维分权 |
| 文件 | 私有对象键、三步上传、大小/SHA-256 校验和权限下载；最终运行栈完成 68 字节 MinIO 上传/下载，核心链集成完成 70 字节 S3/SHA 校验；MinIO 专项 2 passed、零 skip | 本地候选已验证 | 目标内网复跑篡改拒绝、归档与全量恢复对象核对 |
| 目标、项目、任务、决策 | CRUD、状态、版本与 UI 已实现；新增核心链集成验证目标→项目→任务强外键 | 本地候选已验证 / 有边界 | 决策目前没有 objective/project/task 类型化外键；不得把文字约定表述为完整类型化闭环 |
| 产品、机会、项目 | 产品、机会和项目 CRUD/UI 可用 | 本地候选已验证 / 有边界 | products、opportunities 与 projects 之间尚无类型化关联；需补关联或批准受限的人工交叉引用流程 |
| 义务、合规、风险、合同 | 资源 API/UI、逾期 worker、合同文件引用和状态规则已实现；核心链集成覆盖 pending 官方来源→义务/事件及文件→合同/发票引用 | 本地候选已验证 | pending 引用只证明关系完整性，不代表来源适用；仍需 reviewed 来源的人工复核场景与合同外部回执 |
| 收支、发票、现金流 | 整数分、乐观版本和外部动作引用已实现；核心链集成覆盖收支/现金流，签署、银行和红冲 manual 动作只到 approved、不进入 confirmed | 本地候选已验证 | 最终 Git SHA 复跑；人工核对真实会计边界，真实外部回执仍不在候选证据内 |
| GitHub 技术情报 | manual/read-only 适配器边界、刷新队列与审计已实现 | 已实现 / 待目标验证 | `GITHUB_INTEGRATION_MODE=manual` 候选环境不证明真实 GitHub；经批准最小权限 token 后另行验证 |
| 通知与工作流 | notify、create_task、request_approval、advisor_run；真实 pg-boss 工作流达到 completed 并创建任务，队列失败状态可见 | 本地候选已验证 | 最终 Git SHA 复跑成功、失败、重试和组织隔离；email/webhook 无适配器时仍应明确失败 |
| 审批与外部动作真实性 | 七类高风险动作默认人工批准；本机 HTTPS 验证银行动作保持 `pending_approval/manual`，幂等重放与冲突正确 | 本地候选已验证 | 最终 Git SHA 复跑申请、批准/拒绝和人工回执；不得用 manual/mock 冒充外部成功 |
| 七类 AI 顾问 | 权限过滤、结构化输出、提示词/模型/工具/引用/人工编辑审计；七类均以 mock 完成，未复核合规来源被法务顾问 withheld | 候选流程已验证 | `LLM_DRIVER=mock` 不证明真实模型质量；真实供应商、数据处理和质量评测仍待批准 |
| 成员与关键权限 | 创建成员时 membership 为 pending，审批前不能登录；角色变更事务、最后 owner 保护和单人例外确认已实现 | 本地候选已验证 | 最终 Git SHA 复跑两人审批与单人补偿控制，抽查角色生效和拒绝审计 |

## 3. 合规知识库

| 验收项 | 当前证据 | 状态 | 剩余工作 |
| --- | --- | --- | --- |
| 官方来源数据集 | `content/compliance/official-sources.json` 共 72 条，覆盖中国、广东、广州官方来源 | 本地候选已验证 | 最终 Git SHA 校验条数、URL 与元数据哈希 |
| 人工复核状态 | 72 条全部保持 `reviewStatus=pending`、`contentHashStatus=pending_fetch`、业务 `status=draft` | 正确保持未复核 | 必须逐条由可识别人员复核；不得批量改为 reviewed/active |
| 适用条件 | 法域、适用条件、更新时间和复核字段可维护 | 已实现 / 待专业复核 | 公司事实、教育模式、人员与数据流由负责人填写，并取得必要法务/财税意见 |
| 易变政策 | 来源数据与状态工作流避免把结论永久硬编码 | 已实现 / 待运营 | 建立真实监控、正文快照、哈希差异和复核负责人 |
| 顾问使用边界 | 只有 reviewed 且 active 的来源进入法律顾问事实语境；pending 来源被 withheld | 本地候选已验证 | 真实模型启用后重新验证引用和越权边界 |

这些来源不是专业合规批准，也不证明任何结论适用于公司。

## 4. 工程质量与失败历史

以下历史失败不得删除；右列记录同日后续复测。

| 检查 | 原始失败 | 最新候选复测 | 状态 |
| --- | --- | --- | --- |
| Biome | 50 errors、6 warnings | 118 个纳入 Biome 的源码与配置文件检查通过；gitignored 的 backups/data/screenshots/tmp 运行数据与证据目录按设计排除 | 本地候选已验证；GitHub CI 待复现 |
| 类型检查 | 两处 API 集成测试 response header 类型错误 | 7 个工作区全部通过 | 本地候选已验证；最终 Git SHA 重跑 |
| 聚合测试 | Vitest 曾错误收集 Playwright 文件 | 修正聚合范围并新增核心链后完整复跑 77 passed、0 failed、0 skipped | 本地候选已验证；GitHub CI 待复现 |
| 数据库包测试脚本 | 曾因没有测试文件失败 | 已修正测试覆盖/脚本语义，纳入 46 个单元与聚合复测 | 本地候选已验证；最终 Git SHA 重跑 |
| Playwright 端口 | 首次默认端口 4173 连接到无关应用 | 改用隔离端口 4174；19 passed、1 个桌面项目预期条件 skip | 本地候选已验证；不得再使用 4173 |

最新候选测试清单：

| 层级 | 结果 | 说明 |
| --- | --- | --- |
| 静态检查 | 118 个纳入 Biome 的源码与配置文件通过 | gitignored 的运行数据与证据目录不属于源码检查范围 |
| 类型检查 | 7 个工作区通过 | 所有工作区脚本 |
| 单元测试 | 46 passed | 0 failed |
| 真实集成测试 | 31 passed、0 skipped | API 25、worker 4、MinIO/S3 2；新增核心链用例已单独通过 |
| 聚合测试 | 77 passed | 新增核心链后完整实跑，0 failed、0 skipped |
| Playwright | 19 passed、1 expected conditional skip | 10 个测试定义，不是 19 个独立业务闭环 |
| PWA 构建 | 9 项 precache | manifest 与 service worker 已生成 |
| 生产依赖审计 | 0 vulnerabilities | 使用 pnpm 官方 registry；GitHub 安全工作流待复现 |

## 5. 部署、运维与安全

| 验收项 | 当前证据 | 状态 | 最终闸门 |
| --- | --- | --- | --- |
| Compose 与迁移 | 最终本地 content digest 已强制重建并部署；2 个迁移、37 张表、ready、重启和数据持久性通过 | 本地候选已验证 | 目标办公内网从空卷验证 |
| HTTPS 与 CSP | Caddy internal CA 下 `https://choice.localhost:18443` 冒烟、浏览器与 CSP 验证通过 | 本地候选已验证 | 目标内网 DNS、CA 分发、防火墙和真实 HTTPS 仍待执行 |
| 六个候选镜像 | API、worker、web、gateway、MinIO、backup 均已构建、运行并记录 digest；逐镜像为 0 个可修复 HIGH/CRITICAL | 本地候选已验证 / 有边界 | 严格报告仍有 API 21、worker 22、MinIO 6 个无公开修复版本项；MinIO 风险须迁移、供应商修复或负责人限期接受 |
| 文件系统与依赖安全 | Trivy 文件系统 0 个可修复 HIGH/CRITICAL；生产依赖审计 0 vulnerabilities | 本地候选已验证 | 最终暂存内容 Gitleaks、Git 历史和 GitHub CodeQL/安全工作流 |
| GitHub Actions | workflow 配置存在，第三方 Actions 已固定到 commit SHA | 已实现 / 待运行 | 目标私有仓库最终提交上的 CI、Trivy、Gitleaks、SBOM 通过；CodeQL 须实际通过，entitlement 不可用时记录“未运行”并补经批准的等效 SAST，不得把 skip 记为通过 |
| 数据库备份 | worker/Web 备份 ID `f8749e09-ed0c-4b81-84c0-ba009fc7ee0e`，224825 bytes，SHA-256 `59221f15f88938ef9acd24f01feb547b902961e29b1a27cc7e4ca2e1733e43bb`，age 加密，`pg_restore --list` 368 项 | 本地候选已验证 | 目标内网建立异介质副本和周期恢复 |
| 全量备份与恢复 | `final-rc-20260718T115003Z.tar.gz.age`，SHA-256 `59e251fb1176a4afca5496b3153f61e206c2e6ed9830f7cd17e7bbdcb1b289f1`；新随机项目/卷恢复 37 表、4 对象、迁移与 readiness，实测 16 秒 | 本地候选已验证 | 业务负责人批准 RPO/RTO；目标内网和异介质复演 |
| 升级与回滚 | 临时本机 OCI Registry 的 `qa-rc-a`/`qa-rc-b` 实际演练；升级 35 秒、升级 35 秒、应用回滚 33 秒，全部 ready | 本地候选已验证 | 标签内容相同，只验证运维机制；真实 schema 变更仍需 expand/contract 专项演练 |
| 目标内网 | 尚未在耀光广州办公内网部署 | 待执行 / 阻断 | 主机基线、DNS、CA、设备、备份介质、运行观察与批准 |
| GitHub 交付 | 目标为私有 `LiuXiu233/fiatlux-choice`；当前仍无可引用的最终提交、PR 和绿色 CI | 待执行 / 阻断 | 最终审阅、secret scan、提交、推送、PR/合并和 CI 证据 |

候选镜像 ID 与最终 Git SHA 不是同一概念。最终 Git SHA、CI run 和 registry digest 仍须在发布后补录；本地镜像 digest、备份 ID 和恢复报告只作为可追踪的候选证据保留。

## 6. 核心场景状态

| 场景 | 当前证据 | 仍需完成 |
| --- | --- | --- |
| 待审批成员 | 登录 403、无会话 | 最终 Git SHA 验证批准后角色生效、拒绝与单人补偿 |
| RBAC 与拒绝审计 | API 集成和 HTTPS QA 已覆盖；核心链验证跨组织拒绝和审计不可经 API 篡改，409 审计不保存请求体 | 最终 Git SHA 复跑并抽查跨组织数据 |
| 目标—项目—任务—决策 | 页面/API 可操作，目标→项目→任务有类型化关联 | 决策缺少类型化关联；不能声明完整 typed chain |
| 产品—机会—项目 | 三类记录可操作 | 缺少类型化关联；补实现或批准人工关联边界 |
| 合规 | 未复核来源被法律顾问 withheld；核心链证明 pending 来源可被义务/事件引用 | 72 条均未人工复核；pending 引用不是适用性批准，不能制造 reviewed 场景作为合规批准 |
| 文件 | 最终运行栈的 68 字节 MinIO 和核心链的 70 字节 S3/SHA 均通过；最终全量恢复核对 4 对象 | 目标内网复核对象、元数据和异介质副本 |
| 高风险外部动作 | 银行 HTTPS 冒烟保持 pending_approval/manual；核心链中签署、银行、红冲 manual 只到 approved、不进入 confirmed | 内部批准不能证明真实银行/签章/发票平台完成；仍需人工外部回执 |
| 七类顾问 | mock 七类均 completed，调用审计可追溯 | 真实 LLM 质量和数据处理尚未验证 |
| 工作流 | completed 并创建真实任务 | 最终 Git SHA 复跑失败和重试证据 |
| 桌面、移动与 PWA | 本机桌面 Chromium 与 iPhone 14 Chromium 仿真通过，离线恢复通过 | 目标真实手机与受管设备安装 |
| 部署与恢复 | 本机 production-like HTTPS、最终隔离恢复和实际升级/回滚通过 | 目标内网部署、真实受管设备和批准 |

## 7. 当前结论

该仓库已超过脚手架、静态仪表盘和数据库模型阶段。本地候选的主要工程测试、真实 PostgreSQL/MinIO/pg-boss、本机 HTTPS、权限/审计、PWA 离线边界和隔离恢复演练均有通过证据。

当前仍只能称为**受控候选**。本地候选验证、最终恢复和实际升级/回滚演练已完成；在 GitHub 提交/CI、安全历史扫描、MinIO OSS 剩余风险决策、耀光目标办公内网与真实设备、专业合规复核和业务批准完成前，不得宣布“V1 已完成”，也不得用于无人监督的生产关键操作。

## 8. 最终 SHA 与目标环境必须补录

| 字段 | 当前值 | 要求 |
| --- | --- | --- |
| 完整 Git SHA / tag | **待创建** | 记录不可变 SHA 与 tag |
| GitHub PR / CI / 安全 run | **待执行** | 链接最终提交对应的绿色运行 |
| 六镜像 digest | **候选值，待替换** | 从最终 SHA 重建并记录 digest |
| 最终测试报告 | **本地已实跑** | 118 静态、7 类型、46 单元、31 集成、77 聚合、19+1 E2E 与构建；GitHub CI 待复现 |
| 最终备份 ID / SHA-256 | **本地已生成并验证** | 见本矩阵第 5 节；目标内网仍需异介质策略 |
| 最终恢复报告 / RPO / RTO | **本地已重跑** | 37 表、4 对象、16 秒；业务 RPO/RTO 批准待完成 |
| 目标办公内网 | **未部署** | 记录主机、DNS、CA、设备、网络和批准人 |
| 业务/安全/法务/财税批准 | **未取得** | 由真实责任人签署，不得由系统代填 |
