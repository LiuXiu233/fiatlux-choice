# 已知边界与剩余风险

基准日期：2026-07-19

用途：上线决策、风险接受和路线图输入

## 1. 不能误解的产品边界

- FIAT LUX CHOICE 是内部管理系统，不是银行、税务、电子发票、电子签章、政务、会计总账或人力资源法定系统。
- 系统中的 approved 只表示内部批准；外部动作只有在有真实回执的 confirmed 状态才表示完成。
- manual 适配器记录人工执行，mock 只能 simulated。两者都不代表调用了外部机构。
- AI 顾问结果不是法律、税务、审计、投资、人事或信息安全正式意见。
- 合规知识库中的 effective 或 active 不自动等于适用于公司；reviewed 也需要可识别的人工复核人和事实依据。
- 电竞教育页面是内部筹备工作台，不是面向学员的报名、直播、考试或支付平台。

## 2. 工程验证状态

2026-07-18 的旧测试、六镜像、v1 恢复和同内容标签升级数字只保留为历史背景。2026-07-19 冻结工作树已完成 lint/ShellCheck/Actionlint、7 项类型检查、150/150 单元与聚合、API/worker/PostgreSQL/pg-boss/MinIO 集成、mock 44+6 与 real 2 项 Playwright、PWA/构建、最新 production-like Compose、桌面/移动浏览器、七镜像扫描/SPDX/provenance fixture，以及一次底层 formatVersion 2 独立恢复。

当前 schema 为 38 张业务表和 10 个迁移（`0000`–`0009`）。上述结果仍是本地冻结候选而非不可变提交、GitHub runner、GHCR 双平台、耀光办公内网、真实设备或生产批准证据。真实相邻版本升级/回滚和经审批的破坏性 `restore.sh` 生产入口没有实跑。GitHub CI、目标内网、真实设备、MinIO 长期维护/支持风险处置和责任人批准仍是发布闸门，以[验收矩阵](./v1-acceptance-matrix.md)为准。

## 3. 身份与权限

- 当前为本地邮箱密码认证，无 SSO、MFA、通行密钥和企业身份目录。
- 首次引导登录被限制在查看本人、改密和退出三个端点；改为至少 14 位独立密码后撤销其他会话。系统仍没有 SSO、MFA、自助忘记密码或恢复码。
- 成员创建、激活、停用、离职、再激活和本组织会话撤销已有审批式 API/UI 与并发测试；它不自动完成业务交接，任务、合同、文件和外部账号仍要人工核对。
- API 要求单人自批显式发送 SELF_APPROVAL_ACKNOWLEDGED；Web 已只在当前用户就是申请人时展示自批责任确认并发送该值。该例外降低职责分离，仍需事后独立复核。
- owner 拥有全局权限；Docker 主机和数据库超级管理员仍能绕过应用审计。
- 默认角色为固定种子权限，当前 UI 没有完整的自定义角色编辑器。
- 角色分配/移除申请必须提供 membership `expectedVersion` 和幂等键；审批载荷保存该版本快照，批准时重新核对。等待期成员/角色关系已变更，或旧审批缺少版本快照时，批准会冲突失败，不会在新版本上静默执行。
- seed 明确分为 fresh `bootstrap`、既有组织 `metadata-only` 和经批准的 `system-role-maintenance`。bootstrap 遇到既有 slug 会失败，metadata-only 不读取或修改管理员密码、身份、membership、角色或权限，维护模式也不会恢复已移除的 owner assignment。
- 唯一 active owner 忘记密码时只支持生产主机离线 one-off recovery：精确组织/邮箱、固定确认、理由、批准编号和唯一 requestId，临时密码只从 stdin secret 读取；成功后强制改密、撤销该用户全部组织会话并追加无密码审计。它不是普通管理员重置 API。

## 4. 文件与数据

