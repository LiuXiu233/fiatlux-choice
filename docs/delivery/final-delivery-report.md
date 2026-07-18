# FIAT LUX CHOICE 受控候选交付报告

报告日期：2026-07-18

报告状态：**受控候选记录，不是 V1 已完成、已批准上线或已完成 GitHub 交付的声明**

本报告记录本地候选验证、部署与恢复演练已经取得的稳定事实，并把仍需由 GitHub 或真实责任人补齐的值显式标出。最终发布应复制本报告的事实和[最终交付报告模板](./final-delivery-report-template.md)的批准结构，补齐不可变 Git/GitHub、目标内网、剩余漏洞风险决策和责任人签署证据。

## 1. 候选身份与批准状态

| 字段 | 当前值 | 仍需完成 |
| --- | --- | --- |
| 产品版本 | V1 受控候选 | 业务负责人批准后才能改为 V1 完成 |
| 目标仓库 | 私有 `LiuXiu233/fiatlux-choice` | 创建/确认仓库、推送并记录可访问 URL |
| Git SHA / tag | **本地候选已复测；当前仍无可交付提交** | 创建提交后替换为完整不可变 SHA 与受保护 tag |
| GitHub PR / CI | **未运行最终提交** | 补 PR、合并、CI、Trivy、Gitleaks、SBOM 链接；CodeQL 须记录实际通过或 entitlement 不可用时的“未运行”与等效 SAST |
| 数据库 | PostgreSQL，37 张表、2 个迁移（本地候选 QA） | GitHub 发布后将迁移绑定到最终 SHA |
| 候选 QA 环境 | 开发机 production-like Compose，`https://choice.localhost:18443` | 不得改写成耀光广州办公内网生产环境 |
| 目标办公内网 | **未部署** | 补主机、OS、架构、DNS、CA、防火墙、设备和运行观察 |
| 业务批准 | **未取得** | 公司负责人真实签署 |
| 安全/运维批准 | **未取得** | 责任人基于最终证据签署 |
| 法务合规/财税批准 | **未取得** | 专业人员说明资质、事实、范围和有效期 |

当前结论：

- [ ] V1 已完成并批准上线
- [x] 受控候选，只能继续 GitHub/目标内网验证和有限 QA
- [ ] 已完成真实 LLM/GitHub 集成验收
- [ ] 已完成耀光广州办公内网生产验收

## 2. 已交付范围

| 模块 | 实现 | 候选验证结论 |
| --- | --- | --- |
| 身份与权限 | 用户、组织、数据库会话、owner/admin/member/viewer、权限字符串、组织隔离、改密和关键角色审批 | 待审批成员登录 403 且无会话；权限允许/拒绝、并发冲突和审计已测 |
| 审计与文件 | 追加审计、请求 ID、前后值、拒绝事件、私有 S3/MinIO 文件 | 最终运行栈 68 字节对象与核心链 70 字节对象均完成校验；跨组织拒绝、不可经 API 篡改审计和拒绝请求体最小化已测 |
| 执行与治理 | 目标、项目、任务、决策、义务、合规日历、风险、合同 | 核心链验证目标→项目→任务强外键、pending 来源→义务/事件、文件→合同/发票；决策关联仍有边界 |
| 财务 | 简易收支、发票、现金流、外部动作引用 | 核心链覆盖收支和现金流；签署、银行、红冲 manual 动作只到 approved、不进入 confirmed |
| 产品与市场 | 产品组合、市场机会、电竞教育筹备页 | 页面和 CRUD 可用；产品/机会/项目尚无类型化关系 |
| GitHub 情报 | manual/read-only 边界与刷新队列 | 候选使用 manual；没有真实 GitHub 凭据或读取验收 |
| 审批与外部动作 | 七类高风险人工批准、manual/mock/real 状态机、幂等 | 银行动作保持 `pending_approval/manual`；没有外部回执时不报成功 |
| 通知与工作流 | in-app、失败可见的 email/webhook 边界、四类工作流步骤 | 真实 pg-boss 工作流 completed 并创建任务 |
| 七类顾问 | 总经理、财务、法务合规、产品研发、市场机会、人力行政、信息安全；提示词/模型/工具/引用/编辑审计 | 七类均以 mock completed；未复核来源被法务顾问 withheld；不代表真实模型质量 |
| PWA | 响应式导航、manifest、service worker、离线壳和恢复会话 | 9 项 precache；本机桌面 Chromium 和 iPhone 14 Chromium 仿真通过 |
| 部署与灾备 | Compose、Caddy、迁移、健康检查、日志、备份/恢复、升级/回滚脚本 | 最终本地镜像已部署；最终 age 备份、独立恢复、实际升级与回滚通过；目标内网仍待完成 |

