# V1 验收矩阵

基准日期：2026-07-20

版本状态：**受控候选，尚未达到“V1 完成并批准上线”条件**

## 1. 证据口径

| 状态 | 含义 |
| --- | --- |
| 不可变实现提交本地通过 | 在完整 Git SHA `101d2f0…` 上完成对应全量、真实栈、镜像或恢复验证，但尚未取得 GitHub/GHCR 或目标环境证据 |
| 当前增量本地通过 | 在 `101d2f0…` 后续增量上完成定向和完整回归，但仍须绑定提交并复现受影响的 Compose、浏览器、安全与交付证据 |
| 本地演练已验证 | 在本地隔离环境完成真实数据库、对象存储、队列或恢复演练，但不是目标办公内网验收 |
| 历史证据 | 结果在当时真实，但其后源码、迁移、镜像或备份格式已有变化，不能作为当前发布证据 |
| GitHub/目标环境待复现 | 不可变实现提交已在本地通过，仍缺 GitHub runner、GHCR、目标内网或真机证据 |
| 边界 / 待决策 | 实现有明确能力边界，需补控制或由有权负责人决定是否阻断 V1 |
| 待执行 / 阻断 | 未完成前不能宣布 V1 完成 |

本矩阵严格区分代码存在、不可变实现提交本地测试、本地恢复、本地 synthetic bridge 演练、GitHub CI、耀光目标办公内网、真实设备和真实外部集成。`101d2f0…` 的本机 Compose 不是广州办公内网生产部署；本地 arm64 image ID 也不是 GHCR 双平台 root digest。后续证据文档提交只记录该实现 SHA，最终发布仍须统一 Git/GitHub/GHCR 与目标环境身份；旧 v1 恢复和同内容标签升级数字不能滚入当前通过口径，synthetic bridge 也不能冒充历史生产 N−1。

## 2. 产品与治理能力

