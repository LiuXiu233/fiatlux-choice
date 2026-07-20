# V1 验收矩阵

基准日期：2026-07-20

版本状态：**受控候选，尚未达到“V1 完成并批准上线”条件**

## 1. 证据口径

| 状态 | 含义 |
| --- | --- |
| 不可变实现提交本地通过 | 在完整 Git SHA `101d2f0…` 上完成对应全量、真实栈、镜像或恢复验证，但尚未取得 GitHub/GHCR 或目标环境证据 |
| 不可变协调增量本地通过 | `5eec8cc3f4cbd0b9a12372240bca9f56d65ae5f9` 已完成定向/完整回归、七镜像 Compose、真实 worker、浏览器/PWA 与受影响镜像安全复验；仍不等于 GitHub、GHCR 或目标环境通过 |
| 不可变运营状态增量本地通过 | `ba25c69954015c406c6a61ff9fadadd3830741c3` 已完成组织隔离监控读模型、响应式面板、完整源码门禁、独立 Compose、真实浏览器/PWA、三张重建镜像安全和清理复验；不替代基线恢复或外部门禁 |
| 不可变运行异常增量本地通过 | `f86bff4dcc7d2b61e05c8a6b44078d039aad1e38` 已完成运行异常人工闭环、exact-SHA 源码/数据库/构建、三镜像安全和独立 Compose 三类操作员复验；仍不等于 GitHub、GHCR 或目标环境通过 |
| 不可变电竞教育增量本地通过 | `fccbaf9c5718c18c588f8ee1d21d3a3997053187` 已完成 12 篇受控内容、exact-SHA 全仓、隔离集成/迁移、桌面/移动/PWA 与变更后 Web 镜像安全复验；不替代恢复基线或任何外部/人工门禁 |
| 不可变教育放行入口本地通过 | `f4c12b596afd90d5781a0d192f381315c39790bc` 已完成逐篇候选哈希、问卷/复核/权利/批准/公开页合同、失败关闭模板与验证器、exact-SHA 全仓/隔离栈/浏览器/七镜像安全复验；不是十二篇真实放行报告 |
| 不可变目标证明入口本地通过 | `25204d34d865b16941d099658d33fbb561424f09` 已完成目标内网机器证明入口、exact-SHA 全仓、安全及 macOS/Linux 失败关闭验收；stub 成功报告不等于目标环境运行或运维批准 |
| 不可变受管真机入口本地通过 | `ffe102e75526c510a14c60ef90a29e174b40a00a` 已完成成对构建身份、受管真机会话合同/附件校验器、exact-SHA 全仓、桌面/移动/PWA、Web 镜像扫描和 SPDX；headless viewport 与 synthetic 会话不等于物理受管手机或终端批准 |
| 本地演练已验证 | 在本地隔离环境完成真实数据库、对象存储、队列或恢复演练，但不是目标办公内网验收 |
| 历史证据 | 结果在当时真实，但其后源码、迁移、镜像或备份格式已有变化，不能作为当前发布证据 |
| GitHub/目标环境待复现 | 不可变实现提交已在本地通过，仍缺 GitHub runner、GHCR、目标内网或真机证据 |
| 边界 / 待决策 | 实现有明确能力边界，需补控制或由有权负责人决定是否阻断 V1 |
| 待执行 / 阻断 | 未完成前不能宣布 V1 完成 |

本矩阵严格区分代码存在、不可变实现提交本地测试、本地恢复、本地 synthetic bridge 演练、GitHub CI、耀光目标办公内网、真实设备和真实外部集成。`101d2f0…` 的本机 Compose 不是广州办公内网生产部署；本地 arm64 image ID 也不是 GHCR 双平台 root digest。`f86bff4…` 的运行异常证据绑定同一 exact-SHA 重建/扫描的 API、worker、Web 和独立 Compose 三类真实 HTTPS 处置；`fccbaf9…` 的内容增量另绑定全仓、隔离集成、迁移、桌面/移动/PWA 和 Web 镜像证据；`f4c12b5…` 只证明逐篇内容放行采集/校验入口和本地失败关闭工程边界，没有产生真实放行报告；`25204d3…` 只证明目标机器报告采集路径失败关闭；`ffe102e…` 只证明真机会话采集/校验入口和自动化 PWA 工程边界，既未在广州主机运行，也未触碰物理受管手机。各增量都明确未重跑层与全部外部门禁。当前 14 项状态以[机器发布门禁](./v1-release-readiness.json)为准；后续证据文档提交只记录实现 SHA，最终发布仍须统一 Git/GitHub/GHCR 与目标环境身份。旧 v1 恢复和同内容标签升级数字不能滚入当前通过口径，synthetic bridge 也不能冒充历史生产 N−1。