## 3. 测试结果

以下数字来自 2026-07-18 的本地候选工作树。创建 Git 提交后，GitHub CI 仍必须在不可变 SHA 上复现，不能用本地结果替代远端证据。

| 层级 | 候选命令/环境 | 结果 | 跳过口径 |
| --- | --- | --- | --- |
| Biome | `pnpm lint` | 118 个纳入 Biome 的源码与配置文件通过 | gitignored 的 backups/data/screenshots/tmp 运行数据与证据目录按设计不属于源码检查范围 |
| 类型检查 | `pnpm typecheck` | 7 个工作区通过 | 0 已知阻断 |
| 单元测试 | `pnpm test:unit` | 46 passed | 0 已知阻断 |
| 真实集成 | PostgreSQL、pg-boss、MinIO/S3 | 31 passed：API 25、worker 4、MinIO 2；新增核心链用例单独通过 | 0 skipped |
| 聚合测试 | `pnpm test` | 77 passed | 0 failed、0 skipped |
| Playwright | 隔离预览端口 4174 | 19 passed、1 expected conditional skip | 10 个测试定义：9 个桌面/移动双跑，1 个 mobile-only 在桌面项目预期 skip；不是 19 个独立闭环 |
| PWA 构建 | VitePWA | 9 项 precache，manifest/service worker 生成 | 无 API 数据离线缓存 |
| 生产构建 | 全工作区构建 | 通过；PWA 9 项 precache | GitHub CI 仍需复现 |
| 生产依赖审计 | pnpm 官方 registry | 0 vulnerabilities | GitHub 安全工作流仍需复现 |

### 失败历史与复测

| 原始问题 | 原始结果 | 候选复测 |
| --- | --- | --- |
| Biome | 50 errors、6 warnings | 118 个纳入 Biome 的源码与配置文件通过；gitignored 的运行数据与证据目录按设计排除 |
| API 集成测试 header 类型 | 2 处类型错误 | 7 个工作区类型检查通过 |
| Vitest 收集 Playwright | 聚合测试失败 | 修正聚合范围并新增核心链后完整复跑 77 passed |
| 数据库包无测试文件 | 独立脚本失败 | 已纳入当前单元/聚合脚本语义 |
| 端口冲突 | 默认 4173 命中无关应用 | 固定使用 4174，Playwright 19 passed/1 expected skip |
| 自编译 Caddy 首次重建 | internal CA 尝试写只读 `/home/fiatlux`，网关重启 | 设置 `HOME=/tmp`、`XDG_DATA_HOME=/data`、`XDG_CONFIG_HOME=/config`；重建后 HTTPS/健康检查通过 |
| GitHub 双架构 Caddy 冷构建 | web/gateway 在 QEMU 下约 32 分钟完成，距离 35 分钟 job 超时过近 | Caddy 改为在 `BUILDPLATFORM` 上显式交叉编译，amd64/arm64 静态 ELF 均实际运行并报告 v2.11.4；跟踪中的双架构镜像本地构建通过，最终 GitHub SHA 仍须复跑 |
| 升级前配置备份 | 直接 tar 活跃 bind mount 出现 `file changed as we read it` | 先复制到容器内稳定暂存目录再加密；包含发布状态的两次升级和一次回滚连续通过 |
| 严格镜像扫描 | `ignore-unfixed=false` 暴露 Debian 与 MinIO 无公开修复版本项 | 发布保存完整 JSON，只自动阻断可修复项；MinIO 风险保持目标生产闸门 |

