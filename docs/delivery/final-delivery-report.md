# FIAT LUX CHOICE 受控候选交付报告

报告日期：2026-07-20

报告状态：**受控候选记录，不是 V1 已完成、已批准上线或 GitHub CI 已通过的声明**

本报告区分“当前工作树已实现/已测试”“旧不可变提交的 10 迁移签名恢复”“待创建的新实现提交”“最终 GitHub/GHCR”和“目标办公内网验收”。当前专业复核增量已完成代码、数据库、API、Web、desktop/mobile 真实栈和上一版本升级验证，但尚未提交，Compose、安全扫描和 11 迁移签名恢复尚未重做；旧 `6545c18…` 恢复不能证明新增 `0010`。最终发布还必须按[最终交付报告模板](./final-delivery-report-template.md)补齐最终 Git/GitHub、目标内网、风险决策和真实责任人签署。

## 1. 候选身份与批准状态

| 字段 | 当前值 | 仍需完成 |
| --- | --- | --- |
| 产品版本 | V1 受控候选 | 所有阻断闸门关闭并取得业务负责人批准后才能改为 V1 完成 |
| 目标仓库 | 私有 `LiuXiu233/fiatlux-choice`；候选分支已推送；[Draft PR #12](https://github.com/LiuXiu233/fiatlux-choice/pull/12) | 解除 Actions 计费阻断，取得绿色 CI/security；批准后再合并 |
| Git SHA / tag | 远端分支当前为 `43a6007f642be815a1d9d83e2a6353a91d25b4a8`；专业复核实现尚未提交；未创建发布 tag | 创建实现提交后绑定测试、Compose、恢复点和后续文档提交；生产发布仍须确定 commit/tag 签名政策 |
| GitHub PR / CI | Draft PR #12 的最新已知 [CI run 29697701957](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29697701957) 与 [Security run 29697701952](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29697701952) **均在 runner 启动前失败** | `runner_id=0`、`steps=[]`，仍是账户付款或 Actions spending limit 阻断，没有 workflow step 实际运行；新提交自然触发后只读核验，不反复盲目重跑 |
| 数据库 | PostgreSQL 17.10；38 张业务表；11 个业务迁移 `0000`–`0010`；当前工作树 fresh、`0009→0010` 数据保留/幂等和 fresh/legacy 五职责权限均本地通过 | 新不可变提交、Compose、签名恢复、GitHub CI 与目标内网重新执行 |
| 候选 QA 环境 | 旧 10 迁移 production-like Compose 仍运行于 `https://choice-final.localhost:19443` | 新 `0010` 提交后重建；任何本机环境都不得改写成耀光广州办公内网生产环境 |
| 目标办公内网 | **未部署** | 补主机、OS、架构、DNS、CA、防火墙、受管设备和运行观察 |
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
| 执行与治理 | 目标、项目、任务、决策、义务、合规日历、风险、合同、typed refs 和证据型专业复核 | 专业复核锁定实名/角色/机构/胜任依据/缺失信息/证据/来源版本与哈希/站内登记人，追加不可改历史；通用 reviewed/确定生命周期提升被拒，实质编辑自动 stale/uncertain，当前与历史证据均受归档保护 |
| 财务 | 简易收支、发票、现金流、外部动作引用 | 金额使用整数分；正式外部状态仍依赖人工回执，不由内部批准伪造成功 |
| 产品、市场与电竞教育 | 产品组合、市场机会、电竞教育筹备页、官网公开业务/内容审计、成人试点课程草案，以及 4 篇带 Schema、版本、来源、练习、模板、AI 披露和审阅状态的成年人基础内容 | 四篇均为待人工复核、权利待确认和 WordPress 未发布；教育页面是内部筹备工作台，不是招生、支付、直播、考试、证书或未成年人平台 |
| GitHub 情报 | manual/read-only 集成边界与刷新队列 | 刷新任务在排队时保存当前 `expectedVersion`，worker 只在版本未变时以 CAS 写回，不用陈旧网络快照覆盖并发人工修改；真实 GitHub 凭据和最小权限读取验收未执行 |
| 审批与外部动作 | 八类高风险人工批准、manual/mock 状态机、幂等与合同/发票/付款台账原子联动 | 没有外部回执时不报成功；已关联草稿支出的银行付款在取消或审批驳回时于同一事务解除台账关联并增加版本，避免草稿被废弃动作永久占用 |
| 通知、顾问与工作流 | in-app 通知、失败可见的 email/webhook 边界、七类顾问、四类工作流步骤 | 通知 queued-only、工作流不可变快照/partial checkpoint、advisor/workflow/backup 原子 claim 和 lease 边界均已在冻结候选回归覆盖 |
| AI 可追溯 | 总经理、财务、法务合规、产品研发、市场机会、人力行政、信息安全；提示词/模型/工具/引用/人工编辑审计 | 运行默认只对发起人可见；合规事实要求完整、未到期专业 provenance，关联义务还要求 applicable；legacy/不适用/过期内容失败关闭；mock 不代表真实模型质量 |
| PWA | 响应式导航、manifest、service worker、离线壳和恢复会话 | 当前构建生成 10 个 precache 条目（700.30 KiB）；mock 46+6 与隔离真实栈 4/4 通过，专业复核 desktop/mobile 无溢出；真机安装/升级仍待执行 |
| 部署与灾备 | Compose、Caddy、迁移、健康检查、日志、最小权限数据库/MinIO、age+Ed25519 备份恢复、升级回滚工具 | 工具与旧 10 迁移证据存在；新增 `0010` 后必须在新实现提交上重建 Compose 与签名恢复。生产入口、历史生产 N−1、GHCR 和目标内网仍待执行 |

## 3. 最终冻结测试状态

以下结果属于当前未提交工作树，不能当作不可变发布证据。实现提交后必须重跑受影响的安全、Compose 和恢复门禁；原始日志、备份、私钥、Cookie 和运行数据保存在被忽略的本地证据目录，不进入 Git。

| 层级 | 当前发布口径 | 最终要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **当前工作树本地通过** | Biome 206 个文件；全 `scripts/`/`infra/` shell；3 个 workflow；7 个 TypeScript 项目 |
| 单元测试 | **当前工作树本地通过** | 177/177；最终不可变提交需聚合复跑 |
| API/worker/PostgreSQL/pg-boss/MinIO 集成 | **当前工作树本地通过** | API 18 files/89 tests、worker 5 files/25 tests、真实 MinIO 2/2；11 迁移 fresh 与 `0009→0010`、fresh/legacy 权限、事务/并发/CAS/审计和连接恢复通过 |
| Playwright / PWA | **当前工作树本地通过，有外部边界** | mock 46 passed、6 个设计内 skip；隔离真实栈 desktop/mobile 4/4；PWA production build 通过；受管真机另行验收 |
| 全 workspace 与七镜像构建 | **源码 production build 通过 / 新镜像待重建** | 新增层尚无不可变 SHA 的七镜像、Compose、Trivy/SPDX 或 GHCR 证据 |
| 安全/供应链 | **旧基线通过 / 当前改动待重跑** | 当前新增代码提交前仍须执行 Gitleaks、Semgrep+canary、依赖审计和相关镜像扫描；GitHub CodeQL/安全 workflow 待运行 |

生产依赖 `pnpm audit --prod` 为 0。全依赖扫描只剩 `drizzle-kit -> esbuild` 的 1 个 moderate，属于不进入生产镜像、CI 不启动其 dev server 的开发期依赖；列为非阻断升级项，不应表述为“全依赖零漏洞”。未运行、设计内 skip 和目标环境缺失继续分列。

失败历史没有删除：API 集成首次按文件并行运行时，在本机 2 CPU/4 GB 的 seed/Argon2 峰值出现 PostgreSQL `CONNECT_TIMEOUT`，得到 13 passed、4 failed、63 skipped；数据库全程 healthy、RestartCount 0、连接数未耗尽，且无业务断言失败。将 root/API/worker 的 `test` 与 `test:integration` 标准入口固定为 unit→workspace 串行、API/worker `--no-file-parallelism --maxWorkers=1` 后，旧基线 API 80/80、worker 23/23 和根级集成均通过。连接恢复修复后曾复跑 162/162 单元、API 83/83、worker 23/23；其中 malformed-JSON 单测曾在宿主 load 83 时唯一超时，在正常负载下同一测试 140 ms 通过，未删除该环境事件。引用链一致性加固后的最新复跑为 162/162 单元、API 85/85、worker 25/25。未配置 S3 时 integrations 2 项按设计 skip；真实 S3 两项由单独带凭据的 MinIO 门禁 2/2 通过，不能把 skip 记作通过。

引用链增量候选另在全新随机命名的 Compose 项目中重建 PostgreSQL、API、worker、Web、gateway、MinIO、backup 七镜像，完成空库五职责引导、10 个业务迁移、pg-boss 24、72 条来源 bootstrap、六服务健康和 `verify-deployment.sh` 最小权限检查；随后显式删除该项目全部容器、网络和卷。七镜像以 Trivy 0.70.0 扫描 HIGH/CRITICAL 均为 0，并生成、校验七份 Syft 1.42.3 SPDX。该本地增量证据仍不是最终 Git SHA 的 GHCR 双平台 digest、签名或目标内网证据。

电竞教育内容增量在同日完成 167/167 单元、API 85/85、worker 25/25、mock Playwright 44 passed/6 条件 skip 和真实栈 desktop/mobile 2/2；独立 Python Playwright 在 1440×1000 与 390×844 下均无横向溢出或控制台错误。隔离 PostgreSQL 的 22 个完整 bootstrap 组织均精确导入 73 条来源，隔离真实栈单组织同样为 73 条且新增健康来源精确 1 条。生产构建将教育内容拆为 128.19 kB 路由块，消除 500 kB 主块告警；独立 Web Compose 容器以 UID 10001、只读根、cap-drop ALL、no-new-privileges 健康运行，Trivy 0.70.0 对该新 Web 镜像扫描 HIGH/CRITICAL 为 0。Gitleaks 当前树/历史和 Semgrep 固定规则扫描均为 0 finding。隔离容器和网络验证后已删除；该证据仍不替代最终 SHA、七镜像重建、GHCR、目标内网或专业内容批准。

合规监测人工升级增量在独立 PostgreSQL 17 容器迁移后完成目标文件 7/7 与完整 worker integration 5 files/25 tests。验证人工复核到期、正文变化和连续第三次失败都在来源状态事务内精确创建一条同组织 `todo/high` 任务及任务审计；重复扫描、同一哈希、第四次失败和陈旧并发结果不会重复或虚假建任务，失败错误在来源、任务和审计中均保持脱敏。专用数据库容器测试后已删除；负责人自动分配、邮件/企业协作通知和目标环境实际处置仍未验收。

文件真实内容门禁增量新增 6 项单元测试并把全工作区单元提高到 173/173；独立 PostgreSQL 17 上目标 API 文件 19/19、完整 API 17 files/86 tests 通过，真实 MinIO 私有桶往返/错误摘要删除 2/2 通过。伪装 PDF 在对象写入前返回 400，文件保持 `pending/version=1`，对象不存在，拒绝审计不含 body；压缩 OOXML 正/负向覆盖 DOCX/XLSX/PPTX 主部件、类型清单、宏、ActiveX、嵌入、加密和路径穿越。隔离 PostgreSQL/MinIO 容器均在测试后删除。该门禁不是反病毒、沙箱、完整格式语义解析或 DLP，不能把测试通过写成附件无恶意内容。

证据型专业复核增量在当前工作树完成 177/177 单元、API 18 files/89 tests、worker 25/25、真实 MinIO 2/2、mock 46+6 和隔离真实栈 4/4。真实 desktop/mobile 场景只在专用 E2E 数据库创建明确标注“非专业意见”的来源，上传实际对象、登记 not_applicable 测试结论、查看追加审计并验证证据归档返回 409；它不冒充 73 条来源的真实复核。专用迁移验收从 `0000`–`0009` 保存 legacy reviewed 数据、应用 `0010`、确认未发明 provenance 且幂等，再从空库得到 38 表/11 迁移；fresh/legacy 五职责权限也通过。该增量尚未提交，安全、Compose 和签名恢复结论仍待新不可变实现提交。

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
- 工作流运行创建时必须读取已启用的定义，校验发起人能执行每个步骤，并在同一事务保存 `definitionVersion` 和 `stepsSnapshot`。worker 只执行该不可变快照；每个成功步骤后保存 checkpoint，若后续排队失败，已创建的引用仍保留在 partial output。
- 顾问列表、详情和人工编辑都执行同一可见性规则：默认只允许发起人；读取他人运行需 `advisor-runs:read-all` 或 `*`，并且仍要通过该顾问 requiredPermission 和快照中每种资源的 `:read` 检查；不可见时按 404 隐藏存在性。
- 银行付款关联草稿支出后，在 pending_approval/approved/failed 等受支持状态取消，或对关联审批作出 rejected 决定时，台账关联与动作/审批在同一事务中解链并审计；并发变更导致版本不匹配时整笔冲突失败。

以上语义已由冻结工作树的单元、集成、真实栈 E2E 或部署抽查组合验证；最终提交和 GitHub CI 仍需确认没有源码漂移，目标办公内网需独立复现。

## 5. 安全、最小权限与供应链

- PostgreSQL 使用 bootstrap、migrator、runtime、backup、restore 五类分离身份；pg-boss DDL 只由一次性 migrator 执行，API/worker 的 runtime 身份无 DDL。38 张业务表、11 个迁移（`0000`–`0010`）、pg-boss 24、fresh 空卷与 legacy 单超级用户升级的正/负向权限探测均在当前工作树通过。
- MinIO/S3 分离 root/bootstrap、app runtime、backup、restore 四类身份。root 只用于初始化和管理；app 不能读取备份，backup/restore 权限按职责收窄。
- 保持 access-key ID 不变时可收敛轮换 secret；若更换 access-key ID，必须由 root-only 运维显式删除旧用户，并用旧凭据执行负向验证。bootstrap 无法枚举未知旧 ID，因此不能把“新 ID 可用”误写为“旧 ID 已撤销”。
- 恢复脚本有 Ed25519 公钥类型/独立指纹/规范化 attestation/签名/来源/版本门禁，以及归档路径/链接/设备/FIFO/sparse/重复项/父子冲突/尾随数据与资源上限防护，使用受保护 scratch 和跨 backup/restore/upgrade/rollback 的 maintenance lock；陈旧锁、partial 或异常明文暂存必须人工调查。签名失败在任何 Compose 或数据动作前退出；在线文件私钥不是 HSM，仍需独立 SHA 与人工批准。
- 冻结候选的七个 `linux/arm64` 本地镜像均由 Trivy 0.70.0 扫描；HIGH、CRITICAL、fixable 和 unfixed 四个汇总均为 0。API/worker 另完成 `linux/amd64` 实构、x64 Argon2id、worker `pg_dump 17.10`/age roundtrip 和 Trivy 0。Alpine/musl 与双架构原生件由这些补偿测试覆盖。
- Syft 1.42.3 为七镜像生成 7 份结构化 SPDX，绑定清单 SHA-256 为 `5563cc9a3df2e9adf03845aa63b63c314e6584c847e0a1d150b0a9439650c900`；Trivy 七镜像汇总 SHA-256 为 `502c93dd081a29ae1d8051d4ff039d8b3f8ab4d66d788b6e5aab533700bf3335`；本地总证据清单 SHA-256 为 `298c6aea759759b0140c392eec085b4e0fefaecf52ff8b43e9eb38b9cf3310c3`。这些文件留在 ignored 本地目录，不提交业务或恢复数据。
- Buildx `v0.35.0`、BuildKit `v0.31.2@sha256:2f5ada…`、QEMU/binfmt `qemu-v10.2.3@sha256:400a48…`、Trivy `v0.70.0` 和 Syft `v1.42.3` 固定到明确版本/摘要。真实 BuildKit 0.31.2 双平台 fixture 已通过，verifier 按 in-toto `https://in-toto.io/Statement/v1`、双平台 subject、来源 Git SHA、双平台 SPDX 与 sidecar 摘要做正/负向校验。
- 以上 image ID 是本地 arm64 manifest-list 内容 ID，不是已发布 GHCR 多架构 root digest，也不是签名；冻结源码提交后的 release workflow 仍须构建和验证 registry 证据。
- 旧报告关于当前 MinIO 镜像“6 项 HIGH”的结论已被最终镜像重建和 Trivy 0 结果取代。剩余问题是 MinIO OSS 的长期维护/支持与迁移退出风险，而不是把旧扫描数继续当作当前漏洞；目标生产前仍须由负责人选择受支持实现或形成有期限的风险接受。
- 预计暂存范围、当前树/完整历史 Gitleaks、自定义/default canary、精确 allowlist、大文件、symlink/submodule 和 ignored 证据边界已本地通过；提交后对 index/不可变 SHA 再复核，GitHub CI/SAST 和目标内网暴露面在推送及部署后分别验证。

| 本地组件 | 冻结候选 arm64 image ID |
| --- | --- |
| postgres | `21f55d61458ac149cce46ed6e9cb753810aa2331244aaba3a495ea938dc97c72` |
| api | `638412476f4aa142dd86f166e3a34bc1a8e54ce194f43cd295318306b4c73d14` |
| worker | `c6aafe90375c82cd9236ab3187d6afa45c57502e5f71c7bb0f73b1c5fa1d1f1a` |
| web | `e8926c92f89129afb5d9bfa83f7ebf24a3d070304acc33cfdf3e5c99be30caf5` |
| gateway | `a245c2d28d0a078da7313101077a2fefd81544061dd8b796dead50eded935e86` |
| minio | `74bd0fc3fa45b7eec2647b1f483847373c6a35dac8ec0f26782977c2a5569ef8` |
| backup | `389be4c6e10554e2395a42be60b4cb6a811b478c5adbea10a4fd9c86948619cf` |

## 6. 合规、AI 与官网/电竞教育边界

- 结构化数据集有 73 条中国、广东、广州官方来源；目前均未完成专业人工复核，不能据此宣称公司适用性结论已批准。
- 合规结论保存在可维护记录中；专用复核要求复核人、角色、机构/内部组织、胜任依据、适用条件、摘要、缺失信息、证据、结论、期限和理由，并锁定来源版本、哈希与站内登记人。通用写入和 seed 不能伪造 reviewed 或 `active|superseded|repealed`，政策变化不永久硬编码。
- 义务和合规日历可分别保存 `sourceId` 与 `evidenceFileId`。当前及历史专业复核引用过的证据也不可归档；需要更正时只能上传新文件并追加新意见。系统不验证资质真伪或意见正确性。
- 未复核、legacy 不完整 provenance、过期或不活动来源不会作为法务顾问事实；关联义务/日历还要求来源结论为 `applicable`，`not_applicable` 会失败关闭关联内容。自动抓取、哈希一致或 pending 引用都不等于专业复核。
- 人工复核到期、正文哈希变化和连续第三次监测失败会各创建一条立即到期、未分配的高优先级人工任务，并在来源事件与任务创建审计间保存关联；任务完成不会自动把来源写成已复核，邮件/企业协作通知仍未配置。
- 当前真实 LLM 尚未完成供应商、数据处理、预算和质量验收。定向 mock 流程只证明权限、结构、审计、withheld 和后台运行边界。
- 当前 GitHub 集成仍为 manual/read-only 边界，没有真实凭据验收。
- 八类高风险动作必须人工批准；manual/mock 不构成银行、税务、发票、签章、人事或法律平台已经成功执行。
- [fiatlux.gg 公开业务与内容盘点](../research/fiatlux-gg-public-business-audit.md)记录了 Marvel Rivals 队伍、现有服务信号和内容问题。9 篇公开博文中只有 2 篇有成型正文，另 7 篇为模板占位；美国地域表述、过期赛事未来时态、未核验见证以及 Contact 隐私/投诉信息仍需负责人修订和核验。
- `artifacts/browser/fiatlux-gg/` 的 6 张无登录公开页面截图只作为当前私有仓库的内部研究证据，并附采集方式、尺寸和 SHA-256；它们可能含人物与网页素材。仓库改为公开、对外分发或长期归档前，必须由公司确认肖像、版权、个人信息和保留范围，否则从交付历史前置分支移除并改存受控证据库。
- [成人电竞教育试点课程草案](../product/adult-esports-pilot-curriculum.md)限定中国境内成年人、小班、人工交付和 4–6 周试点。九项事实问卷、合同、隐私、退款、版权、健康提示、内容安全和事件响应未获批准前，不得扩展为公开招生或未成年人服务。
- [首批电竞教育基础内容](../../content/education/README.md)已形成四篇可维护内部草案并接入产品页面；每篇均保留版本、对象、负责人/审阅角色、权利、来源、AI 披露、正文、模板、练习和复核问题。四篇当前均为 `pending`/`pending_clearance`/`not_published`，不能把页面可读或测试通过写成专业复核或 WordPress 发布成功。

## 7. 历史 10 迁移 formatVersion 2 签名备份恢复证据

2026-07-20（UTC 执行时间 `2026-07-19T17:45:28Z`）曾从不可变实现提交 `6545c186753b5b7ba9a84d41d20879e6197362aa` 构建 backup 镜像，执行真实 age+Ed25519 一致性备份及随机全新卷隔离恢复；脱敏机器可读记录见[旧签名恢复证据](./evidence/signed-backup-restore-drill-20260720.json)。新增 `0010` 后，该表仅为历史证据，不证明当前 schema：

| 项目 | 不可变实现提交本地证据 |
| --- | --- |
| 归档身份 | SHA-256 `fa60a4392c6785c47d1700f440f87b6b448c899770245f018bab0a2f74cd0e85`；attestation SHA-256 `ef26e210955d5a5a16dbddf2603ac2ab13e9760801c2dbac68a94a39fe281cae`；`sourceId=fiatlux-finalqa-20260719` |
| 签名信任 | Ed25519；公钥 DER 指纹 `0eec7ab6d5ad31606498e238cd146ac3a657ee1fa70f7209d5c2dc4aed301ba6`；数据与加密配置归档的 checksum sidecar 和 attestation 均直接验证；恢复报告 `signatureVerified=true` |
| 负向门禁 | 错误 S3 恢复凭据保持数据库和桶 sentinel 不变；自动化回归另覆盖错误公钥/指纹、篡改归档/attestation/signature、错误来源/backup tool release、签名缺失/部分参数，并证明失败时无 Compose/备份/数据动作 |
| 数据库 | 38 张业务表；10 个迁移 `0000`–`0009` 逐 SQL SHA 核对；pg-boss 24；五职责角色、运行时和审计 ACL 通过 |
| 对象 | 3 个、132 bytes；对象清单 SHA-256 `020ea53def20c62445e52d4c9c867c95f84bf99f7e8ec7fa946122d9a3621421`；逐对象路径、字节和 SHA-256 读回一致 |
| 可用性与时间 | `database`、`queue`、`objectStorage` 均 ready；worker healthy；一致性备份 26 秒、实测 RPO 20 秒、drill RTO 45 秒 |
| 清理 | 临时签名私钥、归档、scratch、隔离容器/卷和临时 backup image tag 均删除；原 finalqa 六服务保持原容器 ID 且全部 healthy |
| 范围边界 | backup 来源已绑定 `6545c18…`，本地镜像 ID 为 `sha256:7da0b0f…bd70` 且 Trivy 0.70.0 HIGH/CRITICAL 为 0；`productionRestoreEntrypointExecuted=false`，不冒充最终跨层 Git SHA、经审批破坏性 `restore.sh`、异介质或目标办公内网证据 |

该证据证明当时 10 迁移实现的签名创建、独立指纹/摘要、底层恢复、数据库/对象一致性、权限和 readiness；不证明当前 11 迁移候选。新实现提交必须重新生成签名归档并隔离恢复；目标办公内网、异介质保管、业务批准的 RPO/RTO 和生产审批入口继续保持发布闸门。

2026-07-19 的旧 formatVersion 2 演练早于 Ed25519 attestation，2026-07-18 的 v1 归档、37 表/4 对象、16 秒恢复以及同内容标签升级/回滚则更早；两者都不能替代当前签名门禁或最终 SHA 复验。新的本地 synthetic bridge 复验见下一节，但它仍不能冒充历史生产 N−1 或目标环境发布演练。

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
- lease-expired 代表可能存在部分副作用，必须人工查看审计与 partial output 后新建明确运行；不得自动重放原记录。
- 单主机 Compose 没有主机级高可用；最终恢复仍依赖经过批准并周期演练的备份。
- 单文件上限 50 MB，没有反病毒、DLP、OCR 或媒体分片上传。
- Fastify 单独关闭 CSP；生产必须只经 Caddy 暴露。
- 当前 LICENSE 为耀光（广州）电子竞技有限公司专有许可，不是开源许可。

完整列表见[已知边界](./known-boundaries.md)。

## 10. 最终提交与发布清单

以下全部完成前，本报告结论不得升级为“V1 完成”：

- [x] 冻结工作树的预期范围、ignored 证据边界、当前树/完整历史 secret scan 和敏感数据已完成本地审计；仅纳入私有仓库的 6 张公开官网研究截图，公开或外发前仍需权利/个人信息复核；创建提交后还要在 GitHub 对不可变 SHA 复核。
- [x] 当前工作树完成 lint、ShellCheck、Actionlint、全部类型检查、177 单元、API/worker/MinIO、mock/real E2E 和生产构建，并分列设计内 skip；实现提交后仍须最终聚合复跑。
- [ ] 新 `0010` 实现提交的 production-like Compose 尚未重建；旧 10 迁移 HTTPS/PWA/六服务证据不能替代。
- [x] 首次强制改密、成员生命周期、版本化角色审批、归档角色即时失权、通知 queued-only、GitHub 刷新 CAS、工作流不可变快照、付款取消/驳回解链、顾问 requester-only/read-all、合规专业 provenance/source/evidence、typed refs 和文件并发场景已在分层测试覆盖。
- [x] fresh/legacy 数据库、PostgreSQL 五职责和 MinIO 四身份的正/负向最小权限验证通过；目标凭据仍须重新执行。
- [ ] `6545c18…` 只完成旧 10 迁移 age+Ed25519 恢复；新 11 迁移实现提交的签名独立恢复尚未执行。
- [x] 本地 synthetic bridge 使用真实 schema 与七镜像差异完成升级、双恢复点、应用回滚和 idle 后 HTTPS CRUD；历史生产 N−1、GHCR 和目标内网复演仍待执行，不得把本地结果升级为生产证明。
- [ ] 当前新增代码尚待实现提交前后完成 Gitleaks、生产依赖审计、Semgrep+canary、相关镜像 Trivy/SPDX；旧供应链证据不证明当前层。GitHub/GHCR 双平台 digest、CodeQL/等效 SAST 与剩余风险批准仍待执行。
- [ ] 在真实受管手机完成 PWA 安装/升级和移动浏览器验证。
- [ ] 专业复核实现尚未提交/推送；提交后须核对 Draft PR #12 远端 head 与自然触发的新 run。
- [ ] 修复 GitHub Actions 账户付款/spending limit 阻断，重跑 PR CI 与 Security；取得绿色 run、CodeQL 或经批准等效 SAST、制品证据，批准后再合并。
- [ ] 在耀光广州办公内网验证主机、DNS、CA、防火墙、显式 seed、owner 首登改密、设备、备份介质和运行观察。
- [ ] 完成真实 LLM/GitHub 最小权限验收，或明确保持 disabled/manual 且不宣称外部集成完成。
- [ ] 对 73 条来源完成适用范围内的专业人工复核；关闭官网/电竞教育事实、权利、合同、隐私和内容安全闸门。
- [ ] 由公司、运维安全、风险、法务合规和财税真实责任人完成适用范围内的批准。

## 11. 交付结论

FIAT LUX CHOICE 已形成可运行的模块化单体候选，不是脚手架、静态仪表盘或仅有数据库模型。身份、权限、审计、业务模块、八类人工批准、七类顾问、后台任务、PWA、最小权限、七镜像供应链和 Ed25519 签名 formatVersion 2 独立恢复路径均有分层实证。

当前工作树已完成专业复核增量的静态、单元、数据库、API/worker、MinIO、desktop/mobile 真实栈和生产构建验证，但尚未形成不可变实现提交，也尚未重建 Compose、安全扫描和 11 迁移签名恢复。GitHub CI/security 仍因账户付款或 spending limit 在 runner 前阻断；GHCR、历史生产 N−1/目标发布、生产恢复入口、耀光目标办公内网/真机、真实 LLM/GitHub、73 条真实专业复核、MinIO 支持风险决策及责任人批准均未完成。因此唯一合法结论仍是：**受控候选，尚不可宣布 V1 已完成或已批准生产上线。**