## 2. 产品与治理能力

| 验收项 | 当前实现与证据 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| 响应式 Web 与导航 | `fccbaf9…` 的隔离真实栈 desktop/mobile 6/6 继续有效；`ffe102e…` 又在精确 SHA 完成 mock 48 passed/6 项目条件 skip，并以生产 Web 镜像在 390×844 Python Chromium 确认无横向溢出、意外 console/page error 为 0 | 不可变受管真机入口本地通过 | GitHub CI 复现；至少一台真实受管手机 |
| PWA 与离线边界 | `ffe102e…` 将正式版本与完整 Git SHA 成对注入登录页、离线壳、桌面侧栏和移动个人菜单；生产 Web 镜像为 11 个 precache（787.53 KiB），manifest standalone、active SW、0 API/health 缓存、0 installability error，并通过离线隐藏/联网重验；物理安装/升级未执行 | 不可变受管真机入口本地通过 | 目标受管设备按固定十步完成安装、升级、离线、退出和站点数据清理，并独立批准 |
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
| 运行异常人工闭环 | `f86bff4…` 按组织派生 advisor/workflow/backup `lease_expired`，owner/admin 以证据、补偿引用和禁止重放确认追加处置；exact-SHA Compose 已对三类分别完成真实 HTTPS 处置，原失败记录、队列和执行器不变，同一事件并发只成功一次 | 不可变运行异常增量本地通过 | 目标内网用真实责任人复演；长期未处置告警仍待运营验收 |
| 八类高风险动作 | 人工批准、取消/驳回解链、幂等/CAS、manual/mock 与外部回执边界 | 不可变实现提交本地通过 / 外部边界 | 真实责任人逐类批准；无合法适配器的 `real` 必须拒绝 |
| 七类 AI 顾问 | requester-only/read-all 二次权限、事实/推断/建议结构、提示词/模型/工具/人工修改审计；合规上下文要求完整专业 provenance，关联义务只接受 applicable 来源 | 不可变实现提交本地通过 / 真实模型未验收 | 供应商、数据处理、预算、质量样本和停用开关批准 |
| 官网与电竞教育 | 已完成 fiatlux.gg 公开业务/内容审计、内部教育筹备页、成年人 4–6 周试点课程草案，以及按 4+8 维护的 12 篇版本化内容；[WordPress 内部审阅包](../admin/education-wordpress-review-bundle.md)从精确候选生成 12 个带禁止发布标记的块 HTML、12 个治理审阅表和哈希 manifest，对网络、不安全目录和覆盖失败关闭；[逐篇放行证据合同](../admin/education-content-clearance.md)再绑定九项问卷、八类复核、真实公开页和七篇旧模板处置 | 已实现内容、内部审阅和失败关闭入口 / 本地内容与入口测试通过 / 待真实业务与专业执行 | 十二篇仍是 `pending`/`pending_clearance`/`not_published`；审阅包固定 `review_only`，真实问卷、试讲、专业/事实/来源/权利/隐私/健康/内容安全复核、逐篇批准、WordPress 发布、七篇旧模板处理和最终批准均未发生；不得用本地 HTML、模拟 HTTP 或结构准备状态关闭门禁 |

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
| lease-expired 人工处置 | `f86bff4…` 的组织隔离列表、RBAC、损坏审计失败关闭、partial 强制补偿、事件 advisory lock、单次追加审计和无重放均由 PostgreSQL 覆盖；同一 exact-SHA Compose 已分别处置 advisor 输出、workflow checkpoint 与无产物 backup，验证两条补偿主记录、每类一条审计、重复 409、原记录不变及六服务重启持久性 | 不可变运行异常增量本地通过 | 目标内网由真实责任人复演；既有 admin 权限须经批准的 `system-role-maintenance` 补齐 |