端口 4173 在该开发机上不得作为本项目验收证据。

## 4. 本机 production-like QA

在受信任的本机 Caddy internal CA 下验证了：

- `/health/live`、`/health/ready`、迁移、PostgreSQL、MinIO 和 pg-boss。
- 待审批成员登录 403 且没有会话。
- 银行动作保持 `pending_approval/manual`；幂等重放和冲突行为正确。
- 最终运行栈完成 68 字节 MinIO 上传、complete、下载及 SHA-256 一致；文件 ID `2330920f-dc1e-4fa8-9cec-5e85f33e3cef`。
- 新增核心链集成以 70 字节对象验证 S3/SHA，并覆盖目标→项目→任务强外键、pending 官方来源→义务/事件、文件→合同/发票、财务/现金流、签署/银行/红冲 manual 只到 approved、跨组织拒绝和审计不可篡改。
- 工作流 `f2941574-806d-4f3a-b326-b64321b4f255` 达到 completed 并创建真实任务。
- 七类 mock 顾问均 completed，模型调用/工具调用可审计；未复核来源在运行 `86632deb-6765-4811-9550-1e3e46ef7b1b` 中被 withheld 且没有 citation。
- 409 拒绝审计不保存请求体。
- 桌面 Chromium、iPhone 14 Chromium 仿真、Service Worker、离线壳和联网恢复；浏览器控制台与视觉检查无阻断。
- Caddy 注入的 CSP/HSTS 等安全头在浏览器路径生效。

本机截图和运行日志位于操作员工作区 `tmp/final-evidence-post-freeze/`，因可能包含环境数据而按设计不提交。交付到 GitHub 时必须使用 Actions artifacts 或脱敏清单提供与最终 SHA 对应的正式证据。

## 5. 安全与供应链

最终本地候选镜像的 content digest 如下。这些值用于定位本机已扫描、已运行的镜像；GitHub 发布后仍必须补多架构 registry digest：

| 镜像 | 本地 content digest | 可修复 HIGH/CRITICAL | 无公开修复版本的 HIGH/CRITICAL |
| --- | --- | --- | --- |
| API | `sha256:f03154fe7747b9642a99d99156616c28cd586ab8b262b4ae84cff951495f60eb` | 0 | 21 |
| worker | `sha256:d471195e0e4bd523143c7376fb4e6b11475367126295d6db5ecb766d9c0a471e` | 0 | 22 |
| web | `sha256:a859ebc31583d3f313afc23f964087b135054f9f33a9e42bb95412a6f4da6a1c` | 0 | 0 |
| gateway | `sha256:502ddce9e7e4fdf61e9b0011a1db1a2713bdf8775d49cfbd5bfa89c990b7d2a8` | 0 | 0 |
| MinIO | `sha256:54c577c546ea5433bf1d02ef842d09b2687cc36bb1348c8691b44ab98e1cc405` | 0 | 6 |
| backup | `sha256:81768ce039305f533dedeef1b01907fa939b3758566b4733b06dbda1b5b69d12` | 0 | 0 |

Trivy 的发布闸门阻断所有存在 `FixedVersion` 的 HIGH/CRITICAL，同时保存不忽略未修复项的完整 JSON 报告。API/worker 的剩余项来自 Debian 12 供应商尚无修复版本；MinIO 的 6 项影响最后一个公开 OSS 发行版，AIStor 修复版不在公开 OSS 仓库。当前补偿控制是 MinIO 仅位于 Docker internal network、不发布宿主端口、不启用 OIDC/LDAP/S3 Select，且用户上传不能直接控制 S3 请求头。这些控制降低但不消除风险；迁移到受支持的 S3 实现、取得供应商修复版或由有权负责人限期接受风险，是目标生产上线闸门。