| 验收项 | 当前实现与证据 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| 响应式 Web 与导航 | `101d2f0…` 的 mock 46 passed/6 设计内 skip、隔离真实栈 desktop/mobile 4 项通过；新 production-like Compose 又以原生 Python Playwright 验证 1440×1000 与 390×844 无横向溢出、任务桌面写入/移动读取和 0 console/page error | 不可变实现提交本地通过 | GitHub CI 复现；至少一台真实受管手机 |
| PWA 与离线边界 | `101d2f0…` 构建为 10 个 precache（700.30 KiB）、128.19 kB 教育路由块和 423.59 kB 主块；Compose 浏览器验证 manifest、active SW、0 installability error、0 敏感路由缓存、离线内容隐藏和恢复会话 | 不可变实现提交本地通过 | 目标受管设备安装、升级和缓存清理验证 |
| 身份、首次改密与会话 | Argon2id、数据库会话、安全 Cookie、限流、`mustChangePassword` 路由门禁、改密后撤销其他会话 | 不可变实现提交本地通过 | 目标 HTTPS 复跑 owner/member 首登和并发 |
| 成员生命周期 | pending 登录拒绝、批准/停用/角色变更、乐观并发、最后 owner 保护和审计 | 不可变实现提交本地通过 | 两人审批和单人补偿控制由真实责任人演练 |
| 四级 RBAC 与归档角色 | owner/admin/member/viewer、组织作用域；已有 Cookie 即时 403、新登录不建 session、恢复后重新授权 | 不可变实现提交本地通过 | 目标内网抽查跨组织拒绝和会话撤销 |
| 追加审计 | 请求 ID、人工/系统 actor、before/after、拒绝、模型、工具、worker 和恢复事件 | 不可变实现提交本地通过 | 目标环境验证数据库与主机运维分权 |
| 文件 | 三步上传、上传前 UTF-8/JSON/格式信封/OOXML 结构与活动条目门禁、真实 MinIO 往返、大小/SHA-256、权限下载、篡改/并发/归档边界和恢复对象核对 | 不可变实现提交本地通过 / 无杀毒边界 | 目标内网和异介质复核；若风险要求病毒查杀/DLP，接入经批准扫描适配器 |
| 目标、项目、任务、决策 typed refs | 同组织活动引用；decision 任意有效组合强制同一 objective→project→task 链；PATCH 合并校验、父关系与归档保护及并发锁集成通过 | 不可变实现提交本地通过 | 最终 SHA/GitHub CI 与目标内网复现；特权数据库写入保持运维边界 |
| 产品、机会、项目 typed refs | product→project；opportunity 同时填写 product/project 时强制匹配产品所属活动项目；改链、归档和并发保护通过 | 不可变实现提交本地通过 | 最终 SHA/GitHub CI 与目标内网复现；业务成交与交付仍需人工证据 |
| 义务、合规、风险、合同 | API/UI、逾期 worker、状态规则、`sourceId`/`evidenceFileId` 分离；专用专业复核锁定实名/机构/胜任依据/缺失信息/证据/来源版本/哈希/站内登记人，通用 reviewed/确定生命周期绕过被拒绝，历史证据受保护 | 不可变实现提交本地通过 / 有业务边界 | 73 条仍需真实专业人员逐条复核；合同正式状态仍需人工外部回执 |
| 收支、发票、现金流 | 整数分、乐观版本、文件/外部动作引用和同事务联动 | 不可变实现提交本地通过 | 财税人员核对真实会计边界；manual/mock 不得写成平台成功 |
| GitHub 技术情报 | manual/read-only；服务端固定 `expectedVersion`，worker 读取/写回 CAS，GitHub HTTPS adapter 绑定仓库身份且拒绝 redirect | 不可变实现提交本地通过 / 真实凭据未验收 | 用批准的最小权限凭据验证读取，否则保持 manual/disabled |
| 通知与工作流 | queued-only、sent/failed 由 worker 控制；run 固化版本/步骤快照和 partial checkpoint | 不可变实现提交本地通过 | 目标操作员演练失败调查与人工补偿 |
| 八类高风险动作 | 人工批准、取消/驳回解链、幂等/CAS、manual/mock 与外部回执边界 | 不可变实现提交本地通过 / 外部边界 | 真实责任人逐类批准；无合法适配器的 `real` 必须拒绝 |
| 七类 AI 顾问 | requester-only/read-all 二次权限、事实/推断/建议结构、提示词/模型/工具/人工修改审计；合规上下文要求完整专业 provenance，关联义务只接受 applicable 来源 | 不可变实现提交本地通过 / 真实模型未验收 | 供应商、数据处理、预算、质量样本和停用开关批准 |
| 官网与电竞教育 | 已完成 fiatlux.gg 公开业务/内容审计、内部教育筹备页、成年人 4–6 周试点课程草案，以及 4 篇带版本、Schema、来源、权利、AI 披露、模板、练习和复核问题的基础内容；desktop/mobile 内容浏览通过 | 已实现 / 待业务与专业复核 | 四篇仍是 `pending`/`pending_clearance`/`not_published`；修复 7 篇模板占位、地域/时态/见证/隐私投诉问题；九项事实问卷及合同、隐私、版权、退款、健康和内容安全批准后才可人工发布 |

## 3. 初始化、恢复身份与后台幂等