- 单文件上限 50 MB；大型视频课件、赛事回放和媒体素材应使用受控媒体存储，后续再引入分片上传和后台校验。
- 文件入口限制为扩展名与声明 MIME 匹配的常用公司格式，拒绝脚本/活动内容/宏与 ODF 格式/generic octet-stream、规范化路径/点段/保留名和危险双扩展，并验证大小和 SHA-256；Markdown/JSON 也只作为非可信附件下载。但系统不检查真实文件 magic，仍无法识别伪装内容或恶意 PDF/Office，也没有反病毒、内容安全扫描、DLP、OCR 或敏感信息识别。
- 软归档不等于物理删除，也不自动满足个人信息删除或法定档案销毁。
- PostgreSQL 和 MinIO 之间没有分布式事务；上传状态机和暂停写入备份降低但不能消除跨存储不一致风险。
- 恢复源与输出已分离：归档通过 `RESTORE_SOURCE_DIR` 只读挂载，恢复前加密备份写到独立的 `RESTORE_PRE_BACKUP_DIR`。这解决了批准介质只读时无法生成 pre-restore 的路径冲突，但目录容量只提供安全下限而非成功保证；MinIO 内部卷格式/身份元数据不在归档中，跨版本兼容仍需人工确认。
- 定期恢复演练的日志/恢复报告写入独立 `RESTORE_DRILL_REPORT_DIR`；未配置或不可写时演练失败关闭，不会把只读归档源重新挂成可写。
- PWA 不缓存 API 数据，离线不能可靠查看或编辑公司记录。
- 移动验证仅使用 Playwright/iPhone 14 Chromium 仿真；尚无真实 iPhone、Android 或受管移动设备证据。
- 单主机 Compose 无主机级高可用，故障恢复依赖可用备份和可接受 RTO。

### 4.1 业务记录关联边界

- `projects.objectiveId`、`tasks.projectId`、`decisions.objectiveId/projectId/taskId`、`products.projectId` 和 `opportunities.productId/projectId` 都是类型化引用；API 校验目标属于本组织且未归档。
- 系统尚不强制一条 decision 同时填写的 objective/project/task 必须构成同一条链，用户仍须人工核对 task→project→objective 的链级一致性。
- 系统也不强制 `opportunity.projectId` 等于所选 `product.projectId`；机会、产品与交付项目分别有效不等于组合关系已一致。

## 5. 通知与工作流

- 站内通知可以投递；email 和 webhook 没有配置的投递适配器，会明确进入 failed。
- 通知创建 schema 只接受 `status=queued`；任何角色都不能通过通用 PATCH 写入 sent/failed 或改写内容，只有投递 worker 能按真实结果推进投递状态。HTTP 201 只表示已创建/排队，不表示已送达。
- 当前没有 SMS 类型和投递实现。
- 工作流使用结构化 JSON 步骤，没有完整可视化设计器、条件分支、补偿事务或人工暂停编辑器。
- 工作流顺序执行；中间步骤失败时要查看 run 结果，不能假设自动回滚已经创建的前序记录。
- 工作流 run 不在 worker 执行时重读可变定义；API 在排队时保存 `definitionVersion` 与不可变 `stepsSnapshot`，并确认定义未在创建事务中变更。修改定义只影响以后的 run；缺失快照的 legacy run 会失败关闭。
- 后台任务与业务共用 PostgreSQL；大量模型任务或备份可能争用连接和 I/O。
- `backup.create` 使用 2 小时 10 分钟的 pg-boss active lease、2 小时数据库 claim lease 与一小时外部命令超时。worker 崩溃后，队列重投会在 claim lease 到期后把 running 记录置为人工复核的 `failed`，不会自动重跑；在重投到达前仍需监控长期 `running`，不能把它当作成功。

## 6. AI 顾问

- 默认 LLM_DRIVER=mock，只验证流程和审计，不能作为真实模型质量验收。
- 真实 OpenAI-compatible 连接需要供应商合同、数据处理、保存、训练用途、地域和事件通知复核。
- 当前工具调用主要是显式 company_data.read，不是可自主执行任意工具的代理。
- 顾问只看到调用者选取的上下文，可能因遗漏关键记录而给出偏差建议。
- 顾问运行默认是 requester-only：列表、详情和人工编辑均只对发起人可见。只有 `advisor-runs:read-all` 或 `*` 可尝试读他人运行，但仍需该顾问 requiredPermission 和快照中每类资源的读权限；不满足时按 404 隐藏存在性。
- 结构校验和证据白名单不能消除模型误判、断章取义和提示注入。
- token 成本、速率、模型弃用和供应商可用性仍需运行监控。
- 真实模型和真实 GitHub 适配器尚未完成本地端到端验证。

## 7. 合规知识

