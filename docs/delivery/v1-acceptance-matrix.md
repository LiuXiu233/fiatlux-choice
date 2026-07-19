# V1 验收矩阵

基准日期：2026-07-19

版本状态：**受控候选，尚未达到“V1 完成并批准上线”条件**

## 1. 证据口径

| 状态 | 含义 |
| --- | --- |
| 冻结候选本地通过 | 在 2026-07-19 冻结工作树完成对应全量/定向/真实栈验证，但尚未绑定最终 Git SHA 或 GitHub run |
| 本地演练已验证 | 在本地隔离环境完成真实数据库、对象存储、队列或恢复演练，但不是目标办公内网验收 |
| 历史证据 | 结果在当时真实，但其后源码、迁移、镜像或备份格式已有变化，不能作为当前发布证据 |
| GitHub/目标环境待复现 | 冻结工作树本地已通过，仍缺不可变 SHA、GitHub runner、GHCR、目标内网或真机证据 |
| 边界 / 待决策 | 实现有明确能力边界，需补控制或由有权负责人决定是否阻断 V1 |
| 待执行 / 阻断 | 未完成前不能宣布 V1 完成 |

本矩阵严格区分代码存在、冻结工作树本地测试、本地恢复、本地 synthetic bridge 演练、GitHub CI、耀光目标办公内网、真实设备和真实外部集成。最新本机 Compose 不是广州办公内网生产部署；本地 arm64 image ID 也不是 GHCR 双平台 root digest。最终证据必须绑定同一个完整 Git SHA，旧 v1 恢复和同内容标签升级数字不能滚入当前通过口径；synthetic bridge 也不能冒充历史生产 N−1。

## 2. 产品与治理能力

| 验收项 | 当前实现与证据 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| 响应式 Web 与导航 | mock 44 passed/6 设计内 skip；真实栈 desktop/mobile 2 项和独立浏览器抽查通过；390/390 无横向溢出 | 冻结候选本地通过 | GitHub CI 复现；至少一台真实受管手机 |
| PWA 与离线边界 | 最新构建 9 个 precache（560.36 KiB）、manifest、active service worker、离线壳和会话恢复通过 | 冻结候选本地通过 | 目标受管设备安装、升级和缓存清理验证 |
| 身份、首次改密与会话 | Argon2id、数据库会话、安全 Cookie、限流、`mustChangePassword` 路由门禁、改密后撤销其他会话 | 冻结候选本地通过 | 目标 HTTPS 复跑 owner/member 首登和并发 |
| 成员生命周期 | pending 登录拒绝、批准/停用/角色变更、乐观并发、最后 owner 保护和审计 | 冻结候选本地通过 | 两人审批和单人补偿控制由真实责任人演练 |
| 四级 RBAC 与归档角色 | owner/admin/member/viewer、组织作用域；已有 Cookie 即时 403、新登录不建 session、恢复后重新授权 | 冻结候选本地通过 | 目标内网抽查跨组织拒绝和会话撤销 |
| 追加审计 | 请求 ID、人工/系统 actor、before/after、拒绝、模型、工具、worker 和恢复事件 | 冻结候选本地通过 | 目标环境验证数据库与主机运维分权 |
| 文件 | 三步上传、真实 MinIO 往返、大小/SHA-256、权限下载、篡改/并发/归档边界和恢复对象核对 | 冻结候选本地通过 | 目标内网和异介质复核 |
| 目标、项目、任务、决策 typed refs | 同组织活动引用；decision 任意有效组合强制同一 objective→project→task 链；PATCH 合并校验、父关系与归档保护及并发锁集成通过 | 冻结候选本地通过 | 最终 SHA/GitHub CI 与目标内网复现；特权数据库写入保持运维边界 |
| 产品、机会、项目 typed refs | product→project；opportunity 同时填写 product/project 时强制匹配产品所属活动项目；改链、归档和并发保护通过 | 冻结候选本地通过 | 最终 SHA/GitHub CI 与目标内网复现；业务成交与交付仍需人工证据 |
| 义务、合规、风险、合同 | API/UI、逾期 worker、状态规则、`sourceId`/`evidenceFileId` 分离及文件凭证校验 | 冻结候选本地通过 / 有业务边界 | 来源关联不等于适用性复核；合同正式状态仍需人工外部回执 |
| 收支、发票、现金流 | 整数分、乐观版本、文件/外部动作引用和同事务联动 | 冻结候选本地通过 | 财税人员核对真实会计边界；manual/mock 不得写成平台成功 |
| GitHub 技术情报 | manual/read-only；服务端固定 `expectedVersion`，worker 读取/写回 CAS，GitHub HTTPS adapter 绑定仓库身份且拒绝 redirect | 冻结候选本地通过 / 真实凭据未验收 | 用批准的最小权限凭据验证读取，否则保持 manual/disabled |
| 通知与工作流 | queued-only、sent/failed 由 worker 控制；run 固化版本/步骤快照和 partial checkpoint | 冻结候选本地通过 | 目标操作员演练失败调查与人工补偿 |
| 八类高风险动作 | 人工批准、取消/驳回解链、幂等/CAS、manual/mock 与外部回执边界 | 冻结候选本地通过 / 外部边界 | 真实责任人逐类批准；无合法适配器的 `real` 必须拒绝 |
| 七类 AI 顾问 | requester-only/read-all 二次权限、事实/推断/建议结构、提示词/模型/工具/人工修改审计 | 冻结候选本地通过 / 真实模型未验收 | 供应商、数据处理、预算、质量样本和停用开关批准 |
| 官网与电竞教育 | 已完成 fiatlux.gg 公开业务/内容审计、内部教育筹备页和成年人 4–6 周试点课程草案 | 已实现 / 待业务与专业复核 | 修复 7 篇模板占位、地域/时态/见证/隐私投诉问题；九项事实问卷及合同、隐私、版权、退款、健康和内容安全批准 |