| 验收项 | 当前实现与证据 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| fresh bootstrap | 空卷 bootstrap、重跑失败关闭、首次 owner 强制改密、登录和旧密码/会话负向验证 | 不可变实现提交本地通过 | 目标内网使用真实初始身份复演 |
| 既有组织 metadata seed | legacy 升级验证不改变组织/用户/membership/assignment/权限，只收敛允许的 metadata | 不可变实现提交本地通过 | 目标 legacy 副本对账 |
| 系统角色维护 | active owner、原因、批准引用、requestId、逐项审计、重复/非 owner/回滚边界 | 不可变实现提交本地通过 | 真实责任人批准后演练 |
| 版本化角色分配审批 | membership 版本快照、幂等重放、并发分配/移除和最后 owner 竞态 | 不可变实现提交本地通过 | 两人流程与单人补偿控制操作验收 |
| 离线 owner 恢复 | stdin secret、精确身份、生产确认、批准引用、会话撤销、强制改密和无密码审计 | 不可变实现提交本地通过 | 受控生产主机演练；它不是自助忘记密码或 SSO/MFA 替代物 |
| advisor 原子 claim | 重复投递只调用一次模型；状态/版本 CAS；过期 claim failed + `lease_expired` | 不可变实现提交本地通过 | 操作员演练人工调查，不得自动重放模型 |
| workflow 原子 claim 与 checkpoint | 重复投递只创建一组子资源；partial checkpoint、排队失败和 legacy 快照失败关闭 | 不可变实现提交本地通过 | 操作员演练人工补偿 |
| backup 原子 claim | 重复投递只运行一次命令；长租约过期转人工复核失败 | 不可变实现提交本地通过 | 目标真实备份介质、监控和 partial 清理演练 |

lease 到期不等于“安全重试”。操作员必须查看审计、partial output、对象/归档和外部副作用，随后创建一个有明确原因的新运行；不得静默复用失败记录。

## 4. 合规知识库

| 验收项 | 当前证据 | 状态 | 剩余工作 |
| --- | --- | --- | --- |
| 官方来源数据集 | `content/compliance/official-sources.json` 共 73 条，覆盖中国、广东、广州官方来源；隔离数据库 22 个完整组织和真实栈单组织均精确导入 73 条 | 已实现 | 最终 SHA 校验文件、URL、元数据与导入结果 |
| 人工复核状态 | 73 条尚未完成可识别专业人员的适用性复核；seed 即使收到 reviewed 输入也只保守导入 pending/stale，通用 POST/PATCH 不能提升 reviewed 或确定生命周期 | 正确保持未批准 | 按风险逐条上传真实意见并通过专用入口登记；不得把隔离 E2E 测试复核或批量操作冒充专业批准 |
| 易变政策与人工升级 | 来源元数据、机器哈希、人工状态和业务状态分离；到期、正文变化和连续第三次失败会在状态事务内各建一条 `todo/high` 任务，执行时仍有效且仍有来源更新权限的触发者或最早加入的有效 owner 负责协调，站内通知原子送达并关联任务/通知/来源审计；重复、第四次失败、停用/失权触发者和陈旧并发均有真实 PostgreSQL 覆盖 | 当前协调增量本地通过 / 待目标运营 | 目标环境完成首次抓取、任务/站内通知处置和纠错流程；协调不等于专业复核，邮件/企业协作通知仍待批准适配器 |
| 来源与履行凭证 | `sourceId`/`evidenceFileId` 分离、跨组织/未上传拒绝；当前与历史专业复核证据均不可归档；真实 PostgreSQL 与真实 MinIO 浏览器场景通过 | 不可变实现提交本地通过 | 人工核对凭证内容与复核人资质 |
| 顾问使用边界 | 未复核、legacy 不完整 provenance、过期、不活动或不确定来源不会进入法务顾问事实；not_applicable 来源不能支持关联义务/日历 | 不可变实现提交定向通过 | 真实模型启用后重新验证引用、权限、过期、结论和越权边界 |

这些来源不是专业合规批准，也不证明任何结论适用于耀光或电竞教育业务。

## 5. 当前工程测试状态

