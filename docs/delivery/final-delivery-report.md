# FIAT LUX CHOICE 受控候选交付报告

报告日期：2026-07-20

报告状态：**受控候选记录，不是 V1 已完成、已批准上线或 GitHub CI 已通过的声明**

本报告区分“不可变基线实现 `101d2f0…` 的完整本地工程/Compose/镜像/恢复证据”“不可变协调增量 `5eec8cc…`”“不可变容量保护增量 `51ebb28…`”“不可变运营状态增量 `ba25c69…`”“不可变运行异常实现 `f86bff4…`”“不可变电竞教育实现 `fccbaf9…`”“不可变发布门禁实现 `213d9b6…`”“不可变平台证明实现 `6e40b82…`”“不可变目标内网证明入口 `25204d3…`”“不可变受管真机证据入口 `ffe102e…`”“不可变真实适配器防护 `d7cc156…`”“不可变教育放行入口 `f4c12b5…`”“最终 GitHub/GHCR”和“目标办公内网验收”。完整 age+Ed25519 恢复绑定 `101d2f0…`；后续实现分别绑定自己的增量证据。脱敏机器记录见[基线证据](./evidence/production-like-acceptance-101d2f0-20260720.json)、[协调证据](./evidence/compliance-coordinator-acceptance-5eec8cc-20260720.json)、[容量证据](./evidence/compliance-monitor-batch-acceptance-51ebb28-20260720.json)、[监控运营状态证据](./evidence/compliance-monitoring-status-acceptance-ba25c69-20260720.json)、[运行异常最终证据](./evidence/operational-incident-final-acceptance-f86bff4-20260720.json)、[教育扩展证据](./evidence/esports-education-expansion-acceptance-fccbaf9-20260720.json)、[发布门禁证据](./evidence/v1-release-gate-acceptance-213d9b6-20260720.json)、[平台证明证据](./evidence/v1-platform-attestation-acceptance-6e40b82-20260720.json)、[目标内网证明入口证据](./evidence/target-intranet-verifier-acceptance-25204d3-20260720.json)、[受管真机入口证据](./evidence/managed-device-pwa-verifier-acceptance-ffe102e-20260720.json)和[教育放行入口证据](./evidence/education-content-clearance-verifier-acceptance-f4c12b5-20260720.json)。每份证据都绑定自身实现范围并分列未重跑层与外部门禁；它们不把证据提交冒充实现、GitHub runner、GHCR 双平台、目标办公内网、物理设备、真实内容发布或业务/专业批准。当前 14 项状态由[机器发布门禁](./v1-release-readiness.json)失败关闭；最终发布仍须按[模板](./final-delivery-report-template.md)补齐外部证据和真实责任人签署。

当前又增加不可变 WordPress 内部审阅包实现 `9c5633e…` 及其[脱敏证据](./evidence/education-wordpress-review-bundle-acceptance-9c5633e-20260720.json)。它只接受 12 篇 review-only 产物、无网络/路径失败关闭、全仓/浏览器和三张受影响镜像增量，不把未重跑的 full Compose、七镜像、专业复核或发布写成通过。

前一候选增加了[真实适配器失败关闭机器证据](./evidence/real-adapter-guard-acceptance-d7cc156-20260720.json)：它绑定 `d7cc156ef2c44a531416c60ed88023681b113ecf`，完整记录本地工程成功及真实凭据、真实调用、目标会话和独立批准均未发生。该记录只更新本地核心/安全证据，不关闭真实适配器或任何外部门禁。

最新候选再增加[教育内容逐篇放行验证器机器证据](./evidence/education-content-clearance-verifier-acceptance-f4c12b5-20260720.json)：它绑定 `f4c12b596afd90d5781a0d192f381315c39790bc`，证明候选 Git/逐篇哈希、受保护模板、问卷/复核/权利/批准/公开页合同和失败关闭实现，同时固定记录真实问卷、试讲、专业/权利复核、WordPress 操作、公开发布和批准均未发生。该记录只更新本地核心/安全证据，`education_content_clearance` 继续阻断。

当前候选 `9c5633e1c3e9650507231106fcd8a451bf32053f` 又提供从精确提交生成的 12 个块 HTML、12 个治理审阅表、README 和 manifest。所有 HTML 固定包含公开验证器会拒绝的 `FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH`，十二篇结构状态均被阻断；该增量没有取得任何专业、权利或发布事实。

## 1. 候选身份与批准状态