## 3. 初始化、恢复身份与后台幂等

| 验收项 | 当前实现与证据 | 状态 | 最终 V1 闸门 |
| --- | --- | --- | --- |
| fresh bootstrap | 空卷 bootstrap、重跑失败关闭、首次 owner 强制改密、登录和旧密码/会话负向验证 | 冻结候选本地通过 | 目标内网使用真实初始身份复演 |
| 既有组织 metadata seed | legacy 升级验证不改变组织/用户/membership/assignment/权限，只收敛允许的 metadata | 冻结候选本地通过 | 目标 legacy 副本对账 |
| 系统角色维护 | active owner、原因、批准引用、requestId、逐项审计、重复/非 owner/回滚边界 | 冻结候选本地通过 | 真实责任人批准后演练 |
| 版本化角色分配审批 | membership 版本快照、幂等重放、并发分配/移除和最后 owner 竞态 | 冻结候选本地通过 | 两人流程与单人补偿控制操作验收 |
| 离线 owner 恢复 | stdin secret、精确身份、生产确认、批准引用、会话撤销、强制改密和无密码审计 | 冻结候选本地通过 | 受控生产主机演练；它不是自助忘记密码或 SSO/MFA 替代物 |
| advisor 原子 claim | 重复投递只调用一次模型；状态/版本 CAS；过期 claim failed + `lease_expired` | 冻结候选本地通过 | 操作员演练人工调查，不得自动重放模型 |
| workflow 原子 claim 与 checkpoint | 重复投递只创建一组子资源；partial checkpoint、排队失败和 legacy 快照失败关闭 | 冻结候选本地通过 | 操作员演练人工补偿 |
| backup 原子 claim | 重复投递只运行一次命令；长租约过期转人工复核失败 | 冻结候选本地通过 | 目标真实备份介质、监控和 partial 清理演练 |

lease 到期不等于“安全重试”。操作员必须查看审计、partial output、对象/归档和外部副作用，随后创建一个有明确原因的新运行；不得静默复用失败记录。

## 4. 合规知识库

| 验收项 | 当前证据 | 状态 | 剩余工作 |
| --- | --- | --- | --- |
| 官方来源数据集 | `content/compliance/official-sources.json` 共 72 条，覆盖中国、广东、广州官方来源 | 已实现 | 最终 SHA 校验文件、URL、元数据与导入结果 |
| 人工复核状态 | 72 条尚未完成可识别专业人员的适用性复核 | 正确保持未批准 | 按风险逐条复核正文、公司事实、适用条件、更新时间和下次复核日；不得批量伪造 reviewed/active |
| 易变政策 | 来源元数据、机器哈希、人工状态和业务状态分离；变化可标 stale/uncertain | 已实现 / 待运营 | 目标环境完成首次抓取、变化监控、证据快照、负责人和纠错流程 |
| 来源与履行凭证 | `sourceId`/`evidenceFileId` 分离、跨组织/未上传拒绝、被引用凭证归档拒绝和 linked-source withheld 已覆盖 | 冻结候选本地通过 | 人工核对凭证充分性 |
| 顾问使用边界 | 未复核、过期或不活动来源不会进入法务顾问确定事实 | 定向候选已验证 | 真实模型启用后重新验证引用、权限、过期与越权边界 |