- 72 条来源已完成官方元数据收集；当前 72 条全部为 `reviewStatus=pending`、`contentHashStatus=pending_fetch`、业务 `status=draft`。
- 因此没有任何一条可被描述为公司已人工批准的 `reviewed+active` 依据；候选验证只证明未复核来源会被法务顾问 withheld。
- 税率、最低工资、社保/公积金基数、申报日历和许可材料等易变结论不能从文档长期复制。
- 官方来源受限抓取器、pg-boss 每日扫描、哈希快照、变化后 stale/uncertain、人工逐条触发及失败审计已经实现；72 条初始来源仍需在部署环境实际完成首次抓取。
- `nextReviewAt` 到期会在每日扫描中降级并审计；组织+来源租约会去重定时、人工和 worker 并发任务，陈旧任务不会降低人工复核状态或虚增失败次数。
- 自动快照保存哈希、HTTP 元数据和最多 100,000 UTF-8 字节规范化摘录，不是完整原始 HTML/PDF 法证归档。邮件告警和连续失败自动建任务尚未配置，当前必须查看合规列表与审计日志。
- 义务和合规日历分别使用 `sourceId` 保留规则来源、使用 `evidenceFileId` 保留履行/完成凭证。两个字段都可选；系统会校验同组织和未归档，凭证还必须已 `uploaded`，但来源关联不会自动判定适用，缺少凭证也不会自动阻止用户错误地把记录标记完成。被引用凭证不可归档，仍需人工核对证据充分性。
- 公司事实、合同安排、人员身份和实际数据流决定适用性，不能仅靠行业标签推断。
- 官网存在 “U.S.” 表述，与中国境内主体业务定位不一致；任何招生或合同发布前必须统一。

## 8. 财务和外部集成

- 收支、发票和现金流是管理台账，不做复式记账、凭证、科目余额、报表报税和银行对账。
- 银行、税务、发票红冲、签章和人事平台没有声明为真实接口。
- GitHub 默认 manual；真实 GitHub 连接尚未验证，未来真实模式只适合经批准的最小权限读取。
- GitHub 刷新端点由服务端读取当前 insight 版本并将 `expectedVersion` 排入 job；worker 读取前和写回时使用 CAS。重复 job 或人工并发编辑导致版本过期时，陈旧网络快照被丢弃，不写成功审计；这不是自动重试保证。
- 银行付款可原子关联一条匹配的草稿支出。动作在支持的 pending_approval/approved/failed 状态取消，或关联审批被驳回时，系统在同一事务中将 `financial_entries.externalActionId` 解链、增加台账版本并审计；并发改动则整笔 409，不留半取消状态。
- integration test 只表示连接可达，不表示业务权限、数据正确或外部动作成功。
- 每个 real 适配器都需要幂等、超时、重试、回执、对账、撤销、凭据轮换和专项威胁模型。

## 9. API 与兼容性

- OpenAPI 3.1 由代码生成；冻结候选已用标准 parser 校验 74 个 path、138 个实际 Fastify operation，并对账 operationId、认证、参数、请求和成功/错误响应 schema，机器 JSON 与 Swagger UI 均通过。尚未发布跨版本兼容性 diff、弃用窗口或生成客户端回归，因此不能把结构对账当作所有语义已批准。
- API 版本为 /api/v1，但尚未发布兼容性、弃用窗口和客户端支持政策。
- 通用 search/status/category 在不同资源的支持程度不完全一致。
- 金额为整数分；旧集成若发送元或浮点数会产生严重金额错误。
- 更新依赖 expectedVersion；客户端必须处理 409。
- 文件上传是当前就要求的三步流程：POST 元数据、PUT 二进制、POST `/files/:id/complete`。PUT 后只是 `stored`；遗漏 complete 就不能下载。

## 10. 部署与恢复