其他候选结果：文件系统与六镜像均为 0 个**可修复** HIGH/CRITICAL；生产依赖审计 0 vulnerabilities；第三方 GitHub Actions 已固定完整 commit SHA；Caddy CSP 已经浏览器验证。

未完成：最终暂存内容和 Git 历史 Gitleaks、目标 GitHub CodeQL/安全工作流、最终 SHA 六镜像、registry digest、SBOM/provenance 和目标内网暴露面复核。

## 6. 合规与 AI 边界

- 结构化数据集有 72 条中国、广东、广州官方来源；72 条全部保持 `reviewStatus=pending`、`contentHashStatus=pending_fetch`、业务 `status=draft`。
- 没有来源被批量标成 reviewed/active；因此没有专业人员批准的公司适用性结论。
- 核心链测试证明 pending 来源可以作为义务/事件的结构引用，但这不改变其 pending/draft 状态，也不允许顾问把它当作已复核法律事实。
- 当前 `LLM_DRIVER=mock`。七类顾问验证的是权限、结构、审计、withheld 和工作流，不是实际模型质量、法律意见或供应商数据处理能力。
- 当前 `GITHUB_INTEGRATION_MODE=manual`。没有真实 GitHub 连接证据。
- 银行付款、税务申报、发票红冲、正式签署、人事处分、关键权限和对外法律承诺保持人工批准；manual/mock 不构成外部成功。
- 电竞教育页面是内部筹备工作台，不是招生、支付、直播、考试或认证平台；成人试点上线闸门和专业意见尚未批准。

## 7. 最终本地备份、恢复与升级证据

以下证据在最终本地镜像部署后取得；备份、密钥和业务数据按设计不提交 Git：

| 项目 | 最终本地证据 |
| --- | --- |
| worker/Web 数据库备份 | ID `f8749e09-ed0c-4b81-84c0-ba009fc7ee0e`；224825 bytes |
| 数据库备份 SHA-256 | `59221f15f88938ef9acd24f01feb547b902961e29b1a27cc7e4ca2e1733e43bb` |
| 数据库备份可读性 | age 加密、权限 0600；流式解密后 `pg_restore --list` 368 项 |
| 全量归档 | `final-rc-20260718T115003Z.tar.gz.age` |
| 全量 SHA-256 | `59e251fb1176a4afca5496b3153f61e206c2e6ed9830f7cd17e7bbdcb1b289f1` |
| 配置副本 SHA-256 | `e7512c8621f14afeb77b19a4dee06403c274fb57c472149f35898ece16a232aa`；不包含 age 私钥 |
| 隔离恢复核对 | 新随机 Compose project/卷，manifest 全通过；37 张表、4 个 MinIO 对象、迁移和 readiness 通过 |
| 恢复报告 | `backups/production-qa/restore-drill-20260718115034.log` 与 `restore-20260718T115040Z.json`；不提交备份或密钥 |
| 实测恢复时间 | 2026-07-18 11:50:34Z–11:50:50Z，共 16 秒 |
| 恢复点 | 备份时暂停写入；测试恢复点内数据损失为 0，业务 RPO 仍需负责人批准 |

升级/回滚使用本机临时 OCI Registry 的 `qa-rc-a`、`qa-rc-b` 两个不可变标签实际演练，两个标签指向相同候选内容，用于验证运维机制而不是数据库 schema 变化：`local → qa-rc-a` 35 秒、`qa-rc-a → qa-rc-b` 35 秒、`qa-rc-b → qa-rc-a` 应用回滚 33 秒；每一步均先创建 age 加密恢复点并通过 live/ready、端口与容器加固验证。演练发现并修复配置备份直接读取活动 bind mount 的竞态；修复后含发布状态目录的配置备份连续通过。数据库没有执行 down migration。