| 层级 | 当前发布状态 | 最终证据要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **不可变基线通过；当前 workflow 增量本地通过** | `101d2f0…`：206 个 Biome 文件、全 shell、3 个 workflow、7 个 TS 项目；当前后继工作树 Biome 207 个文件、ShellCheck、7 项类型和 Actionlint 1.7.12 通过，CI/release 构建显式覆盖 `NODE_ENV=production`；GitHub CI 复现 |
| 单元/聚合 | **不可变实现提交本地通过** | `101d2f0…`：177/177 单元通过；本证据工作树全量复跑亦通过，GitHub CI 待复现 |
| API / worker / PostgreSQL / pg-boss | **不可变基线通过；当前协调增量本地通过** | `101d2f0…`：API 18 files/89 tests、worker 5 files/25 tests；当前后继工作树 API 89/89、worker 5 files/28 tests；11 个 migration，空库及 `0000`–`0009` legacy→`0010` 数据保留/幂等、fresh/legacy 最小权限、连接恢复、并发/CAS、审计和失败边界通过 |
| MinIO / S3 | **本地通过** | 2 项真实私有桶/字节/权限/校验和集成及恢复对象核对通过 |
| Web / Playwright / PWA | **不可变实现提交本地通过，有真机边界** | mock 46 passed/6 条件 skip、隔离 real 4 passed；新 Compose 原生 Python Playwright desktop/mobile/offline/installability 全通过；真机待验收 |
| 全 workspace / 七镜像构建 | **不可变基线通过；当前源码生产构建通过** | `101d2f0…` 七个 arm64 镜像和独立 Compose/六服务/重启持久性通过；当前后继工作树显式生产构建为 PWA 10 precache/700.30 KiB，仍须从绑定增量 SHA 重建七镜像 |
| 安全/供应链 | **不可变实现提交本地通过，有 GitHub 边界** | Gitleaks、Semgrep+canary、`audit --prod` 0、IaC；`101d2f0…` 七镜像 Trivy 0.70.0 HIGH/CRITICAL 0、7 份 Syft 1.42.3 SPDX；GitHub CodeQL/安全 workflow 待运行 |

七镜像的本地 arm64 content ID、SPDX 和扫描证据不是 GHCR 双平台 root digest 或签名。全依赖只余 dev-only `drizzle-kit -> esbuild` 1 个 moderate，生产依赖为 0；CI 不启动其 dev server，作为非阻断升级项跟踪。

## 6. 部署、运维与安全

| 验收项 | 当前证据 | 状态 | 最终闸门 |
| --- | --- | --- | --- |
| Compose 与迁移 | `101d2f0…` 在新项目/新卷完成五职责 bootstrap、38 表/11 迁移、pg-boss 24、73 条来源、六服务 healthy、部署/MinIO 权限验证及重启持久性 | 不可变实现提交本地通过 | GitHub/GHCR 与目标内网复现 |
| HTTPS、PWA 与浏览器 | `choice-review.localhost:20443` 经导出 CA 验证 HTTPS/CSP/HSTS；desktop/mobile、PWA offline、0 installability error 和独立 Python browser 抽查通过 | 不可变实现提交本地通过 | 目标 DNS、CA、防火墙和真实设备 |
| PostgreSQL 身份 | PostgreSQL 17.10；bootstrap/migrator/runtime/backup/restore 分离；fresh/legacy 正负向 ACL 和审计权限通过 | 不可变实现提交本地通过 | 目标凭据复演 |
| MinIO 四身份 | root/bootstrap/app/backup/restore 最小权限、旧 key 显式撤销边界和真实 S3 集成通过 | 不可变实现提交本地通过 | 若目标更换 access-key ID，root 删除旧用户并用旧凭据验证失败 |
| formatVersion 2 签名恢复 | `101d2f0…` 实际暂停写入生成 age+Ed25519 归档；错误 S3 凭据破坏前失败，随机全新卷精确恢复 38 表/11 migration、pg-boss 24、五职责、worker/readiness 和 1 对象/94 bytes；全演练 23s | 不可变实现提交本地通过 / 生产范围待执行 | `productionRestoreEntrypointExecuted`、独立生产批准、目标内网/异介质与业务批准 RPO/RTO 仍分别验收 |
| 旧 v1 恢复与升级 | 2026-07-18 的 v1 归档、37 表/4 对象/16 秒和同内容标签升级回滚均早于 formatVersion 2 与最新代码 | 历史证据 | 不能计入当前门禁；最终 SHA 需用真实版本变化重做升级/回滚 |
| synthetic bridge 相邻版本 | N `859841f…`/10 migrations 与本地 bridge `b44a8d1…`/9 migrations；七 digest 全异，真实 push/pull，升级 46s、回滚 43s、双 v2 恢复点；回滚后 308s 登录与 CRUD 通过 | 本地演练已验证 / 范围受限 | 不是历史生产 N−1、GHCR 或目标内网；经批准生产候选仍须复演 |
| 归档、签名与维护安全 | archive guard、资源上限、scratch、preflight、maintenance lock、Ed25519 类型/规范化证明及对应安全测试通过；错误公钥/指纹、篡改归档/证明/签名、错误来源/版本、缺失/部分签名均在 Compose/数据动作前失败 | 不可变实现提交本地通过 | 主机文件私钥不是 HSM；经审批生产 `restore.sh` 破坏性入口仍待目标演练 |
| 七镜像与供应链 | `101d2f0…` arm64 七镜像 Trivy HIGH/CRITICAL/fixable/unfixed 均 0，7 SPDX 均通过版本化验证；真实 BuildKit 双平台 fixture 与 API/worker amd64 补偿证据仍有效 | 不可变实现提交本地通过 / GHCR 待发布 | 最终发布 SHA 的双平台 registry digest、GitHub workflow 和残余风险批准 |
| GitHub 交付 | 专业复核实现提交 `101d2f0…` 已推送，Draft PR #12 已更新；最新 GitHub run 仍待证据文档推送后只读核验，历史 run 均在 runner 前因账户付款失败或 spending limit 不足被阻断 | 部分完成 / 外部计费阻断 | 推送文档 head 后复核远端；修复 Billing & plans 后重跑并取得绿色 CI/security、制品和批准；再合并 |
| 目标办公内网 | 尚未在耀光广州办公内网部署 | 待执行 / 阻断 | 主机基线、DNS、CA、设备、备份介质、运行观察和批准 |