这些来源不是专业合规批准，也不证明任何结论适用于耀光或电竞教育业务。

## 5. 当前工程测试状态

| 层级 | 当前发布状态 | 最终证据要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **本地通过** | 190 个 Biome 文件、全 shell、3 个 workflow、7 个 TS 项目；GitHub CI 复现 |
| 单元/聚合 | **本地通过** | 162/162 单元与完整 workspace 聚合通过；原始日志不进 Git |
| API / worker / PostgreSQL / pg-boss | **本地通过** | 最新 API 17 files/85 tests、worker 5 files/25 tests；10 个 migration、fresh/legacy、权限、引用链锁、连接恢复、并发/CAS、审计和失败边界通过 |
| MinIO / S3 | **本地通过** | 2 项真实私有桶/字节/权限/校验和集成及恢复对象核对通过 |
| Web / Playwright / PWA | **本地通过，有真机边界** | mock 44 passed/6 条件 skip；real 2 passed；独立浏览器、离线壳、SW active、390 px 通过；真机待验收 |
| 全 workspace / 七镜像构建 | **本地通过，有 registry 边界** | production build、PWA 9 precache/560.36 KiB；引用链增量候选七个 arm64 镜像、六常驻服务健康、Trivy 0 和七份 SPDX 通过；既有重启持久性证据通过，GHCR 双平台待发布 |
| 安全/供应链 | **本地通过，有 GitHub 边界** | Gitleaks、Semgrep+canary、`audit --prod` 0、IaC、七镜像 Trivy 0、7 SPDX、真实 BuildKit provenance fixture 通过；GitHub CodeQL/安全 workflow 待运行 |

七镜像的本地 arm64 content ID、SPDX 和扫描证据不是 GHCR 双平台 root digest 或签名。全依赖只余 dev-only `drizzle-kit -> esbuild` 1 个 moderate，生产依赖为 0；CI 不启动其 dev server，作为非阻断升级项跟踪。

## 6. 部署、运维与安全

| 验收项 | 当前证据 | 状态 | 最终闸门 |
| --- | --- | --- | --- |
| Compose 与迁移 | 最新 production-like Compose：38 表、10 个迁移、pg-boss 24、ready、六服务重启和持久性通过 | 冻结候选本地通过 | GitHub SHA 与目标内网复现 |
| HTTPS、PWA 与浏览器 | 受信 SAN `choice-final.localhost`、CSP/HSTS、desktop/mobile、PWA offline 和独立 browser 抽查通过 | 冻结候选本地通过 | 目标 DNS、CA、防火墙和真实设备 |
| PostgreSQL 身份 | PostgreSQL 17.10；bootstrap/migrator/runtime/backup/restore 分离；fresh/legacy 正负向 ACL 和审计权限通过 | 冻结候选本地通过 | 目标凭据复演 |
| MinIO 四身份 | root/bootstrap/app/backup/restore 最小权限、旧 key 显式撤销边界和真实 S3 集成通过 | 冻结候选本地通过 | 若目标更换 access-key ID，root 删除旧用户并用旧凭据验证失败 |
| formatVersion 2 恢复 | 一次隔离 drill：归档 SHA `bcfd6c59…b6ba`、38 表/10 迁移/pg-boss 24、1 对象 56 B、RPO 2s、RTO 75s、七镜像稳定、资源清理通过 | 冻结候选本地通过 / 范围受限 | `production_restore_entrypoint_executed=false`；目标内网/异介质与经审批生产入口待演练 |
| 旧 v1 恢复与升级 | 2026-07-18 的 v1 归档、37 表/4 对象/16 秒和同内容标签升级回滚均早于 formatVersion 2 与最新代码 | 历史证据 | 不能计入当前门禁；最终 SHA 需用真实版本变化重做升级/回滚 |
| synthetic bridge 相邻版本 | N `859841f…`/10 migrations 与本地 bridge `b44a8d1…`/9 migrations；七 digest 全异，真实 push/pull，升级 46s、回滚 43s、双 v2 恢复点；回滚后 308s 登录与 CRUD 通过 | 冻结候选本地通过 / 范围受限 | 不是历史生产 N−1、GHCR 或目标内网；经批准生产候选仍须复演 |
| 归档与维护安全 | archive guard、资源上限、scratch、preflight、maintenance lock 及对应安全测试通过 | 冻结候选本地通过 | 经审批生产 `restore.sh` 破坏性入口仍待目标演练 |
| 七镜像与供应链 | arm64 七镜像 Trivy 四口径均 0；7 SPDX；真实 BuildKit 双平台 fixture；API/worker amd64 原生件补偿验证 | 冻结候选本地通过 / GHCR 待发布 | 最终 SHA 的双平台 registry digest、GitHub workflow 和残余风险批准 |
| GitHub 交付 | 连接修复实现基线 `859841f…`，Draft PR #12 已创建；既有 CI/Security run 在 runner 启动前因账户付款失败或 spending limit 不足被 GitHub 阻断，未执行任何 step | 部分完成 / 外部计费阻断 | 推送文档 head 后复核远端；修复 Billing & plans 后重跑并取得绿色 CI/security、制品和批准；再合并 |
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
| 合规 | 未复核来源受限；source/evidence 跨组织/上传/归档/withheld 边界通过 | 72 条专业复核与目标环境首次抓取 |
| 官网与教育 | 官网审计、内部教育页和成人试点草案已形成 | 内容清理、权利/事实核验及九项业务/专业闸门批准 |
| 桌面、移动与 PWA | mock/real E2E、独立浏览器、SW active、offline shell 和 390 px 布局通过 | 真实受管手机安装/升级 |
| 部署与恢复 | 最新 Compose、38 表/10 迁移、一次独立恢复 RPO 2s/RTO 75s，以及本地 synthetic bridge 真实差异升级/应用回滚通过 | 历史生产 N−1/目标发布复演、生产恢复入口、目标内网与 RPO/RTO 批准 |