lease 到期不等于“安全重试”。操作员必须从“运行异常处置”查看审计、partial output、对象/归档和外部副作用，先追加证据化调查/补偿结论；确需重做时再创建一个有明确原因和新 ID 的运行，不得静默复用失败记录。

## 4. 合规知识库

| 验收项 | 当前证据 | 状态 | 剩余工作 |
| --- | --- | --- | --- |
| 官方来源数据集 | `content/compliance/official-sources.json` 共 73 条，覆盖中国、广东、广州官方来源；隔离数据库 22 个完整组织和真实栈单组织均精确导入 73 条 | 已实现 | 最终 SHA 校验文件、URL、元数据与导入结果 |
| 人工复核状态 | 73 条尚未完成可识别专业人员的适用性复核；seed 即使收到 reviewed 输入也只保守导入 pending/stale，通用 POST/PATCH 不能提升 reviewed 或确定生命周期 | 正确保持未批准 | 按风险逐条上传真实意见并通过专用入口登记；不得把隔离 E2E 测试复核或批量操作冒充专业批准 |
| 易变政策与人工升级 | 来源元数据、机器哈希、人工状态和业务状态分离；到期、正文变化和连续第三次失败会在状态事务内各建一条 `todo/high` 任务，执行时仍有效且仍有来源更新权限的触发者或最早加入的有效 owner 负责协调，站内通知原子送达并关联任务/通知/来源审计；重复、第四次失败、停用/失权触发者和陈旧并发均有真实 PostgreSQL 覆盖；`5eec8cc…` 已验证升级处置，`51ebb28…` 又验证新目录七日分桶及真实 pg-boss 每组织 12 条上限、61 条显式积压 | 不可变容量增量本地通过 / 待目标运营 | 目标环境完成首次抓取、积压巡检、任务/站内通知处置和纠错流程；协调不等于专业复核，邮件/企业协作通知仍待批准适配器 |
| 监控运营状态 | `ba25c69…` 按当前组织汇总 73 条来源、实时待领取/有效租约、pending_fetch/failed/changed、stale/过期复核及最近有效派发审计；无效历史 metadata 降级为 null，当前积压不继承旧 `hasMoreDue`；真实 Compose 状态、401、OpenAPI 76 paths/141 operations 和 desktop/mobile 刷新通过 | 不可变运营状态增量本地通过 / 非专业结论 | 目标操作员每日巡检并处置；指标集合会重叠，面板不证明法规有效、适用、完整归档或专业批准 |
| 来源与履行凭证 | `sourceId`/`evidenceFileId` 分离、跨组织/未上传拒绝；当前与历史专业复核证据均不可归档；真实 PostgreSQL 与真实 MinIO 浏览器场景通过 | 不可变实现提交本地通过 | 人工核对凭证内容与复核人资质 |
| 顾问使用边界 | 未复核、legacy 不完整 provenance、过期、不活动或不确定来源不会进入法务顾问事实；not_applicable 来源不能支持关联义务/日历 | 不可变实现提交定向通过 | 真实模型启用后重新验证引用、权限、过期、结论和越权边界 |

这些来源不是专业合规批准，也不证明任何结论适用于耀光或电竞教育业务。

## 5. 当前工程测试状态

| 层级 | 当前发布状态 | 最终证据要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **不可变当前候选本地通过** | `f4c12b5…` exact SHA：Biome 253 个文件、ShellCheck、Actionlint、7 项类型和 workspace production/PWA build 通过；GitHub runner 待复现 |
| 单元/聚合 | **不可变当前候选本地通过** | `f4c12b5…` exact SHA：45 files/264 tests；教育放行合同 13/13、验证器 11/11、未填写模板失败关闭且不生成报告；标准入口依赖型 skip 不计为通过 |
| API / worker / PostgreSQL / pg-boss | **不可变当前候选本地通过** | `f4c12b5…` 在隔离 PostgreSQL 17.10 上完成 API 19 files/94 tests、worker 6 files/33 tests，空卷候选栈为 38 表、11 migrations、pg-boss 24/8 个应用队列 |
| MinIO / S3 | **不可变当前候选本地通过** | `f4c12b5…` 真实字节/错误清理 2/2；候选 Compose 在整体重启前后通过 app/backup/restore 最小权限和 ready 验证 |
| Web / Playwright / PWA | **不可变当前候选本地通过，有真机边界** | `f4c12b5…` 首登改密、真实栈 desktop/mobile 6/6；候选 Web 镜像复核 1440×1000/390×844、0 溢出/0 非预期错误、manifest standalone、SW active、11 条静态缓存/0 API 缓存、0 installability error |
| 全 workspace / 镜像构建 | **不可变当前候选本地通过** | `f4c12b5…` workspace production build 和七个 arm64 镜像均重建、运行或按需验证；最终七类 GHCR 双平台制品仍待发布 |
| 安全/供应链 | **不可变当前候选本地通过，有 GitHub 边界** | `f4c12b5…` 精确 HEAD/完整历史 Gitleaks、官方 registry 生产依赖 0、Semgrep 10/10 canary 与 104 个生产目标 0 finding；七镜像 Trivy HIGH/CRITICAL 0 和 SPDX 通过；GitHub CodeQL/security 待运行 |