| 字段 | 当前值 | 仍需完成 |
| --- | --- | --- |
| 产品版本 | V1 受控候选 | 所有阻断闸门关闭并取得业务负责人批准后才能改为 V1 完成 |
| 目标仓库 | 私有 `LiuXiu233/fiatlux-choice`；候选分支已推送；[Draft PR #12](https://github.com/LiuXiu233/fiatlux-choice/pull/12) | 解除 Actions 计费阻断，取得绿色 CI/security；批准后再合并 |
| Git SHA / tag | 当前候选实现为 `9c5633e1c3e9650507231106fcd8a451bf32053f`，证据提交为 `c41ef1018358b0e42063082330561a53aa8dc0a4`；最近完整空卷/七镜像基线 `f4c12b5…`、完整恢复基线 `101d2f0…`；未创建发布 tag | 生产发布仍须确定 commit/tag 签名政策，并统一最终 Git/GitHub/GHCR/目标身份 |
| GitHub PR / CI | Draft PR #12；证据提交 `c41ef10…` 的 [CI run 29747915723](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29747915723) 与 [Security run 29747915624](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29747915624) 均在 runner 启动前失败；PR Checks 是后续远端状态权威来源 | 六个首级失败 job 均为 `runner_id=0`、`steps=[]`，由账户付款或 Actions spending limit 阻断；不反复盲目重跑 |
| 数据库 | PostgreSQL 17.10；38 张业务表；11 个业务迁移 `0000`–`0010`；`101d2f0…` fresh、`0009→0010` 数据保留/幂等、fresh/legacy 五职责和签名恢复逐 migration hash 均本地通过 | GitHub CI、GHCR 与目标内网重新执行 |
| 候选 QA 环境 | 最近完整栈 `f4c12b5…` 已完成空卷、数据库/MinIO、六服务、desktop/mobile/PWA 和七镜像；当前 `9c5633e…` 另完成全仓、mock/独立浏览器及 API/worker/Web 三张受影响镜像，未重标未运行层 | 本机 loopback 环境不得改写成耀光广州办公内网、GHCR 双平台、真实适配器、真实内容发布或目标制品；目标环境必须独立复现 |
| 目标办公内网 | 失败关闭机器证明入口已实现并完成 stub/macOS/Linux 验收；**真实目标仍未部署或运行该入口** | 补主机、OS、架构、DNS、CA、防火墙、受管设备、备份介质、运行观察和独立运维批准 |
| 业务、风险与运维批准 | **未取得** | 公司和安全/运维负责人基于终态证据签署 |
| 法务合规/财税批准 | **未取得** | 专业人员说明资质、事实、范围、复核日期和有效期 |

当前结论：

- [ ] V1 已完成并批准上线
- [x] 受控候选，只能继续最终收口、GitHub/目标内网验证和有限 QA
- [ ] 已完成真实 LLM/GitHub 集成验收
- [ ] 已完成耀光广州办公内网与真实受管手机验收

## 2. 已实现范围与当前边界

| 模块 | 已实现 | 当前候选结论 |
| --- | --- | --- |
| 身份与权限 | 用户、组织、数据库会话、owner/admin/member/viewer、成员 pending/active/inactive/offboarded 生命周期、首次强制改密、最后 owner 保护和关键角色审批 | 首次改密前路由受限；改密撤销其他会话；归档角色后已有会话即时失权，唯一授权角色被归档时新登录不创建会话 |
| 初始化与紧急恢复 | 显式 `bootstrap`、`metadata-only`、`system-role-maintenance` 三种 seed mode；离线 owner 密码恢复 CLI | 常规 metadata seed 不修改身份、成员、角色分配或权限；角色维护需 active owner、原因、批准引用和 requestId；恢复密钥仅从 stdin 读取并强制撤销会话、下次改密和审计 |
| 审计与文件 | 追加审计、请求 ID、前后值、拒绝事件、私有 S3/MinIO 文件和并发完成锁 | 跨组织拒绝、不可经 API 篡改审计、拒绝请求体最小化、真实文件往返和并发冲突已本地验证；目标内网仍需复跑 |
| 执行与治理 | 目标、项目、任务、决策、义务、合规日历、风险、合同、typed refs、证据型专业复核和合规监控运营状态 | 状态面板按组织只读汇总当前机器/复核工作量并区分历史派发；专业复核锁定实名/机构/依据/证据/版本，通用状态提升被拒；面板数字不构成专业结论 |
| 财务 | 简易收支、发票、现金流、外部动作引用 | 金额使用整数分；正式外部状态仍依赖人工回执，不由内部批准伪造成功 |
| 产品、市场与电竞教育 | 产品组合、市场机会、电竞教育筹备页、官网审计、成人试点草案、4+8 的 12 篇版本化内容、绑定精确 SHA 的 WordPress 内部审阅包，以及逐篇真实公开页失败关闭证据入口 | 审阅包固定 review-only，十二篇均待人工复核/权利/发布；本地 HTML、模拟 HTTP 或结构准备状态不等于真实问卷、专业意见、权利、发布或批准 |
| GitHub 情报 | manual/read-only 集成边界与刷新队列 | 刷新任务在排队时保存当前 `expectedVersion`，worker 只在版本未变时以 CAS 写回，不用陈旧网络快照覆盖并发人工修改；真实 GitHub 凭据和最小权限读取验收未执行 |
| 审批与外部动作 | 八类高风险人工批准、manual/mock 状态机、幂等与合同/发票/付款台账原子联动 | 没有外部回执时不报成功；已关联草稿支出的银行付款在取消或审批驳回时于同一事务解除台账关联并增加版本，避免草稿被废弃动作永久占用 |
| 通知、顾问、工作流与运行异常 | in-app 通知、失败可见的 email/webhook 边界、七类顾问、四类工作流步骤、advisor/workflow/backup `lease_expired` 人工处置 | 通知 queued-only；运行快照/partial checkpoint 与原子 claim 已覆盖；运行异常只允许 owner/admin 追加证据化调查/补偿，不修改或重放原失败运行，损坏审计不能隐藏待办 |
| AI 可追溯 | 总经理、财务、法务合规、产品研发、市场机会、人力行政、信息安全；提示词/模型/工具/引用/人工编辑审计 | 运行默认只对发起人可见；合规事实要求完整、未到期专业 provenance，关联义务还要求 applicable；legacy/不适用/过期内容失败关闭；mock 不代表真实模型质量 |
| PWA | 响应式导航、manifest、service worker、离线壳、恢复会话和可见候选身份 | `ffe102e…` 将正式版本与完整 Git SHA 成对注入登录/离线/桌面/移动表面，精确 SHA 生产 Web 镜像为 11 个 precache（787.53 KiB），确认 manifest standalone、active SW、0 API/health 缓存、0 installability error、0 溢出和离线隐藏/联网重验；真机合同与附件校验入口已实现，但物理安装/升级/清理仍待执行 |
| 部署与灾备 | Compose、Caddy、迁移、健康检查、日志、最小权限数据库/MinIO、age+Ed25519 备份恢复、升级回滚工具 | `101d2f0…` 全新 Compose、七镜像和 11 migration 签名恢复已通过；经审批生产入口、历史生产 N−1、GHCR、目标内网/异介质和批准 RPO/RTO 仍待执行 |

## 3. 最终冻结测试状态

以下结果绑定不可变实现提交 `101d2f0…`。原始日志、SBOM、备份和浏览器截图在验收期间只保存于被忽略的临时目录；固化脱敏事实与 SHA-256 后，age identity、Ed25519 私钥、加密归档、Cookie、运行数据和原始 QA 缓存均删除且不进入 Git。功能源码若在该实现后漂移，受影响层必须重跑。

| 层级 | 当前发布口径 | 最终要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **不可变实现提交本地通过** | `101d2f0…`：Biome 206 个文件；全 `scripts/`/`infra/` shell；3 个 workflow；7 个 TypeScript 项目 |
| 单元测试 | **不可变实现提交本地通过** | `101d2f0…`：177/177；本证据工作树再次完整复跑通过，GitHub CI 仍待复现 |
| API/worker/PostgreSQL/pg-boss/MinIO 集成 | **不可变实现提交本地通过** | `101d2f0…`：API 18 files/89 tests、worker 5 files/25 tests、真实 MinIO 2/2；11 迁移 fresh 与 `0009→0010`、fresh/legacy 权限、事务/并发/CAS、审计和连接恢复通过 |
| Playwright / PWA | **不可变实现提交本地通过，有外部边界** | mock 46 passed、6 个设计内 skip；隔离真实栈 4/4；新 Compose 原生 Python Playwright desktop/mobile/PWA/offline 全通过；受管真机另行验收 |
| 全 workspace 与七镜像构建 | **不可变实现提交本地通过** | `101d2f0…` production build、七个 arm64 镜像、全新 Compose、六服务和重启持久性通过；GHCR 双平台待发布 |
| 安全/供应链 | **不可变实现提交本地通过 / GitHub 待运行** | Gitleaks、Semgrep+canary、生产依赖 0；`101d2f0…` 七镜像 Trivy 0.70.0 HIGH/CRITICAL 0、7 份 Syft 1.42.3 SPDX；GitHub CodeQL/安全 workflow 待运行 |

不可变协调实现 `5eec8cc…` 完整运行 `pnpm check`：Biome 207 个文件、ShellCheck、7 项类型检查、177/177 单元、API 89/89、worker 28/28、真实 MinIO 2/2 和 workspace build 均通过；另以 `NODE_ENV=production` 完成真实生产构建。Actionlint 1.7.12、Gitleaks 当前树/完整历史与 canary、Semgrep 1.170.0 配置/10 条 canary/87 个生产目标也分别通过。生产依赖 `pnpm audit --prod` 为 0。全依赖扫描只剩 `drizzle-kit -> esbuild` 的 1 个 moderate，属于不进入生产镜像、CI 不启动其 dev server 的开发期依赖；列为非阻断升级项，不应表述为“全依赖零漏洞”。未运行、设计内 skip 和目标环境缺失继续分列。

本增量还复现并修正了构建环境漂移：CI 与 release 的验证 job 为测试阶段全局使用 `NODE_ENV=test`，原构建步骤会继承该值，使 Web 生成 979.63 KiB precache 并重新出现 500 kB 主块警告。两个 workflow 的构建步骤现在都显式覆盖为 `NODE_ENV=production`；Actionlint 1.7.12 通过，等价本地生产构建恢复为 128.19 kB 教育路由块、423.59 kB 主块和 10 条/700.30 KiB PWA precache。该本地验证不替代 GitHub runner 实际执行。

失败历史没有删除：API 集成首次按文件并行运行时，在本机 2 CPU/4 GB 的 seed/Argon2 峰值出现 PostgreSQL `CONNECT_TIMEOUT`，得到 13 passed、4 failed、63 skipped；数据库全程 healthy、RestartCount 0、连接数未耗尽，且无业务断言失败。将 root/API/worker 的 `test` 与 `test:integration` 标准入口固定为 unit→workspace 串行、API/worker `--no-file-parallelism --maxWorkers=1` 后，旧基线 API 80/80、worker 23/23 和根级集成均通过。连接恢复修复后曾复跑 162/162 单元、API 83/83、worker 23/23；其中 malformed-JSON 单测曾在宿主 load 83 时唯一超时，在正常负载下同一测试 140 ms 通过，未删除该环境事件。引用链一致性加固后的最新复跑为 162/162 单元、API 85/85、worker 25/25。未配置 S3 时 integrations 2 项按设计 skip；真实 S3 两项由单独带凭据的 MinIO 门禁 2/2 通过，不能把 skip 记作通过。

引用链增量候选另在全新随机命名的 Compose 项目中重建 PostgreSQL、API、worker、Web、gateway、MinIO、backup 七镜像，完成空库五职责引导、10 个业务迁移、pg-boss 24、72 条来源 bootstrap、六服务健康和 `verify-deployment.sh` 最小权限检查；随后显式删除该项目全部容器、网络和卷。七镜像以 Trivy 0.70.0 扫描 HIGH/CRITICAL 均为 0，并生成、校验七份 Syft 1.42.3 SPDX。该本地增量证据仍不是最终 Git SHA 的 GHCR 双平台 digest、签名或目标内网证据。

电竞教育内容增量在同日完成 167/167 单元、API 85/85、worker 25/25、mock Playwright 44 passed/6 条件 skip 和真实栈 desktop/mobile 2/2；独立 Python Playwright 在 1440×1000 与 390×844 下均无横向溢出或控制台错误。隔离 PostgreSQL 的 22 个完整 bootstrap 组织均精确导入 73 条来源，隔离真实栈单组织同样为 73 条且新增健康来源精确 1 条。生产构建将教育内容拆为 128.19 kB 路由块，消除 500 kB 主块告警；独立 Web Compose 容器以 UID 10001、只读根、cap-drop ALL、no-new-privileges 健康运行，Trivy 0.70.0 对该新 Web 镜像扫描 HIGH/CRITICAL 为 0。Gitleaks 当前树/历史和 Semgrep 固定规则扫描均为 0 finding。隔离容器和网络验证后已删除；该证据仍不替代最终 SHA、七镜像重建、GHCR、目标内网或专业内容批准。

后续不可变电竞教育扩展 `fccbaf9c5718c18c588f8ee1d21d3a3997053187` 把剩余 8 个计划主题补成完整内部草案，并与原 4 篇通过冲突关闭合并层组成 12 篇内容库。精确 SHA 通过内容治理 5/5、Biome 220 文件、7 项类型、191/191 单元和生产构建；标准入口未配置依赖时跳过的集成项另在隔离 PostgreSQL 17.10/MinIO 中真实完成 S3 2/2、API 19 files/93 tests 和 worker 5 files/29 tests，数据库 10→11 与 fresh 38 表迁移也通过。mock Playwright 为 48 passed/6 条件 skip，隔离真实栈 desktop/mobile 为 6/6；独立 Python Chromium 在开发构建及变更后生产 Web 镜像重启前后均精确读取 12 篇、无横向溢出或登录后 console/page error，并确认 manifest standalone 与活动 service worker。Web 镜像 ID 为 `sha256:7eb42853…ffff89`，运行时 UID 10001、只读根、cap-drop ALL、no-new-privileges；Trivy 0.70.0 HIGH/CRITICAL/fixable/unfixed 为 0，Syft 1.42.3 SPDX-2.3 为 176 packages。完整哈希和边界见[电竞教育扩展机器证据](./evidence/esports-education-expansion-acceptance-fccbaf9-20260720.json)。本增量没有修改 API、worker、数据库或恢复实现，没有操作 WordPress，也没有完成专业/权利批准；对应 GitHub runner 仍在执行任何 step 前被账户付款/Actions spending limit 阻断。

目标办公内网证明入口在已推送的不可变实现 `25204d34d865b16941d099658d33fbb561424f09` 上，将 clean checkout/完整 Git SHA、七类发布清单 digest/实际运行镜像和目标 HTTPS/CA/运行时最小权限串为三层只读 verifier。仅当三层全部成功才原子生成 `0600` JSON；清单哈希错误、三层任一失败、JSON 写入中断、同名覆盖、非法 URL/端口/DNS、符号链接目录和非 production 环境均失败且不留成功/partial 文件。精确 SHA 完成 Biome 229 文件、ShellCheck、Actionlint 1.7.12、7 项类型、203 个单元、生产构建、Bash 3.2 macOS 与 Ubuntu 24.04/GNU stat 双平台包装器、Gitleaks、官方 registry 生产依赖审计和 Semgrep 93 个生产目标 0 finding；标准入口的 S3 2、API 93、worker 29 个 skip 不计为通过。证据文件 SHA-256 为 `f1d984528a6d6e992c6ae38fb213fb571eb8acaeaad252bd898c832b699a1852`。全部成功 JSON 都是 disposable stub fixture，`approvalIndependentlyVerified=false`；没有在耀光目标主机运行、没有验证防火墙/设备/恢复，也没有取得运维批准，因此目标内网门禁仍为 blocked。

受管真机证据入口在已推送的不可变实现 `ffe102e75526c510a14c60ef90a29e174b40a00a` 上，把正式版本/完整 Git SHA 成对注入登录页、离线壳、桌面侧栏和移动个人菜单，并定义受管状态、HTTPS 安装、旧版 standalone、Service Worker 升级、新版 standalone、核心登录、离线隐藏、联网重验、退出清理和清理后重认证十步会话。Schema 绑定不同旧/新版本与 SHA、Asia/Shanghai 时间窗口、伪名设备、隐私断言和至少四个实际附件；离线 verifier 再用独立批准的版本、SHA、URL、环境 ID 校验普通文件、路径边界、字节数和 SHA-256，只以不可覆盖 hard-link 生成 `0700/0600` 报告，并固定 `physicalDeviceIndependentlyVerified=false`、`managementStatusIndependentlyVerified=false`、`approvalIndependentlyVerified=false`。精确 SHA 完成 Biome 237 文件、7 项类型、220 单元、17 项定向验证、mock 48 passed/6 项目条件 skip、生产 Web 镜像 Python Chromium、Gitleaks、官方生产依赖 0、Semgrep 96 目标 0 finding、Trivy HIGH/CRITICAL 0 和 176-package SPDX；标准入口的 S3 2、API 93、worker 29 个 skip 不计为通过。证据文件 SHA-256 为 `da954f15fab4def65048db61502d8542cecf9f25c2e3ad59c0721b0d355b6f3d`。浏览器为 headless 390×844/loopback/API fixture，所有会话为 synthetic；没有安装或升级物理受管手机、没有 MDM/原始附件/批准，因此 `managed_device_pwa` 仍为 blocked。

真实适配器防护候选由 `f8ad2e4…` 的契约/worker-only 实现和 `d7cc156ef2c44a531416c60ed88023681b113ecf` 的零 finding 修复组成。干净 `d7cc156…` 完成 Biome 246 文件、7 项类型、239 单元、API 94/94、worker 33/33、真实 MinIO 2/2、生产/PWA 构建、Gitleaks、生产依赖 0、Semgrep 100 个生产目标 0 finding，以及七个 arm64 镜像 Trivy HIGH/CRITICAL/fixable/unfixed 0 和 SPDX 204/225/176/176/372/47/178 packages。全新 loopback Compose 又完成 38 表、11 migration、pg-boss 24、73 条来源、六服务最小权限、首登改密、1440×1000/390×844、PWA 11 条静态缓存/0 API 缓存、整体重启和部署验证，随后删除全部 QA 资源。运行时故意保持 LLM `mock`、GitHub `manual` 且 worker 凭据为空；没有真实调用、七顾问质量会话、供应商/预算/权限复核、撤销轮换或独立批准，因此 `real_llm_github_adapters` 仍为 blocked。完整边界见[机器证据](./evidence/real-adapter-guard-acceptance-d7cc156-20260720.json)，其 SHA-256 为 `fa8cb3357cbf32cc38a9ba491e312e8467dd2addcecf0614e7449cc6b1f82463`。

教育内容逐篇放行候选 `f4c12b596afd90d5781a0d192f381315c39790bc` 将两份内容文件和 12 篇逐篇哈希绑定到九项上线事实问卷、每篇八类复核、来源适用性、素材权利、同人多角色披露、内部试讲、逐篇人工批准、WordPress post ID/URL、12 个真实公开页、七篇旧模板处置与最终批准。未填写模板的目录/会话权限为 `0700/0600`，验证器以退出码 1 拒绝并报告另有 1207 项错误，未生成成功报告。精确 SHA 再通过 Biome 253 文件、ShellCheck/Actionlint、7 项类型、45 files/264 tests、API 94/94、worker 33/33、MinIO 2/2、mock 48 passed/6 项目条件 skip、空卷真实栈 desktop/mobile 6/6、候选 Web 镜像 1440×1000/390×844 PWA 复核、五组恢复回归、Gitleaks、生产依赖 0、Semgrep 104 个生产目标 0 finding，以及七镜像 Trivy HIGH/CRITICAL 0 和 SPDX。完整边界见[机器证据](./evidence/education-content-clearance-verifier-acceptance-f4c12b5-20260720.json)，其 SHA-256 为 `1aa8974fec37cf0cfe6dc5c8a2313185ce2f958b79e9d8e7825621f3c027ae42`。该运行没有登录或写入 WordPress，没有完成真实复核/试讲/批准，因此不能作为逐篇放行报告。

内部审阅包候选 `9c5633e1c3e9650507231106fcd8a451bf32053f` 从 Git object 而非工作树读取两份内容，生成 26 个 `0700/0600` 文件；12 篇均有七项结构阻断，HTML/Markdown 转义、公开页标记拒绝、无网络和覆盖/不安全路径负向均通过。精确 SHA 完成 Biome 257 文件、7 项类型、46 files/269 tests、教育证据 29 项、mock 48+6、独立 desktop/mobile/offline/SW、Gitleaks、生产依赖 0、Semgrep 0 finding，以及 API/worker/Web 三张受影响镜像 Trivy HIGH/CRITICAL 0 和 SPDX。完整边界见[机器证据](./evidence/education-wordpress-review-bundle-acceptance-9c5633e-20260720.json)，SHA-256 为 `62aa22b352005ee7de459e24723ce595041e7775a9c014b85ab80947b3920dae`；本轮没有重跑或冒充 full Compose、七镜像、真实专业复核和 WordPress 发布，三张临时候选镜像已在证据冻结后删除且既有 Compose 栈未改动。

合规监测低人力协调增量在自动销毁的 PostgreSQL 17.10 容器迁移后完成目标文件 10/10 与完整 worker integration 5 files/28 tests。验证人工复核到期、正文变化和连续第三次失败都在来源状态事务内精确创建一条同组织 `todo/high` 任务：执行时仍有效且仍有来源更新权限的人工触发者优先负责协调，否则确定性选择最早加入的有效 owner；触发者已停用或失权时正确回退，无有效 owner 的 legacy 异常则保持未指派且不跨组织猜测。系统在同一事务原子完成站内通知 `queued → sent`、任务/通知 create/deliver 与来源关联审计；重复扫描、同一哈希、第四次失败和陈旧并发结果不会重复或虚假建任务/通知，失败错误保持脱敏。协调责任人不等于专业复核人；邮件/企业协作和目标环境实际处置仍未验收。

同一增量又从 `5eec8cc…` 构建七个 `linux/arm64` 镜像和全新 production overlay，完成五职责数据库引导、38 表/11 migration、pg-boss 24、六服务健康及两次部署/MinIO 最小权限验证。明确标注“QA、非专业意见”的到期来源由真实组织级 pg-boss sweep 处理，生成指向最早有效 owner 的目标任务、`sent` 站内通知及 task create、notification create/deliver、source review_expired 关联审计；浏览器随后标记已读并写 `mark_read`。1440×1000 与 390×844 均精确找到该到期任务和通知、无横向溢出；PWA 1 个活动 service worker、10 条缓存、0 敏感路由缓存、0 installability error，离线隐藏业务内容并在恢复后重新验证会话。固定 Trivy 0.70.0 对实际变更的 worker 镜像 HIGH/CRITICAL 为 0，Syft 1.42.3 SPDX-2.3 为 225 packages。组织级 sweep 也按设计领取了首次启动时已到期的 seed 来源；实验室后续抓取失败产生的独立任务没有被用来冒充目标 `review_expired` 断言。原始截图、报告、age identity、容器、网络、卷和七个 QA 镜像标签均已删除。

首次监控容量增量从干净 `51ebb28…` 再完成 Biome 209 files、ShellCheck、7 项类型、182/182 单元、API 89/89、worker 29/29、真实 MinIO 2/2 和 production build；Actionlint 1.7.12、Gitleaks、Semgrep 10/10 canary/87 生产目标 0 finding、生产依赖 0、worker Trivy HIGH/CRITICAL 0 与 Syft 225 packages 同步通过。独立 production overlay 精确 seed 73 条来源为 7 个时间桶 `11/11/11/10/10/10/10`；暂停常驻 worker 后，用同一候选镜像和真实 pg-boss 对隔离的 73 条到期 fixture 执行一次组织 sweep，审计为 `batchLimit=12`、`queuedCount=12`、`hasMoreDue=true`，数据库保留 61 条未领取，12 个子 job 均为 created，尚未执行时任务/通知为 0。桌面和移动合规页均显示 73 条、无溢出，`/sw.js` 激活且意外错误为 0。该 fixture 的管理员 SQL 只用于隔离容量断言，不冒充用户行为、抓取成功或专业复核；QA 数据与全部临时资源已删除。

监控运营状态增量从干净 `ba25c69…` 完成 Biome 212 files、ShellCheck/Actionlint、7 项类型、186/186 单元、API 90/90、worker 29/29、真实 MinIO 2/2 和 production build；OpenAPI 为 76 paths/141 operations，Semgrep 88 个生产目标 0 finding，生产依赖 0。独立 production overlay seed 73 条未复核来源，真实状态读到 11 条待领取、0 在途、73 条 pending_fetch 和空派发历史；未认证访问为 401。API/worker/Web 三张重建镜像 Trivy HIGH/CRITICAL 0，SPDX 分别 204/225/176 packages。1440×1000 与 390×844 分别为 6/2 列且无溢出，PWA 10 缓存、0 敏感缓存、0 installability error，离线隐藏数据并恢复会话。六服务整体重启和三次部署/MinIO 最小权限验证通过；夹具失败与隔离 root 建桶边界写入[机器证据](./evidence/compliance-monitoring-status-acceptance-ba25c69-20260720.json)，全部 QA 资源和凭据已删除。本增量未修改恢复层，也未伪称重跑基线恢复。

运行异常最终候选在不可变实现 `f86bff4…` 上完成 Biome 218 files、7 项类型、191/191 单元、运行异常组件 4/4、API 19 files/93 tests、worker 5 files/29 tests、OpenAPI 78 paths/143 operations、production build 和当前树/完整历史/canary/allowlist Gitleaks。临时 PostgreSQL 在 11 migrations 后验证组织隔离、partial 强制补偿、事件 advisory lock、并发一次追加、跨组织 404、重复 409、原记录不变和损坏 evidence 审计不隐藏 open 事项。exact-SHA 构建为运行异常块 11.46 KiB、教育块 128.18 KiB、主块 428.40 KiB、PWA 11 entries/724.75 KiB。

同一 `f86bff4…` checkout 重建 API、worker、Web 后，以 Trivy 0.70.0 扫描 HIGH/CRITICAL 与可修复项均为 0，并用 Syft 1.42.3 生成 SPDX 204/225/176 packages；六份原始报告 SHA-256 已固化。独立 production Compose 从新卷完成五职责、38 表/11 migration、pg-boss、73 条来源、六服务 healthy 和两次部署/MinIO 最小权限验证。1440×1000 与 390×844 真实 HTTPS 浏览器分别处置 advisor 部分输出、workflow 1 个 checkpoint 和无产物 backup：前两者强制人工补偿并独立显示“补偿主记录”，第三者记录未发现 partial；每类恰好一条 `manual_review_completed`，原状态仍为 failed、版本 7/5/4、重复提交 409。首登强制改密、旧密码 401、新密码 200、PWA 11 条静态缓存/0 API 或 health 缓存/0 安装性错误、离线壳和六服务整体重启后的 HTTPS 读取均通过。恢复层自 `101d2f0…` 未变且本增量未重跑，范围边界、操作员修正记录和清理结果见[运行异常最终机器证据](./evidence/operational-incident-final-acceptance-f86bff4-20260720.json)。全部 opsfinal 容器、网络、卷、Trivy 缓存、镜像标签、脚本、截图、报告、证书和测试凭据已删除。

文件真实内容门禁增量新增 6 项单元测试并把全工作区单元提高到 173/173；独立 PostgreSQL 17 上目标 API 文件 19/19、完整 API 17 files/86 tests 通过，真实 MinIO 私有桶往返/错误摘要删除 2/2 通过。伪装 PDF 在对象写入前返回 400，文件保持 `pending/version=1`，对象不存在，拒绝审计不含 body；压缩 OOXML 正/负向覆盖 DOCX/XLSX/PPTX 主部件、类型清单、宏、ActiveX、嵌入、加密和路径穿越。隔离 PostgreSQL/MinIO 容器均在测试后删除。该门禁不是反病毒、沙箱、完整格式语义解析或 DLP，不能把测试通过写成附件无恶意内容。

证据型专业复核增量在 `101d2f0…` 完成 177/177 单元、API 18 files/89 tests、worker 25/25、真实 MinIO 2/2、mock 46+6 和隔离真实栈 4/4。真实 desktop/mobile 场景只在专用 E2E 数据库创建明确标注“非专业意见”的来源，上传实际对象、登记 not_applicable 测试结论、查看追加审计并验证证据归档返回 409；它不冒充 73 条来源的真实复核。专用迁移验收从 `0000`–`0009` 保存 legacy reviewed 数据、应用 `0010`、确认未发明 provenance 且幂等，再从空库得到 38 表/11 迁移；fresh/legacy 五职责权限也通过。随后 production-like Compose 再确认真实 seed 的 73 条均为 pending/draft/pending_fetch、专业 provenance 为 0。

## 4. 权限、后台任务与数据一致性证据

- 首次 owner 和新成员均带 `mustChangePassword`；首次改密前只允许读取本人、改密和登出，成功后保留当前会话并撤销其他会话。
- 成员从 pending 到批准、停用及角色变更有事务、版本冲突和审计边界；最后一个 active owner 不允许被静默移除。
- 角色分配/移除请求保存 membership `expectedVersion` 和幂等键。批准时重新锁定成员并核对版本、当前角色关系与最后 owner 不变式；版本已变或旧审批缺少版本快照时返回冲突，必须重新申请。
- 权限计算排除已归档角色。已有 Cookie 在角色归档后访问受保护路由返回 403；没有其他活动角色时，新登录返回 403 且不会增加 session；恢复角色后再按正常权限计算。
- typed refs 验证目标记录属于同一组织且未归档。decision 的有效 objective/project/task 组合必须同链，opportunity 同时填写 product/project 时必须与产品所属活动项目一致；PATCH 使用当前值与 patch 的合并结果校验，相关父关系变更和归档也受下游保护。应用 API 与 workflow `create_task` 共用组织级事务 advisory lock，特权数据库管理员直接写表仍属于可绕过的运维边界。义务/合规日历的 `evidenceFileId` 还要求文件状态为 `uploaded`；`sourceId` 是来源链，`evidenceFileId` 是履行或完成凭证，两者不应混同，来源引用也不代表已判定适用。
- 通知申请只能创建 `queued` 记录；通用 PATCH 不能改通知内容或投递状态，投递 worker 以真实结果转为 sent/failed。
- GitHub 刷新队列负载包含排队时的 `expectedVersion`；worker 在读取前和写回时都校验版本，CAS 失败时丢弃陈旧结果且不写“刷新成功”审计。
- advisor、workflow 和 backup 都以 `UPDATE ... WHERE status=queued RETURNING` 等条件更新原子领取，并以状态/版本 compare-and-set 完成或失败。并发重复投递只允许一个执行者取得 claim。
- 运行租约过期时，系统写 `lease_expired` 审计并把记录标为需人工复核的 failed，不会自动重放可能已有副作用的模型、工作流步骤或备份命令。
- `f86bff4…` 以同组织 `lease_expired` 审计派生 owner/admin 处置队列。人工结论要求证据、必要的补偿引用和禁止重放确认；记录有模型输出、workflow checkpoint 或备份产物时不能声称“未发现部分副作用”。事件 UUID 的事务 advisory lock 只允许一次 `manual_review_completed` 追加审计，原记录、模型、队列、工作流和备份命令均不变；不满足完整受控 schema 的旧/损坏审计不会隐藏 open 事项。
- 工作流运行创建时必须读取已启用的定义，校验发起人能执行每个步骤，并在同一事务保存 `definitionVersion` 和 `stepsSnapshot`。worker 只执行该不可变快照；每个成功步骤后保存 checkpoint，若后续排队失败，已创建的引用仍保留在 partial output。
- 顾问列表、详情和人工编辑都执行同一可见性规则：默认只允许发起人；读取他人运行需 `advisor-runs:read-all` 或 `*`，并且仍要通过该顾问 requiredPermission 和快照中每种资源的 `:read` 检查；不可见时按 404 隐藏存在性。
- 银行付款关联草稿支出后，在 pending_approval/approved/failed 等受支持状态取消，或对关联审批作出 rejected 决定时，台账关联与动作/审批在同一事务中解链并审计；并发变更导致版本不匹配时整笔冲突失败。

以上语义已由不可变基线 `101d2f0…`、运行异常实现 `f86bff4…` 与最新电竞教育实现 `fccbaf9…` 的单元、集成、真实栈 E2E 或部署抽查组合验证；各 exact-SHA 镜像/Compose 和未重跑层已单独披露。证据文档提交和 GitHub CI 仍需确认没有后续功能源码漂移，目标办公内网需独立复现。

## 5. 安全、最小权限与供应链

- PostgreSQL 使用 bootstrap、migrator、runtime、backup、restore 五类分离身份；pg-boss DDL 只由一次性 migrator 执行，API/worker 的 runtime 身份无 DDL。38 张业务表、11 个迁移（`0000`–`0010`）、pg-boss 24、fresh 空卷与 legacy 单超级用户升级的正/负向权限探测均在 `101d2f0…` 通过，恢复环境再次验证同一姿态。
- MinIO/S3 分离 root/bootstrap、app runtime、backup、restore 四类身份。root 只用于初始化和管理；app 不能读取备份，backup/restore 权限按职责收窄。
- 保持 access-key ID 不变时可收敛轮换 secret；若更换 access-key ID，必须由 root-only 运维显式删除旧用户，并用旧凭据执行负向验证。bootstrap 无法枚举未知旧 ID，因此不能把“新 ID 可用”误写为“旧 ID 已撤销”。
- 恢复脚本有 Ed25519 公钥类型/独立指纹/规范化 attestation/签名/来源/版本门禁，以及归档路径/链接/设备/FIFO/sparse/重复项/父子冲突/尾随数据与资源上限防护，使用受保护 scratch 和跨 backup/restore/upgrade/rollback 的 maintenance lock；陈旧锁、partial 或异常明文暂存必须人工调查。签名失败在任何 Compose 或数据动作前退出；在线文件私钥不是 HSM，仍需独立 SHA 与人工批准。
- `101d2f0…` 的七个 `linux/arm64` 本地镜像均由固定镜像 digest `aquasec/trivy@sha256:be1190…a41e`（0.70.0）扫描；HIGH、CRITICAL、fixable 和 unfixed 四个汇总均为 0。API/worker 另有 `linux/amd64` 实构、x64 Argon2id、worker `pg_dump 17.10`/age roundtrip 和 Trivy 0 的补偿证据。
- 固定 digest `anchore/syft@sha256:5999d2…1d36`（1.42.3）为七镜像生成 7 份结构化 SPDX，包数分别为 API 204、worker 225、Web/gateway 各 176、MinIO 372、backup 178、PostgreSQL 47；每份 SPDX 和 Trivy 报告 SHA-256 记录在[机器证据](./evidence/production-like-acceptance-101d2f0-20260720.json)。原始报告在验收期间只留于 ignored 临时目录，固化哈希后删除，不提交业务或恢复数据。
- Buildx `v0.35.0`、BuildKit `v0.31.2@sha256:2f5ada…`、QEMU/binfmt `qemu-v10.2.3@sha256:400a48…`、Trivy `v0.70.0` 和 Syft `v1.42.3` 固定到明确版本/摘要。真实 BuildKit 0.31.2 双平台 fixture 已通过，verifier 按 in-toto `https://in-toto.io/Statement/v1`、双平台 subject、来源 Git SHA、双平台 SPDX 与 sidecar 摘要做正/负向校验。
- 以上 image ID 是本地 arm64 manifest-list 内容 ID，不是已发布 GHCR 多架构 root digest，也不是签名；最终 release workflow 仍须构建和验证 registry 证据。
- 旧报告关于当前 MinIO 镜像“6 项 HIGH”的结论已被最终镜像重建和 Trivy 0 结果取代。剩余问题是 MinIO OSS 的长期维护/支持与迁移退出风险，而不是把旧扫描数继续当作当前漏洞；目标生产前仍须由负责人选择受支持实现或形成有期限的风险接受。
- 预计暂存范围、当前树/完整历史 Gitleaks、自定义/default canary、两个命名证据文件的公钥指纹精确 allowlist、大文件、symlink/submodule 和 ignored 证据边界已本地通过；GitHub CI/SAST 和目标内网暴露面仍须在推送及部署后分别验证。

| 本地组件 | `101d2f0…` arm64 image ID |
| --- | --- |
| postgres | `6ac8e44d9bd98214f9c60459b71d43420e487e1751719c5bb87d83136b895eec` |
| api | `df6ef7da0e206a34996d8baf9f9f24615ca37151f1e87f365fd7041163b78dd3` |
| worker | `ac4b91bc2f87bf869fe51c5081e908caeccec92c0da2316d47890d9e114b6645` |
| web | `06502c0c15a7157db13f5ae7b9a8c3073d827b0fdf96bc1d9ce355b7013274f1` |
| gateway | `fadb10cd0dd0819d95fb9efa910f2725b0fcbafa04282a90cc78377066bdc14e` |
| minio | `eaa26fb6ea35f092b07ce26f1df0ccb4bb96e9c1b12acf220a811c023f2c6cac` |
| backup | `34f825a0a16f488651bb634230942560088bd038a8cb170ded793b4a36b8d238` |

## 6. 合规、AI 与官网/电竞教育边界

- 结构化数据集有 73 条中国、广东、广州官方来源；目前均未完成专业人工复核，不能据此宣称公司适用性结论已批准。
- 合规结论保存在可维护记录中；专用复核要求复核人、角色、机构/内部组织、胜任依据、适用条件、摘要、缺失信息、证据、结论、期限和理由，并锁定来源版本、哈希与站内登记人。通用写入和 seed 不能伪造 reviewed 或 `active|superseded|repealed`，政策变化不永久硬编码。
- 义务和合规日历可分别保存 `sourceId` 与 `evidenceFileId`。当前及历史专业复核引用过的证据也不可归档；需要更正时只能上传新文件并追加新意见。系统不验证资质真伪或意见正确性。
- 未复核、legacy 不完整 provenance、过期或不活动来源不会作为法务顾问事实；关联义务/日历还要求来源结论为 `applicable`，`not_applicable` 会失败关闭关联内容。自动抓取、哈希一致或 pending 引用都不等于专业复核。
- 人工复核到期、正文哈希变化和连续第三次监测失败会各创建一条立即到期的高优先级人工任务；执行时仍有效且仍有来源更新权限的人工触发者优先协调，否则选择最早加入的有效 owner，并在同一事务送达站内通知。来源事件通过任务、通知、协调人和选择策略 ID 与 create/deliver 审计关联；协调和任务完成都不会自动把来源写成已复核，邮件/企业协作通知仍未配置。
- 当前真实 LLM 尚未完成供应商、数据处理、预算和质量验收。定向 mock 流程只证明权限、结构、审计、withheld 和后台运行边界。
- 当前 GitHub 集成仍为 manual/read-only 边界，没有真实凭据验收。
- 八类高风险动作必须人工批准；manual/mock 不构成银行、税务、发票、签章、人事或法律平台已经成功执行。
- [fiatlux.gg 公开业务与内容盘点](../research/fiatlux-gg-public-business-audit.md)记录了 Marvel Rivals 队伍、现有服务信号和内容问题。9 篇公开博文中只有 2 篇有成型正文，另 7 篇为模板占位；美国地域表述、过期赛事未来时态、未核验见证以及 Contact 隐私/投诉信息仍需负责人修订和核验。
- `artifacts/browser/fiatlux-gg/` 的 6 张无登录公开页面截图只作为当前私有仓库的内部研究证据，并附采集方式、尺寸和 SHA-256；它们可能含人物与网页素材。仓库改为公开、对外分发或长期归档前，必须由公司确认肖像、版权、个人信息和保留范围，否则从交付历史前置分支移除并改存受控证据库。
- [成人电竞教育试点课程草案](../product/adult-esports-pilot-curriculum.md)限定中国境内成年人、小班、人工交付和 4–6 周试点。九项事实问卷、合同、隐私、退款、版权、健康提示、内容安全和事件响应未获批准前，不得扩展为公开招生或未成年人服务。
- [电竞教育版本化内容库](../../content/education/README.md)已形成十二篇可维护内部草案并接入产品页面，按 4 篇基础包和 8 篇扩展包维护；每篇均保留版本、对象、负责人/审阅角色、权利、来源、AI 披露、正文、模板、练习和复核问题。十二篇当前均为 `pending`/`pending_clearance`/`not_published`，不能把合并成功、页面可读或测试通过写成专业复核、官网模板已撤回或 WordPress 发布成功。
- [电竞教育逐篇放行](../admin/education-content-clearance.md)已补充受保护模板与验证边界：精确绑定候选提交中的两份内容包和 12 篇文章，要求九项事实问卷、逐篇八类复核/来源/权利/批准、12 个公开页面、七篇旧模板处置及最终批准，并对真实 `fiatlux.gg` 做无登录只读核验。`f4c12b5…` 已有 exact-SHA 工程证据，但未产生任何真实放行报告，门禁继续阻断。
- [WordPress 内部审阅包](../admin/education-wordpress-review-bundle.md)规定 exact-SHA 生成、manifest 判读、最小访问、迭代与禁止公开边界；`9c5633e…` 工程通过不代表任何文章被复核或发布。

## 7. 当前 11 迁移 production-like 与签名恢复证据

2026-07-20（UTC 执行窗口 `2026-07-19T19:41:52Z`–`20:06:30Z`）从不可变实现提交 `101d2f0938adfa0caa8ed576f6587a5c78ae74a5` 重建七镜像和全新 production-like Compose，随后执行真实 age+Ed25519 一致性备份及随机全新卷隔离恢复。脱敏机器记录见[当前候选验收证据](./evidence/production-like-acceptance-101d2f0-20260720.json)：

| 项目 | `101d2f0…` 本地证据 |
| --- | --- |
| 部署 | 新项目/新卷、生产 overlay、TLS `choice-review.localhost:20443`；六常驻服务 healthy；`verify-deployment.sh`、MinIO 最小权限、重启持久性和备份后复验均通过；只有网关发布宿主端口 |
| 数据与合规保守状态 | 38 张业务表、11 migration、pg-boss 24；seed 精确导入 73 条来源，73 条全部 pending/draft/pending_fetch，专业 provenance 为 0；浏览器验收只新增 4 条 QA 任务，不把测试身份写为专业复核 |
| 浏览器与 PWA | 1440×1000 desktop 与 390×844 mobile 无横向溢出；真实 UI 创建任务并在移动端读取；PWA 10 条 cache、0 installability error、0 敏感路由缓存；离线隐藏工作区内容，联网后重新验证会话；console/page error 均为 0 |
| 七镜像供应链 | 固定 Trivy 0.70.0 digest 对 API、worker、Web、gateway、MinIO、backup、PostgreSQL 的 HIGH/CRITICAL/fixable/unfixed 均为 0；固定 Syft 1.42.3 digest 生成并验证七份 SPDX；本地 image ID/报告 hash 逐项记录 |
| 归档身份 | 数据密文 SHA-256 `0757095401915bf90ab61f09e8ec478482d2aabbc9482fe3b21d0737e0203f09`，59,093 bytes；attestation SHA-256 `671f5a1d1c7758fa9af846c45ff40cd0f29374a2e33cb44f219bdb903743b0fd`；`sourceId=fiatlux-reviewqa-101d2f0`；加密配置归档也成功创建 |
| 签名信任 | Ed25519；公钥 DER 指纹 `76b44bc56bbe365a01dabe1a290b898db8edbd81fd42e0874aa349dcddec5e24`；归档 SHA、规范化 attestation、签名、来源、数据库/桶和 backup tool release 均直接匹配 |
| 负向门禁 | 随机恢复项目先写数据库/桶 sentinel；错误 S3 restore 凭据在任何替换前失败，两个 sentinel 保持原值；随后才执行正确恢复 |
| 恢复数据库 | 38 张业务表；11 个迁移 `0000_dusty_wither`–`0010_aspiring_maverick` 逐 createdAt/SQL SHA 核对；pg-boss 24；bootstrap/migrator/runtime/backup/restore flags、membership、运行时与审计 ACL 全部通过 |
| 恢复对象 | 1 个、94 bytes；对象清单 SHA-256 `f181878ee7cfc34cd9a74d253e24a4b3acd99beb0d2bf37e25ef811b2640f62a`；目标桶逐对象路径、字节和 SHA-256 读回一致 |
| 可用性与时间 | 恢复后 `database`、`queue`、`objectStorage` 均 ready，worker healthy；从随机项目启动到完整权限/对象验收和自动清理为 23 秒。该数字不是业务负责人批准的生产 RTO，备份在暂停写入时生成，因此不据此发明生产 RPO |
| 清理 | 随机恢复容器、网络和卷自动删除；age identity、Ed25519 私钥/公钥、数据/配置归档和源 sentinel 删除；源六服务复验 healthy；未提交密钥、归档、Cookie 或运行数据 |
| 范围边界 | `productionRestoreEntrypointExecuted=false`；本地批准摘要不等于独立生产审批；未证明 GHCR 双平台、历史生产 N−1、异介质、目标办公内网或业务批准 RPO/RTO |

旧不可变提交 `6545c186753b5b7ba9a84d41d20879e6197362aa` 的 38 表/10 migration 恢复记录继续保留为[历史签名恢复证据](./evidence/signed-backup-restore-drill-20260720.json)，但不再承担当前 schema 门禁。2026-07-19 更早的无 Ed25519 v2 演练和 2026-07-18 的 v1/同内容标签数字同样只作历史背景。下一节的 synthetic bridge 证明本地相邻兼容，不能冒充历史生产 N−1 或目标环境发布演练。

## 8. 本地相邻版本升级／应用回滚证据

- 首轮隔离演练的升级和回滚脚本均 exit 0，但回滚后的常驻 API 在旧 20 秒 idle 阈值之后连续两次登录返回 HTTP 500，底层为 postgres.js `CONNECT_TIMEOUT`，所以任务 CRUD 未执行且报告正确标记为 BLOCKED。该脱敏报告 SHA-256 为 `f1e286108cd1aa3e731abaf7b766e591bb6ee9aa63591b45ee59d51f133210dd`。
- 实现提交 `859841f…` 保持 Drizzle 暖连接和 keepalive，统一四个命名小池与建连 deadline，使 API ready 有界、并发且 single-flight，使 worker 同时探测 pg-boss/Drizzle，并区分建连失败和中途断连；非幂等写不会在结果未知时自动重放。TCP 黑洞后同句柄恢复、主动终止 PostgreSQL backend 后同句柄恢复及首次 connect timeout 后第二次查询恢复均通过。
- 复验使用本机固定 digest Distribution registry；N `v1.0.1` 为 10 个迁移，synthetic bridge `v1.0.1-bridge.1` 为 9 个迁移，七个组件 digest 全部不同。N/bridge 都完成唯一 build/push、删除本地 tag 后真实 pull、RepoDigest/manifest SHA 正负向门禁。
- 真实升级 46 秒、应用回滚 43 秒；两次都生成 mode 600、formatVersion 2、`backupRelease=v1.0.1` 的 age 恢复点并只读核对，未执行 restore。回滚不做 down migration，最终仍为 38 表、10 个迁移、pg-boss 24，并保留 `0009` 唯一索引、N 写入的数据库/对象和审计。
- 回滚后同一 bridge API 进程保持 restartCount 0；启动 308.138 秒后正式 HTTPS 登录 200，随后 objective 再更新及 task create/read/update/archive/归档后 404 全部通过。API 日志中 `CONNECT_TIMEOUT` 和数据库依赖错误均为 0，四个 runtime `application_name` 齐全。
- 新脱敏报告 SHA-256 为 `552a64a33a44d40a41f8548633892509a0255e4d3a328dd9b0f070be9ae4b1bf`。隔离容器、卷、网络、registry、14 个版本镜像、worktree、口令、identity、备份与 scratch 已删除；finalqa 容器/卷/镜像/12 份恢复证据 before/after 哈希一致。
- 结论范围仅为“本地 synthetic bridge 的真实 schema/镜像差异和首轮缺陷复验通过”。它不是历史生产 N−1、GHCR 双平台制品、广州办公内网或经批准生产发布。

## 9. 已知结构与运行边界

- decision 的 `objectiveId`、`projectId`、`taskId` 均为 typed refs；服务端已校验所有同时存在的字段属于同一 objective→project→task 活动链，并保护相关父关系变更与归档。
- product 与 opportunity 的 project/product typed refs 已强制同时填写时项目一致；这只证明应用写入时的关系一致，不证明机会成交、合同成立或项目已交付，也不能抵御特权数据库管理员直接写表。
- 离线 owner 恢复是有审计的紧急运维工具，不是自助忘记密码；它仍依赖线下身份核验、批准引用、生产确认和受控 stdin secret。系统尚无 SSO、MFA 或恢复码。
- seed 不是日常启动步骤。`bootstrap` 只允许空组织；`metadata-only` 不修复成员/角色；`system-role-maintenance` 只在批准后补缺失系统角色/权限，不删除额外权限或恢复 owner assignment。
- lease-expired 代表可能存在部分副作用，必须从运行异常队列人工核对审计、partial output 和外部状态，先追加证据化调查/补偿；确需重做时再新建明确运行，不得自动重放原记录。处置记录是内部声明，系统不能自动验证外部证据真实性。
- 单主机 Compose 没有主机级高可用；最终恢复仍依赖经过批准并周期演练的备份。
- 单文件上限 50 MB，没有反病毒、DLP、OCR 或媒体分片上传。
- Fastify 单独关闭 CSP；生产必须只经 Caddy 暴露。
- 当前 LICENSE 为耀光（广州）电子竞技有限公司专有许可，不是开源许可。

完整列表见[已知边界](./known-boundaries.md)。

## 10. 最终提交与发布清单

以下全部完成前，本报告结论不得升级为“V1 完成”：

- [x] `101d2f0…` 的预期范围、ignored 证据边界、当前树/完整历史 secret scan 和敏感数据已完成本地审计；仅纳入私有仓库的 6 张公开官网研究截图，公开或外发前仍需权利/个人信息复核；GitHub 仍须复核。
- [x] `101d2f0…` 完成完整基线和恢复；`f86bff4…` 完成 191/191 单元、API 93/93、worker 29/29、三张镜像与独立 Compose 三类运行异常处置；最新 `fccbaf9…` 又完成 220 文件、191/191 单元、隔离 S3/API/worker、迁移、mock 48+6、真实栈 6/6、desktop/mobile/PWA 与变更后 Web 镜像安全复跑。设计内 skip、未重跑层和外部闸门均分列。
- [x] `213d9b6…` 将最终 V1 判断固化为 14 项失败关闭机器门禁；exact-SHA 的 224 文件、7 项类型、199 单元、生产构建、门禁正反向、Gitleaks 与生产依赖审计通过，标准入口未配置依赖的 2/93/29 集成 skip 明确不计为通过。
- [x] `6e40b82…` 增加后置只读最终证明、CI/Security/release 实时核验、七类 GHCR digest HEAD 核对及固定 Actionlint；exact-SHA 的 228 文件、7 项类型、203 单元、构建、Gitleaks、依赖审计和 Semgrep 93 个目标通过。当前 blocked 清单在联网前拒绝，未伪造真实平台成功。
- [x] `25204d3…` 增加失败关闭目标办公内网机器证明入口；exact-SHA 的 229 文件、7 项类型、203 单元、构建、macOS/Linux 包装器、安全扫描和原子失败清理通过。所有成功报告均为 stub fixture，未冒充真实目标主机或批准。
- [x] `ffe102e…` 增加成对 PWA 构建身份、固定十步受管真机会话和实际附件校验入口；exact-SHA 的 237 文件、7 项类型、220 单元、17 项定向、mock 48+6、生产 Web 镜像移动 Chromium、Trivy/SPDX 和源码安全通过。所有会话均为 synthetic，未冒充物理受管手机、MDM 或终端批准。
- [x] `231d8e8…` 增加生产恢复操作身份/理由/批准断言、跳过备份二次确认、每 operation 独占技术挂载和不可覆盖最终健康报告；exact-SHA 的 238 文件、7 项类型、220 单元、恢复正负向、Gitleaks、生产依赖、backup Trivy/SPDX 通过，并在全新七镜像栈恢复 38 表/11 migration/pg-boss 24/1 对象 41 bytes。真实生产 `restore.sh`、独立批准、物理异介质和目标 RPO/RTO 未执行，未把本地演练冒充门禁通过。
- [x] `d7cc156…` 完成真实适配器失败关闭入口的 exact-SHA 全仓、独立数据库/MinIO、七镜像、全新 Compose、桌面/移动/PWA、重启、部署和源码/镜像安全验证；证据明确记录真实凭据、真实调用、目标会话和独立批准均未发生，因此门禁保持 blocked。
- [x] `f4c12b5…` 完成教育内容逐篇放行失败关闭入口的 exact-SHA 全仓、隔离依赖、七镜像、全新 Compose、桌面/移动/PWA、恢复回归和安全验证；证据明确记录真实问卷、复核、试讲、WordPress 发布和批准均未发生，因此门禁保持 blocked。
- [x] `9c5633e…` 完成 review-only WordPress 内部审阅包、全仓、桌面/移动/PWA 和三张受影响应用镜像验证；12 篇仍全部 blocked，没有登录、凭据、外部写入或专业/权利/批准替代。
- [x] `101d2f0…` 的 production-like Compose 已在新卷完成 38 表/11 migration、HTTPS/PWA、六服务、最小权限和重启持久性验证；目标内网仍待复现。
- [x] 首次强制改密、成员生命周期、版本化角色审批、归档角色即时失权、通知 queued-only、GitHub 刷新 CAS、工作流不可变快照、付款取消/驳回解链、顾问 requester-only/read-all、合规专业 provenance/source/evidence、typed refs 和文件并发场景已在分层测试覆盖。
- [x] fresh/legacy 数据库、PostgreSQL 五职责和 MinIO 四身份的正/负向最小权限验证通过；目标凭据仍须重新执行。
- [x] `101d2f0…` 已完成 age+Ed25519 一致性备份和随机全新卷 38 表/11 migration/对象隔离恢复；经审批生产 `restore.sh`、独立批准渠道、异介质和目标内网仍待执行。
- [x] 本地 synthetic bridge 使用真实 schema 与七镜像差异完成升级、双恢复点、应用回滚和 idle 后 HTTPS CRUD；历史生产 N−1、GHCR 和目标内网复演仍待执行，不得把本地结果升级为生产证明。
- [x] `101d2f0…` 已完成 Gitleaks、生产依赖审计、Semgrep+canary、七镜像 Trivy 0.70.0 与 Syft 1.42.3 SPDX；GitHub/GHCR 双平台 digest、CodeQL/等效 SAST 与剩余风险批准仍待执行。
- [ ] 在真实受管手机完成 PWA 安装/升级和移动浏览器验证。
- [x] 专业复核基线 `101d2f0…`、运行异常 `f86bff4…`、电竞教育 `fccbaf9…`、发布门禁 `213d9b6…`、平台证明 `6e40b82…`、目标证明入口 `25204d3…`、受管真机入口 `ffe102e…`、生产恢复防护 `231d8e8…`、真实适配器防护 `d7cc156…`、教育放行入口 `f4c12b5…`、审阅包 `9c5633e…` 及其脱敏机器证据均已形成；各证据明确绑定实现 SHA，未把后继提交、stub JSON、自动化 viewport、本地恢复、mock/manual、审阅包或验证器冒充目标环境、物理设备、真实适配器、真实内容发布或生产批准；远端状态以 PR Checks 为准。
- [ ] 修复 GitHub Actions 账户付款/spending limit 阻断，重跑 PR CI 与 Security；取得绿色 run、CodeQL 或经批准等效 SAST、制品证据，批准后再合并。
- [ ] 在耀光广州办公内网按 `verify-target-intranet.sh` 绑定最终 Git SHA/七镜像清单运行机器证明，并另行验证防火墙、显式 seed、owner 首登改密、真实设备、备份介质、运行观察和独立批准。
- [ ] 完成真实 LLM/GitHub 最小权限验收，或明确保持 disabled/manual 且不宣称外部集成完成。
- [ ] 对 73 条来源完成适用范围内的专业人工复核；关闭官网/电竞教育事实、权利、合同、隐私和内容安全闸门。
- [ ] 由公司、运维安全、风险、法务合规和财税真实责任人完成适用范围内的批准。

## 11. 交付结论

FIAT LUX CHOICE 已形成可运行的模块化单体候选，不是脚手架、静态仪表盘或仅有数据库模型。身份、权限、审计、业务模块、八类人工批准、七类顾问、后台任务、PWA、最小权限、七镜像供应链和 Ed25519 签名 formatVersion 2 独立恢复路径均有分层实证。

不可变基线 `101d2f0…` 已完成 11 migration age+Ed25519 隔离恢复；运行异常、电竞教育、目标内网/真机入口、生产恢复防护和真实适配器均有各自 exact-SHA 证据；教育放行入口 `f4c12b5…` 完成全层本地与七镜像验收，当前审阅包 `9c5633e…` 又完成 review-only 生成、全仓/浏览器和三张受影响镜像增量。两者都固定记录真实问卷、复核、试讲、WordPress 发布和批准均未发生，未重跑层也已分列。14 项机器发布门禁当前为 2 项通过、12 项阻断；GitHub CI/security、GHCR、历史生产 N−1/目标发布、经审批生产恢复入口、耀光目标办公内网/真机、真实 LLM/GitHub、73 条真实专业复核、十二篇内容权利/发布复核、MinIO 支持风险决策及责任人批准仍未完成。因此唯一合法结论仍是：**受控候选，尚不可宣布 V1 已完成或已批准生产上线。**