## 8. 当前结论

该仓库已经超过脚手架、静态仪表盘和数据库模型阶段。核心业务、首次改密与成员生命周期、归档角色即时失权、八类人工批准、typed refs、可追溯顾问、后台原子 claim 和 formatVersion 2 恢复路径均有实现与候选证据。

当前仍只能称为**受控候选**。冻结工作树的全量测试、生产构建、最新 Compose、桌面/移动浏览器、本地供应链扫描、一次底层独立恢复和一次本地 synthetic bridge 真实差异升级/应用回滚已经通过，候选分支已创建 Draft PR；GitHub CI/security 因账户计费在 runner 前被阻断，GHCR、历史生产 N−1/目标发布复演、生产恢复入口、目标办公内网、真机、真实 LLM/GitHub、72 条专业复核、残余风险决策和业务批准仍未完成。在这些门禁全部关闭前，不得宣布“V1 已完成”，也不得用于无人监督的生产关键操作。

## 9. 最终 SHA 与目标环境必须补录

| 字段 | 当前值 | 要求 |
| --- | --- | --- |
| 完整 Git SHA / tag | 连接修复实现基线 `859841f79efc68fd75757b6f3232ba4eaa56cb3a`；tag 未创建 | 推送文档 head 后记录完整 SHA；确定 commit/tag 签名政策，生产发布记录受保护 tag |
| GitHub PR / CI / 安全 run | Draft PR #12；CI `29674559169`、Security `29674559116` 均被账户付款/spending limit 在 runner 前阻断 | 修复 Billing & plans 后重跑；只有实际 step 执行且绿色才能关闭门禁 |
| 38 表 / 10 migrations（`0000`–`0009`）证据 | **冻结工作树本地通过** | GitHub SHA 与目标环境复现 fresh/legacy、pg-boss 和权限 |
| 七镜像 digest / SBOM / provenance | **本地 arm64/SPDX/fixture 通过** | 从最终 SHA 生成并记录 GHCR 双平台 registry digest |
| 最终测试报告 | **冻结工作树本地通过** | 提交后记录不可变 SHA 与 GitHub run；源码漂移则重跑 |
| 最终 formatVersion 2 备份与恢复 | **底层独立 drill 通过** | 归档 SHA `bcfd6c59…b6ba`、RPO 2s/RTO 75s；生产入口、目标/异介质待验收 |
| 最终升级/回滚 | **本地 synthetic bridge 通过 / 生产范围待完成** | 使用最终 GHCR 制品、经批准 N−1 和目标环境复演 expand/contract、双恢复点与 idle 后业务链 |
| 目标办公内网 / 真机 | **未完成** | 记录主机、DNS、CA、设备、网络、PWA 和批准人 |
| 真实 LLM / GitHub | **未完成** | 最小权限、数据处理、质量和停用/撤销证据 |
| 合规、风险与业务批准 | **未取得** | 由真实责任人签署，不得由系统代填 |