七镜像的本地 arm64 content ID、SPDX 和扫描证据不是 GHCR 双平台 root digest 或签名。全依赖只余 dev-only `drizzle-kit -> esbuild` 1 个 moderate，生产依赖为 0；CI 不启动其 dev server，作为非阻断升级项跟踪。

## 6. 部署、运维与安全

| 验收项 | 当前证据 | 状态 | 最终闸门 |
| --- | --- | --- | --- |
| Compose 与迁移 | `f4c12b5…` 从新 PostgreSQL/MinIO 卷完成五职责 bootstrap、38 表/11 迁移、pg-boss 24、73 条 seed、六服务 healthy、整体重启、部署/MinIO 权限和管理员改密；QA 容器、网络、卷、报告、截图和凭据均清理 | 不可变当前候选本地通过 | 最终 GHCR/目标内网 Compose 复现 |
| HTTPS、PWA 与浏览器 | `f4c12b5…` 真实栈 desktop/mobile 6/6，并对候选 Web 镜像通过 1440×1000、390×844、SW 11 条静态缓存、0 API 缓存、0 installability error、无溢出和精确构建身份复核；运行 origin 是 loopback HTTP 安全上下文例外 | 不可变当前候选本地通过 / 目标 HTTPS 待执行 | 目标 DNS、CA、防火墙和真实设备 |
| PostgreSQL 身份 | PostgreSQL 17.10；bootstrap/migrator/runtime/backup/restore 分离；fresh/legacy 正负向 ACL 和审计权限通过 | 不可变实现提交本地通过 | 目标凭据复演 |
| MinIO 四身份 | root/bootstrap/app/backup/restore 最小权限、旧 key 显式撤销边界和真实 S3 集成通过 | 不可变实现提交本地通过 | 若目标更换 access-key ID，root 删除旧用户并用旧凭据验证失败 |
| formatVersion 2 签名恢复 | `101d2f0…` 实际暂停写入生成 age+Ed25519 归档；错误 S3 凭据破坏前失败，随机全新卷精确恢复 38 表/11 migration、pg-boss 24、五职责、worker/readiness 和 1 对象/94 bytes；全演练 23s | 不可变实现提交本地通过 / 生产范围待执行 | `productionRestoreEntrypointExecuted`、独立生产批准、目标内网/异介质与业务批准 RPO/RTO 仍分别验收 |
| 旧 v1 恢复与升级 | 2026-07-18 的 v1 归档、37 表/4 对象/16 秒和同内容标签升级回滚均早于 formatVersion 2 与最新代码 | 历史证据 | 不能计入当前门禁；最终 SHA 需用真实版本变化重做升级/回滚 |
| synthetic bridge 相邻版本 | N `859841f…`/10 migrations 与本地 bridge `b44a8d1…`/9 migrations；七 digest 全异，真实 push/pull，升级 46s、回滚 43s、双 v2 恢复点；回滚后 308s 登录与 CRUD 通过 | 本地演练已验证 / 范围受限 | 不是历史生产 N−1、GHCR 或目标内网；经批准生产候选仍须复演 |
| 归档、签名与维护安全 | `231d8e8…` 增加必填操作身份/理由/批准断言、跳过备份二次确认、每 operation 独占技术挂载和不可覆盖 `0600` 主机报告；archive guard、资源上限、scratch、preflight、maintenance lock、Ed25519 及正负向测试通过 | exact-SHA 本地通过；38 表/11 migration/1 对象签名隔离恢复通过 | 主机文件私钥不是 HSM；批准真实性固定未独立验证；经审批生产 `restore.sh` 破坏性入口仍待目标演练 |
| 七镜像与供应链 | `f4c12b5…` arm64 七镜像 Trivy HIGH/CRITICAL 均 0，SPDX 包数为 API 204、PostgreSQL 47、MinIO 372、worker 225、Web/gateway 各 176、backup 178；本地 image ID 不是 registry digest | 不可变当前候选本地通过 / GHCR 待发布 | 最终发布 SHA 的双平台 registry digest、GitHub workflow 和残余风险批准 |
| GitHub 交付 | 证据提交 `39801ebcf84257fe639e4a0be35bd60b8bcf75e3` 已推送，Draft PR #12 保持开放；CI `29741910154` 与 Security `29741910245` 的六个首级失败 job 均为 `runner_id=0`、`steps=[]`，仍由账户付款或 spending limit 在 runner 前阻断 | 部分完成 / 外部计费阻断 | PR Checks 为实时权威状态；修复 Billing & plans 后重跑并取得绿色 CI/security、候选制品、最终证明和批准；再合并 |
| 目标办公内网 | `verify-target-intranet.sh` 已在 stub 的 macOS/Linux 环境证明成功/失败原子边界；尚未在耀光广州办公内网部署或运行 | 采集入口本地通过 / 真实目标待执行且阻断 | 绑定最终 SHA/清单在目标主机执行；另验主机基线、DNS、CA、防火墙、设备、备份介质、运行观察和独立批准 |

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
| 七类顾问 | requester-only/read-all、上下文二次权限、越权 404、工具/模型/人工编辑审计通过；`d7cc156…` 又把真实质量、token、供应商、预算、worker-only、撤销轮换和回退固化为失败关闭证据契约 | 真实 LLM 质量、隐私、成本、停用、凭据轮换和供应商审批；mock 不能替代 |
| advisor/workflow/backup 后台任务 | 原子 claim、CAS、lease-expired 审计和 partial checkpoint 通过；`f86bff4…` 增加组织隔离处置 API/UI，PostgreSQL 证明损坏审计不隐藏事项、并发仅一次追加且不重放，同一 SHA Compose 分别完成 advisor/workflow 人工补偿和 backup 无 partial 结论 | 目标由真实责任人复演并建立长期未处置升级规则 |
| 合规 | 专用复核、版本/哈希/登记人锁定、追加历史、通用状态绕过拒绝、实质编辑降级、当前/历史证据归档拒绝及完整 provenance 顾问门禁通过；到期/变化/第三次失败任务仍由真实 PostgreSQL 覆盖 | 73 条真实专业复核、目标环境首次抓取及负责人处置演练 |
| 官网与教育 | 官网审计、内部教育页、成人试点草案、十二篇模块化版本内容、受保护 WordPress 内部审阅包及逐篇失败关闭证据入口已形成 | 十二篇仍未获真实专业/权利/发布批准；内部审阅 HTML 不得公开，继续内容清理、逐篇权利/事实核验、九项业务闸门、七篇旧模板处置和 WordPress 真实发布 |
| 桌面、移动与 PWA | `ffe102e…` 的成对构建身份、mock 48+6、生产 Web 镜像、SW active、11 个静态缓存、0 敏感缓存/安装性错误、offline shell 和 390 px 布局通过；真机会话 Schema/实际附件哈希入口已失败关闭 | 真实受管手机安装/升级/清理、MDM 与原始附件复核、终端/业务批准 |
| 部署与恢复 | `101d2f0…` 已完成基线独立恢复；`231d8e8…` 又在精确七镜像的全新 11-migration 栈完成签名备份、错误凭据负向、1 对象随机新卷恢复和资源清理，并验证生产入口报告契约 | 仍需历史生产 N−1/目标发布、经审批真实 `restore.sh`、目标内网/物理异介质、原始操作报告与业务批准 RPO/RTO |