## 7. 核心场景状态

| 场景 | 当前证据 | 仍需完成 |
| --- | --- | --- |
| owner 首登与成员生命周期 | 首次改密、pending/active/inactive/offboarded、会话撤销和最后 owner 保护回归通过 | 目标内网用真实身份 E2E |
| 归档角色即时失权 | 已有会话 403、新登录拒绝、恢复与多角色组合通过 | 目标权限抽查 |
| 版本化角色分配审批 | 版本快照、幂等重放、陈旧申请、并发分配/移除和最后 owner 竞态通过 | 两人/单人补偿流程操作验收 |
| 目标—项目—任务—决策 | typed refs、同链组合、PATCH、父关系变更、归档及 advisory-lock 并发回归通过 | 最终 SHA/目标环境复现；管理员直写数据库不在应用保证内 |
| 产品—机会—项目 | typed refs、产品所属项目一致性、父关系/归档及并发保护回归通过 | 引用一致不等于成交或交付，仍需合同与业务证据 |
| GitHub 技术情报刷新 | expectedVersion/CAS、重复 job、并发编辑、失败审计和仓库身份绑定回归通过 | 真实最小权限只读凭据另行批准 |
| 通知与工作流 | queued-only、投递失败、定义并发修改、snapshot、legacy failure 和 partial checkpoint 通过 | 操作员人工补偿演练 |
| 高风险外部动作 | 八类人工批准、取消/驳回解链、幂等/CAS、manual/mock 外部回执边界通过 | 每类真实责任人批准和外部回执验收 |
| 七类顾问 | requester-only/read-all、上下文二次权限、越权 404、工具/模型/人工编辑审计通过 | 真实 LLM 质量、隐私、成本、停用和供应商审批 |
| advisor/workflow/backup 后台任务 | 原子 claim、CAS、lease-expired 审计和 partial checkpoint 通过 | 目标真实备份命令和人工补偿演练 |
| 合规 | 专用复核、版本/哈希/登记人锁定、追加历史、通用状态绕过拒绝、实质编辑降级、当前/历史证据归档拒绝及完整 provenance 顾问门禁通过；到期/变化/第三次失败任务仍由真实 PostgreSQL 覆盖 | 73 条真实专业复核、目标环境首次抓取及负责人处置演练 |
| 官网与教育 | 官网审计、内部教育页、成人试点草案和四篇版本化基础内容已形成 | 四篇仍未获专业/权利/发布批准；继续内容清理、权利/事实核验及九项业务/专业闸门批准 |
| 桌面、移动与 PWA | mock/real E2E、独立浏览器、SW active、offline shell 和 390 px 布局通过 | 真实受管手机安装/升级 |
| 部署与恢复 | `101d2f0…` 已完成独立 Compose、38 表/11 migration、七镜像、desktop/mobile/PWA、签名一致性备份和随机全新卷恢复，脱敏证据已固化 | 仍需历史生产 N−1/目标发布、经审批生产恢复入口、目标内网/异介质与业务批准 RPO/RTO |

