# FIAT LUX CHOICE 受控候选交付报告

报告日期：2026-07-19

报告状态：**受控候选记录，不是 V1 已完成、已批准上线或 GitHub CI 已通过的声明**

本报告区分“代码已实现”“2026-07-19 冻结工作树本地验证”“本地隔离恢复演练”“最终 Git SHA / GitHub CI”和“目标办公内网验收”。本地候选已经完成工程、浏览器、部署、供应链和恢复收口，但本地结果不能自动升级为生产批准。最终发布还必须按[最终交付报告模板](./final-delivery-report-template.md)补齐不可变 Git/GitHub、目标内网、风险决策和真实责任人签署。

## 1. 候选身份与批准状态

| 字段 | 当前值 | 仍需完成 |
| --- | --- | --- |
| 产品版本 | V1 受控候选 | 所有阻断闸门关闭并取得业务负责人批准后才能改为 V1 完成 |
| 目标仓库 | 私有 `LiuXiu233/fiatlux-choice`；候选分支已推送；[Draft PR #12](https://github.com/LiuXiu233/fiatlux-choice/pull/12) | 解除 Actions 计费阻断，取得绿色 CI/security；批准后再合并 |
| Git SHA / tag | 连接恢复实现基线 `859841f79efc68fd75757b6f3232ba4eaa56cb3a`；未创建发布 tag | 本报告状态回写为后续纯文档提交；生产发布仍须确定 commit/tag 签名政策，并绑定受保护 tag、GHCR digest、测试和恢复点 |
| GitHub PR / CI | [CI run 29674559169](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29674559169) 与 [Security run 29674559116](https://github.com/LiuXiu233/fiatlux-choice/actions/runs/29674559116) **均在 runner 启动前失败** | GitHub annotation 明确为近期账户付款失败或 Actions spending limit 不足；`runner_id=0`、`steps=[]`，没有任何 workflow step 实际运行。修复 Billing & plans 后重跑；不得把本地通过或这次 failure 写成 GitHub CI 通过 |
| 数据库 | PostgreSQL 17.10；38 张业务表；10 个业务迁移 `0000`–`0009`；fresh 与 legacy 升级、pg-boss 24 和五职责权限均本地通过 | 最终提交后由 GitHub CI 复现；目标内网重新执行 |
| 候选 QA 环境 | 最新冻结工作树的本机 production-like Compose：`https://choice-final.localhost:19443`，受信 TLS SAN `choice-final.localhost` | 不得改写成耀光广州办公内网生产环境 |
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
| 执行与治理 | 目标、项目、任务、决策、义务、合规日历、风险、合同及 typed refs | decision 可引用 objective/project/task 并强制已填写项属于同一活动链；product 可引用 project，opportunity 同时引用 product/project 时必须匹配产品所属活动项目。父关系变更和归档不能破坏活动下游引用；义务/合规日历分开关联来源 `sourceId` 与完成凭证 `evidenceFileId`，来源关联仍不等于已判定适用 |
| 财务 | 简易收支、发票、现金流、外部动作引用 | 金额使用整数分；正式外部状态仍依赖人工回执，不由内部批准伪造成功 |
| 产品、市场与电竞教育 | 产品组合、市场机会、电竞教育筹备页、官网公开业务/内容审计、成人试点课程草案 | 教育页面是内部筹备工作台；不是招生、支付、直播、考试、证书或未成年人平台 |
| GitHub 情报 | manual/read-only 集成边界与刷新队列 | 刷新任务在排队时保存当前 `expectedVersion`，worker 只在版本未变时以 CAS 写回，不用陈旧网络快照覆盖并发人工修改；真实 GitHub 凭据和最小权限读取验收未执行 |
| 审批与外部动作 | 八类高风险人工批准、manual/mock 状态机、幂等与合同/发票/付款台账原子联动 | 没有外部回执时不报成功；已关联草稿支出的银行付款在取消或审批驳回时于同一事务解除台账关联并增加版本，避免草稿被废弃动作永久占用 |
| 通知、顾问与工作流 | in-app 通知、失败可见的 email/webhook 边界、七类顾问、四类工作流步骤 | 通知 queued-only、工作流不可变快照/partial checkpoint、advisor/workflow/backup 原子 claim 和 lease 边界均已在冻结候选回归覆盖 |
| AI 可追溯 | 总经理、财务、法务合规、产品研发、市场机会、人力行政、信息安全；提示词/模型/工具/引用/人工编辑审计 | 运行默认只对发起人可见；`advisor-runs:read-all`/全局权限只扩大候选可见集，读者仍必须拥有顾问入口及全部上下文资源读权限；mock 不代表真实模型质量 |
| PWA | 响应式导航、manifest、service worker、离线壳和恢复会话 | 最新构建生成 9 个 precache 条目（560.36 KiB）；mock/隔离真实栈 desktop/mobile、离线壳、SW active 和 390 px 无溢出通过；真机安装/升级仍待执行 |
| 部署与灾备 | Compose、Caddy、迁移、健康检查、日志、最小权限数据库/MinIO、备份恢复、升级回滚工具 | 最新 Compose、六常驻服务重启持久性、部署验证、一次底层 formatVersion 2 隔离恢复，以及一次本地 synthetic bridge 真实 schema/镜像差异升级与应用回滚均通过；历史生产 N−1、GHCR 和目标内网仍待执行 |

## 3. 最终冻结测试状态

以下最新质量结果绑定 2026-07-19 当前引用链加固工作树，尚未绑定不可变 Git SHA；底层恢复和 synthetic bridge 证据仍按各自明确的旧基线分列。实现提交后只允许回写交付元数据，否则必须重跑受影响门禁。原始日志、备份、私钥、Cookie 和运行数据保存在被忽略的本地证据目录，不进入 Git。

| 层级 | 当前发布口径 | 最终要求 |
| --- | --- | --- |
| Biome / ShellCheck / Actionlint / 类型 | **本地通过** | Biome 190 个文件；全 `scripts/`/`infra/` shell；3 个 workflow；7 个 TypeScript 项目 |
| 单元/聚合测试 | **本地通过** | 162/162 单元测试；完整 workspace 聚合通过；最终精确集成计数见同次测试日志 |
| API/worker/PostgreSQL/pg-boss/MinIO 集成 | **本地通过** | 最新 API 17 files/85 tests、worker 5 files/25 tests；fresh/legacy PostgreSQL、pg-boss 24、权限/事务/并发/CAS/审计、连接恢复以及 2 项真实 MinIO/S3 集成通过 |
| Playwright / 视觉 / PWA | **本地通过，有外部边界** | mock 全套 44 passed、6 个设计内条件 skip；真实栈 desktop/mobile 2 项通过；独立浏览器抽查、PWA 离线壳和 390 px 移动布局通过；受管真机另行验收 |
| 全 workspace 与七镜像构建 | **本地通过，有发布边界** | production build 通过；七个本地 arm64 镜像、六常驻服务健康/重启持久性和按需 backup 通过；GHCR 双平台 root digest 待 GitHub release workflow |
| 安全/供应链 | **本地通过，有外部边界** | Gitleaks、Semgrep 1.170.0+canary、生产依赖审计、IaC、七镜像 Trivy 0.70.0、七份 SPDX 和真实 BuildKit 0.31.2 provenance fixture 通过；GitHub CodeQL/安全 workflow 待运行 |

生产依赖 `pnpm audit --prod` 为 0。全依赖扫描只剩 `drizzle-kit -> esbuild` 的 1 个 moderate，属于不进入生产镜像、CI 不启动其 dev server 的开发期依赖；列为非阻断升级项，不应表述为“全依赖零漏洞”。未运行、设计内 skip 和目标环境缺失继续分列。

失败历史没有删除：API 集成首次按文件并行运行时，在本机 2 CPU/4 GB 的 seed/Argon2 峰值出现 PostgreSQL `CONNECT_TIMEOUT`，得到 13 passed、4 failed、63 skipped；数据库全程 healthy、RestartCount 0、连接数未耗尽，且无业务断言失败。将 root/API/worker 的 `test` 与 `test:integration` 标准入口固定为 unit→workspace 串行、API/worker `--no-file-parallelism --maxWorkers=1` 后，旧基线 API 80/80、worker 23/23 和根级集成均通过。连接恢复修复后曾复跑 162/162 单元、API 83/83、worker 23/23；其中 malformed-JSON 单测曾在宿主 load 83 时唯一超时，在正常负载下同一测试 140 ms 通过，未删除该环境事件。引用链一致性加固后的最新复跑为 162/162 单元、API 85/85、worker 25/25。未配置 S3 时 integrations 2 项按设计 skip；真实 S3 两项由单独带凭据的 MinIO 门禁 2/2 通过，不能把 skip 记作通过。

引用链增量候选另在全新随机命名的 Compose 项目中重建 PostgreSQL、API、worker、Web、gateway、MinIO、backup 七镜像，完成空库五职责引导、10 个业务迁移、pg-boss 24、72 条来源 bootstrap、六服务健康和 `verify-deployment.sh` 最小权限检查；随后显式删除该项目全部容器、网络和卷。七镜像以 Trivy 0.70.0 扫描 HIGH/CRITICAL 均为 0，并生成、校验七份 Syft 1.42.3 SPDX。该本地增量证据仍不是最终 Git SHA 的 GHCR 双平台 digest、签名或目标内网证据。

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

- PostgreSQL 使用 bootstrap、migrator、runtime、backup、restore 五类分离身份；pg-boss DDL 只由一次性 migrator 执行，API/worker 的 runtime 身份无 DDL。38 张业务表、10 个迁移（`0000`–`0009`）、pg-boss 24、fresh 空卷与 legacy 单超级用户升级的正/负向权限探测均在冻结候选通过。
- MinIO/S3 分离 root/bootstrap、app runtime、backup、restore 四类身份。root 只用于初始化和管理；app 不能读取备份，backup/restore 权限按职责收窄。
- 保持 access-key ID 不变时可收敛轮换 secret；若更换 access-key ID，必须由 root-only 运维显式删除旧用户，并用旧凭据执行负向验证。bootstrap 无法枚举未知旧 ID，因此不能把“新 ID 可用”误写为“旧 ID 已撤销”。
- 恢复脚本有归档路径/链接/设备/FIFO/sparse/重复项/父子冲突/尾随数据与资源上限防护，使用受保护 scratch 和跨 backup/restore/upgrade/rollback 的 maintenance lock；陈旧锁、partial 或异常明文暂存必须人工调查。
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

- 结构化数据集有 72 条中国、广东、广州官方来源；目前均未完成专业人工复核，不能据此宣称公司适用性结论已批准。
- 合规结论保存在可维护记录中，包含来源、适用条件、更新时间、机器哈希状态和人工复核状态；政策变化不应永久硬编码。
- 义务和合规日历可分别保存 `sourceId` 与 `evidenceFileId`：前者指向同组织未归档的合规来源，后者必须是同组织已 `uploaded` 的凭证文件。来源与凭证都可为空，因此记录成功不自动证明有法律依据或已完成履行；被引用凭证也不可在引用存续时归档。
- 未复核或已过期来源不会作为法务顾问的确定事实；自动抓取、哈希一致或 pending 引用也不等于专业复核。
- 当前真实 LLM 尚未完成供应商、数据处理、预算和质量验收。定向 mock 流程只证明权限、结构、审计、withheld 和后台运行边界。
- 当前 GitHub 集成仍为 manual/read-only 边界，没有真实凭据验收。
- 八类高风险动作必须人工批准；manual/mock 不构成银行、税务、发票、签章、人事或法律平台已经成功执行。
- [fiatlux.gg 公开业务与内容盘点](../research/fiatlux-gg-public-business-audit.md)记录了 Marvel Rivals 队伍、现有服务信号和内容问题。9 篇公开博文中只有 2 篇有成型正文，另 7 篇为模板占位；美国地域表述、过期赛事未来时态、未核验见证以及 Contact 隐私/投诉信息仍需负责人修订和核验。
- `artifacts/browser/fiatlux-gg/` 的 6 张无登录公开页面截图只作为当前私有仓库的内部研究证据，并附采集方式、尺寸和 SHA-256；它们可能含人物与网页素材。仓库改为公开、对外分发或长期归档前，必须由公司确认肖像、版权、个人信息和保留范围，否则从交付历史前置分支移除并改存受控证据库。
- [成人电竞教育试点课程草案](../product/adult-esports-pilot-curriculum.md)限定中国境内成年人、小班、人工交付和 4–6 周试点。九项事实问卷、合同、隐私、退款、版权、健康提示、内容安全和事件响应未获批准前，不得扩展为公开招生或未成年人服务。

## 7. formatVersion 2 备份恢复证据

2026-07-19 只执行了一次最终隔离 formatVersion 2 恢复演练，未因结果重试：

| 项目 | 本地候选证据 |
| --- | --- |
| 加密归档 | `finalqa-isolated-v2-20260719T042309Z.tar.gz.age`；54,511 bytes |
| SHA-256 / `sourceId` | `bcfd6c59d9e66f7319ab2b55e6e711e2adfe2732f2c3a928b02eb82a3768b6ba` / `fiatlux-finalqa-isolated` |
| 格式与镜像 | `formatVersion=2`；七个 `finalqa` tag/ID 在来源、恢复和核验全程稳定；六常驻服务健康，backup 按需 |
| 数据库 | 38 张业务表；10 个迁移 `0000`–`0009` 逐 SQL SHA 核对；pg-boss 24；五职责角色、运行时和审计 ACL 通过 |
| 对象 | 1 个、56 bytes；payload SHA-256 `2533627bc1adee817b00cc7593d048e8cbb7e71ba093d1438275d2b1fcaea29f`；对象清单 SHA-256 `e2b0877f6f5e6482338892c83cdf6c4a493998b6786ed0e94d9bf96240b86b52` |
| 可用性与时间 | `database`、`queue`、`objectStorage` 均 ready；worker healthy；实测 RPO 2 秒、drill RTO 75 秒 |
| 范围边界 | `production_restore_entrypoint_executed=false`：这是底层格式的独立恢复演练，不冒充经审批的破坏性 `restore.sh` 生产入口；该转换入口由 release-transition 安全测试覆盖 |
| 清理 | 来源/恢复容器、卷、明文 workspace、归档和临时 age identity 已删除；ignored 报告不提交 Git |

该证据证明冻结候选的底层 formatVersion 2 独立恢复、数据库/对象一致性、权限和 readiness 可用，并给出本机实测 RPO/RTO。它仍未证明目标办公内网、异介质保管、业务批准的 RPO/RTO 或生产审批入口；这些保持发布闸门。

2026-07-18 的 v1 归档、37 表/4 对象、16 秒恢复以及同内容标签升级/回滚属于**已被安全格式升级取代的历史证据**。它们早于 formatVersion 2 来源 metadata、资源上限、独立恢复凭据、N−1 backup image 选择和最新代码，不能计作当前或最终恢复门禁。新的本地 synthetic bridge 复验见下一节，但它仍不能冒充历史生产 N−1 或目标环境发布演练。

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
- [x] 冻结工作树完成 lint、ShellCheck、Actionlint、全部类型检查、全量单元/集成/聚合、mock/real E2E 和生产构建，并分列设计内 skip。
- [x] 最新 production-like Compose 已验证 HTTPS、38 张业务表、10 个业务迁移 `0000`–`0009`、pg-boss、PWA、六服务重启和持久性；目标内网复现待执行。
- [x] 首次强制改密、成员生命周期、版本化角色审批、归档角色即时失权、通知 queued-only、GitHub 刷新 CAS、工作流不可变快照、付款取消/驳回解链、顾问 requester-only/read-all、合规 source/evidence、typed refs 和文件并发场景已在分层测试覆盖。
- [x] fresh/legacy 数据库、PostgreSQL 五职责和 MinIO 四身份的正/负向最小权限验证通过；目标凭据仍须重新执行。
- [x] 冻结候选只执行一次底层 formatVersion 2 独立恢复并核对数据库、对象、迁移、pg-boss、权限、运行镜像、RPO/RTO 和清理；生产 `restore.sh` 审批入口、目标内网和异介质复演待执行。
- [x] 本地 synthetic bridge 使用真实 schema 与七镜像差异完成升级、双恢复点、应用回滚和 idle 后 HTTPS CRUD；历史生产 N−1、GHCR 和目标内网复演仍待执行，不得把本地结果升级为生产证明。
- [x] 本地完成 Gitleaks、生产依赖审计、Semgrep+canary、Trivy、七镜像 SPDX/provenance fixture 和 arm64 content ID；GitHub/GHCR 双平台 digest、CodeQL/等效 SAST 与剩余风险批准待执行。
- [ ] 在真实受管手机完成 PWA 安装/升级和移动浏览器验证。
- [x] 连接修复实现基线已纳入候选分支并对应 Draft PR #12；文档提交后仍须核对远端 head 和不可变 SHA。
- [ ] 修复 GitHub Actions 账户付款/spending limit 阻断，重跑 PR CI 与 Security；取得绿色 run、CodeQL 或经批准等效 SAST、制品证据，批准后再合并。
- [ ] 在耀光广州办公内网验证主机、DNS、CA、防火墙、显式 seed、owner 首登改密、设备、备份介质和运行观察。
- [ ] 完成真实 LLM/GitHub 最小权限验收，或明确保持 disabled/manual 且不宣称外部集成完成。
- [ ] 对 72 条来源完成适用范围内的专业人工复核；关闭官网/电竞教育事实、权利、合同、隐私和内容安全闸门。
- [ ] 由公司、运维安全、风险、法务合规和财税真实责任人完成适用范围内的批准。

## 11. 交付结论

FIAT LUX CHOICE 已形成可运行的模块化单体候选，不是脚手架、静态仪表盘或仅有数据库模型。身份、权限、审计、业务模块、八类人工批准、七类顾问、后台任务、PWA、最小权限、七镜像供应链和 formatVersion 2 独立恢复路径均有冻结工作树的分层实证。

本地全量测试、生产构建、最新 Compose、桌面/移动浏览器、安全扫描、一次独立恢复，以及一次有真实 schema/镜像差异的本地 synthetic bridge 升级与应用回滚已经通过，实现基线已形成 Draft PR。GitHub CI/security 因账户付款或 spending limit 在 runner 启动前被平台阻断，并非绿色；GHCR 双平台制品、历史生产 N−1/目标发布复演、破坏性生产恢复审批入口、耀光目标办公内网和真实受管手机、真实 LLM/GitHub、72 条专业复核、MinIO 长期支持风险决策以及业务和专业责任人批准也未完成。因此本报告的唯一合法结论仍是：**受控候选，尚不可宣布 V1 已完成或已批准生产上线。**