## 8. 当前结论

该仓库已经超过脚手架、静态仪表盘和数据库模型阶段。核心业务、首次改密与成员生命周期、归档角色即时失权、八类人工批准、typed refs、可追溯顾问、后台原子 claim 和 formatVersion 2 恢复路径均有实现与候选证据。

当前仍只能称为**受控候选**。最新 `f4c12b5…` 已完成电竞教育逐篇放行失败关闭入口的 exact-SHA 全仓、独立 PostgreSQL/MinIO、七镜像、空卷 Compose、桌面/移动/PWA、恢复回归和安全验证，完整边界见[机器证据](./evidence/education-content-clearance-verifier-acceptance-f4c12b5-20260720.json)。该记录只接受工程入口；真实问卷、试讲、专业/事实/来源/权利复核、逐篇批准、WordPress 发布和七篇旧模板处置均未发生。此前真实适配器、恢复、目标主机和受管真机证据也各自保留真实调用/生产/物理/批准边界。[机器发布门禁](./v1-release-readiness.json)当前只有 2 项通过、12 项阻断。GitHub CI/security、GHCR、历史生产 N−1/目标发布、真实生产恢复入口、目标办公内网、真机、真实 LLM/GitHub、73 条专业复核、十二篇内容权利/发布复核、残余风险决策和业务批准仍未完成。在这些门禁全部关闭前，不得宣布“V1 已完成”，也不得用于无人监督的生产关键操作。