## 8. 当前结论

该仓库已经超过脚手架、静态仪表盘和数据库模型阶段。核心业务、首次改密与成员生命周期、归档角色即时失权、八类人工批准、typed refs、可追溯顾问、后台原子 claim 和 formatVersion 2 恢复路径均有实现与候选证据。

当前仍只能称为**受控候选**。不可变实现提交 `101d2f0…` 已完成全量/定向测试、生产构建、最新 Compose、桌面/移动/PWA、本地七镜像供应链扫描和真实 age+Ed25519 11 migration 隔离恢复；脱敏机器证据见[当前候选验收记录](./evidence/production-like-acceptance-101d2f0-20260720.json)。候选分支已创建 Draft PR，但证据文档将形成后续提交，最终 Git/GitHub/GHCR 与目标环境身份尚未统一；GitHub CI/security 因账户计费在 runner 前被阻断，GHCR、历史生产 N−1/目标发布复演、生产恢复入口、目标办公内网、真机、真实 LLM/GitHub、73 条专业复核、残余风险决策和业务批准仍未完成。在这些门禁全部关闭前，不得宣布“V1 已完成”，也不得用于无人监督的生产关键操作。

## 9. 最终 SHA 与目标环境必须补录

| 字段 | 当前值 | 要求 |
| --- | --- | --- |
| 完整 Git SHA / tag | 专业复核/部署验收实现 `101d2f0938adfa0caa8ed576f6587a5c78ae74a5`；证据文档提交与 tag 待创建 | 推送文档 head 后记录完整 SHA；确定 commit/tag 签名政策，生产发布记录受保护 tag |
| GitHub PR / CI / 安全 run | Draft PR #12；`101d2f0…` 已推送；PR Checks 是远端状态权威来源；历史 run 均为账户付款/spending limit 在 runner 前阻断 | 修复 Billing & plans 后重跑，只有实际 step 执行且绿色才能关闭门禁 |
| 38 表 / 11 migrations（`0000`–`0010`）证据 | **`101d2f0…` fresh/legacy、Compose、五职责与签名恢复本地通过** | GitHub runner、GHCR 与目标环境复现 |
| 七镜像 digest / SBOM / provenance | **`101d2f0…` 本地 arm64/Trivy 0/7 SPDX/fixture 通过** | 从最终发布 SHA 生成并记录 GHCR 双平台 registry digest |
| 最终测试报告 | **不可变实现提交本地通过** | 记录证据文档 SHA 与 GitHub run；功能源码漂移则重跑 |
| 最终 formatVersion 2 备份与恢复 | **`101d2f0…` 签名 drill 通过 / 生产范围待完成** | 归档 SHA `07570954…3f09`、attestation SHA `671f5a1d…b0fd`、完整 drill 23s；生产入口、独立批准、目标/异介质和业务 RPO/RTO 待验收 |
| 最终升级/回滚 | **本地 synthetic bridge 通过 / 生产范围待完成** | 使用最终 GHCR 制品、经批准 N−1 和目标环境复演 expand/contract、双恢复点与 idle 后业务链 |
| 目标办公内网 / 真机 | **未完成** | 记录主机、DNS、CA、设备、网络、PWA 和批准人 |
| 真实 LLM / GitHub | **未完成** | 最小权限、数据处理、质量和停用/撤销证据 |
| 合规、风险与业务批准 | **未取得** | 由真实责任人签署，不得由系统代填 |