- 冻结工作树已在 production-like Compose 的受信 TLS SAN `choice-final.localhost` 验证 desktop/mobile、PWA active service worker、离线壳、390 px 无溢出、核心业务链和六常驻服务重启持久性；这仍不等于耀光广州办公内网或真实受管移动设备验收。
- PostgreSQL 已成为第七发布组件。七个最终本地 `linux/arm64` 镜像的 Trivy 0.70.0 HIGH/CRITICAL/fixable/unfixed 均为 0，七份 Syft SPDX 和真实 BuildKit 0.31.2 双平台 provenance fixture 通过；API/worker 另有 amd64 原生件和工具验证。它们是本地 content ID，不是已发布 GHCR 双平台 root digest或签名。
- 旧报告中的 MinIO 6 项扫描结论已由最终镜像重建和当前 Trivy 0 取代。仍需决策的是 MinIO OSS 长期维护/支持与退出路径；internal network、无宿主端口和最小权限是补偿控制，不等于供应商支持承诺。
- worker 内置备份降级只支持 database；files/full 必须配置受控 BACKUP_COMMAND 或运行完整运维脚本。
- 生产完整备份需要 age recipient；私钥必须与备份分离。
- age 加密不认证备份来源。恢复现在强制匹配独立受审的归档 SHA-256，并通过只允许目录/普通文件的归档守卫；相邻 `.sha256` sidecar 不能自动充当批准记录。当前没有备份数字签名，无法建立独立审批渠道时属于生产恢复阻断项。
- 备份恢复是破坏性管理员操作，不提供普通 Web 恢复按钮。
- 冻结候选只执行一次底层 formatVersion 2 隔离恢复：`finalqa-isolated-v2-20260719T042309Z.tar.gz.age`，SHA-256 `bcfd6c59d9e66f7319ab2b55e6e711e2adfe2732f2c3a928b02eb82a3768b6ba`，`sourceId=fiatlux-finalqa-isolated`；核对 38 表、10 migration SQL SHA、pg-boss 24、1 对象/56 bytes、ready、数据库/对象 ACL，RPO 2 秒、drill RTO 75 秒，随后删除归档、identity、容器、卷和明文 workspace。`production_restore_entrypoint_executed=false`，因此不能表述为 `restore.sh` 生产审批入口已实跑。
- 2026-07-18 formatVersion 1 的 `final-rc-...`、37 表/4 对象/16 秒，以及同内容标签的 35/35/33 秒升级回滚只保留为历史证据，不能作为当前发布结论。release-transition、维护锁、归档 guard、镜像来源、PostgreSQL major/minor 门禁和 N−1 工具链的安全测试已在冻结候选通过，但真实相邻版本的 schema/镜像升级与应用回滚仍未演练。
- 新升级/回滚入口强制校验严格七组件发布清单和独立批准的清单 SHA-256，并在 pull 后、迁移前及启动后核对本地 RepoDigest；切换时一致重建 PostgreSQL、MinIO 与应用，并核对六个常驻容器 image ID 后才写全局版本，避免任一常驻组件延迟切换。backup 保持按需。BuildKit provenance 与 SBOM 不是签名；当前未集成 cosign/Sigstore，不能声称镜像已由发布者签名。
- 尚未完成的目标验证包括耀光办公内网主机、DNS、CA 分发、防火墙、seed/owner 首登改密、真实设备、异介质恢复和运行观察。
- Caddy internal CA 需要逐台受控分发；它不是成熟企业 PKI。
- 目标仓库已明确为私有 `LiuXiu233/fiatlux-choice`，但当前仍没有可引用的最终 Git SHA、PR、合并和绿色 CI；不能声称已完成 GitHub 交付。

## 11. 安全剩余风险

- 容器与应用控制不能抵御已控制 Docker 主机的攻击者。
- 安全工作流已配置，所有第三方 GitHub Actions 已固定到完整 commit SHA；当前树与历史的本地 secret scan 作为提交前门禁，GitHub workflow 仍需实际运行。
- 日志脱敏依赖代码和运维纪律；异常栈仍可能携带输入。
- Fastify Helmet 的 CSP 单独关闭，生产安全边界依赖 Caddy 注入 CSP；冻结候选经 Caddy 浏览器验证通过，但 API/Web 仍不得绕过 Caddy 直接暴露，否则没有同等 CSP 保证。
- 上传附件和 GitHub 内容是不可信输入，真实模型启用后仍有间接提示注入风险。
- 单一 owner 或单人自批降低职责分离，需要定期外部复核作为补偿控制。
- 当前 LICENSE 是专有许可，不是开源许可证；复制、分发或对外部署需要权利人另行书面授权。

## 12. 风险接受格式

任何延期到 V1 以后但不阻断使用的风险必须记录：

| 字段 | 要求 |
| --- | --- |
| 风险 | 可观察的事件、原因和影响 |
| 范围 | 受影响用户、数据、环境和流程 |
| 严重度 | likelihood 1–5、impact 1–5 |
| 补偿控制 | 当前实际运行的控制，不写计划 |
| 负责人 | 有权接受该风险的人 |
| 到期日 | 必须重新评估的日期 |
| 退出条件 | 可以关闭风险的证据 |
| 关联 | 风险、任务、决策、审计和批准 ID |

不得接受会导致敏感数据泄漏、付款或签署误报、不可恢复、越权、审计失效或核心流程无法完成的风险。