## 9. 最终 SHA 与目标环境必须补录

| 字段 | 当前值 | 要求 |
| --- | --- | --- |
| 完整 Git SHA / tag | 当前候选实现为 `f4c12b596afd90d5781a0d192f381315c39790bc`，证据提交为 `39801ebcf84257fe639e4a0be35bd60b8bcf75e3`；生产恢复防护为 `231d8e8…`、受管真机入口为 `ffe102e…`、完整恢复基线为 `101d2f0…`；发布 tag 待创建 | 确定 commit/tag 签名政策，统一最终 Git/GitHub/GHCR/目标身份并记录受保护 tag |
| GitHub PR / CI / 安全 run | Draft PR #12；证据提交 `39801eb…` 的 CI `29741910154` 与 Security `29741910245` 均由账户付款/spending limit 在 runner 前阻断，六个首级失败 job 为 `runner_id=0`、`steps=[]`，下游四项 skipped | PR Checks 是实时权威状态；修复 Billing & plans 后重跑，只有实际 step 执行且绿色才能关闭门禁 |
| 38 表 / 11 migrations（`0000`–`0010`）证据 | **`101d2f0…` fresh/legacy、Compose、五职责与签名恢复本地通过** | GitHub runner、GHCR 与目标环境复现 |
| 七镜像 digest / SBOM / provenance | **`f4c12b5…` 本地 arm64 七镜像、Trivy 0、七份 SPDX 通过** | 从最终发布 SHA 生成并记录 GHCR 双平台 registry digest；本地 image ID 不能替代 |
| 最终测试报告 | **`f4c12b5…` 完成 253 文件、264 单元、7 项类型、API 94/94、worker 33/33、MinIO 2/2、空卷 Compose、desktop/mobile/PWA、重启、部署、Gitleaks、依赖审计、Semgrep 104 目标和七镜像 Trivy/SPDX；标准入口的 2/94/33 skip 未计作通过** | 记录绿色 GitHub run；目标环境、真机、恢复、真实适配器和教育内容真实放行仍分别验收 |
| 最终 formatVersion 2 备份与恢复 | **`101d2f0…` 签名 drill 通过 / 生产范围待完成** | 归档 SHA `07570954…3f09`、attestation SHA `671f5a1d…b0fd`、完整 drill 23s；生产入口、独立批准、目标/异介质和业务 RPO/RTO 待验收 |
| 最终升级/回滚 | **本地 synthetic bridge 通过 / 生产范围待完成** | 使用最终 GHCR 制品、经批准 N−1 和目标环境复演 expand/contract、双恢复点与 idle 后业务链 |
| 目标办公内网 / 真机 | **目标机器与受管真机会话证明入口均已失败关闭验证；真实目标与真机未完成** | 在目标主机及物理受管手机执行并记录同一候选/环境/会话链，另行复核 DNS、CA、防火墙、MDM、原始附件、恢复和独立批准人 |
| 真实 LLM / GitHub | **工程防护通过 / 真实验收未完成** | 目标环境短期凭据、单仓库 Metadata-only、七顾问质量、数据处理、成本、停用/撤销和独立批准证据 |
| 合规、风险与业务批准 | **未取得** | 由真实责任人签署，不得由系统代填 |