## 8. 已知结构与运行边界

- decisions 没有 objective/project/task 类型化外键；现有目标→项目→任务的 typed chain 不包含决策。
- products、opportunities 与 projects 之间没有类型化关系，不能声明数据库已验证产品→机会→交付闭环。
- 本地邮箱密码认证没有 SSO、MFA、忘记密码、恢复码或强制首次改密；已有改密并撤销其他会话。
- 单主机 Compose 没有主机级高可用；恢复依赖经过演练的备份。
- 单文件上限 50 MB，没有反病毒、DLP、OCR 或媒体分片上传。
- Fastify 单独关闭 CSP；生产必须只经 Caddy 暴露。
- 最后一个公开 MinIO OSS 发行版存在 6 个没有公开 OSS 修复包的 HIGH/CRITICAL；当前 internal-network 补偿控制不能替代目标生产风险决策。
- 当前 LICENSE 为耀光（广州）电子竞技有限公司专有许可，不是开源许可。

完整列表见[已知边界](./known-boundaries.md)。

## 9. 最终提交与发布清单

以下全部完成前，本报告结论不得升级为“V1 完成”：

- [ ] 创建完整 Git SHA，审阅所有预期文件，确认没有 `.env`、Cookie、备份、age 私钥、token、截图或运行日志进入提交。
- [ ] 对最终暂存内容和可交付 Git 历史运行 Gitleaks。
- [x] 在本地候选工作树重跑 118 文件静态检查、7 工作区类型检查、46 单元、31 真实集成零 skip、77 聚合、Playwright、PWA 和生产构建；gitignored 的 backups/data/screenshots/tmp 是运行数据或证据目录，不属于源码检查范围。
- [x] 从本地候选重建六个镜像，记录 content digest，并验证 0 个可修复 HIGH/CRITICAL；完整未修复项另行保留。
- [x] 部署本地最终候选并重跑 HTTPS API、桌面、iPhone 14 Chromium 仿真和 PWA。
- [x] 对最终本地部署生成新的 age 数据库/全量备份，在独立卷恢复并记录 37 表、4 对象和 16 秒实测恢复时间。
- [x] 完成两个本地不可变候选标签的实际升级/回滚演练。
- [ ] 在真实受管手机上完成 PWA 安装/升级和移动浏览器验证。
- [ ] 对 MinIO OSS 未修复漏洞完成迁移、供应商修复或有期限的负责人风险接受。
- [ ] 推送私有目标仓库，取得 PR/主分支 CI、Trivy、Gitleaks、SBOM/provenance 证据；CodeQL 必须实际运行通过，若私有仓库 entitlement 不可用则明确记录“未运行”并补经批准的等效 SAST，不能把 skip 记为绿色通过。
- [ ] 在耀光广州办公内网验证主机、DNS、CA、防火墙、seed、owner 首登改密、设备和运行观察。
- [ ] 对核心结构关系边界作出 V1 决策；未补关系时不得宣称完整 typed chain。
- [ ] 由公司、运维安全、法务合规和财税真实责任人完成适用范围内的批准。

## 10. 交付结论

FIAT LUX CHOICE 已有完整度较高、可实际运行的模块化单体候选；工程质量、本机 production-like HTTPS、真实数据库/对象存储/后台队列、权限审计、PWA 离线边界、最终本地备份恢复和实际升级回滚均有实证。它不再是脚手架或静态原型。

但证据尚未绑定最终 Git SHA，GitHub CI/发布、目标办公内网与真实设备、MinIO OSS 剩余风险决策、真实 LLM/GitHub、专业合规复核和业务批准仍未完成。因此本报告的唯一合法结论是：**受控候选，尚不可宣布 V1 已完成或已批准生产上线。**
