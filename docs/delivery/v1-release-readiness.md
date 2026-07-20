# V1 发布门禁维护说明

基准日期：2026-07-20

当前结论：**受控候选，14 项门禁中 2 项通过、12 项阻断，不得宣布 V1 完成或批准上线。**

[机器清单](./v1-release-readiness.json)是 V1 最终就绪状态的结构化权威记录；[验收矩阵](./v1-acceptance-matrix.md)和[交付报告](./final-delivery-report.md)解释范围与历史证据，但不能绕过机器清单。PR Checks、GHCR 和目标环境记录仍是各外部事实的实时权威来源。

## 1. 文件与职责

| 文件 | 职责 |
| --- | --- |
| `packages/contracts/src/index.ts` | 定义 14 个固定门禁、证据、批准和总清单的 Zod Schema，以及只读评估器 |
| `docs/delivery/v1-release-readiness.json` | 保存当前候选提交、证据提交、逐项状态、证据引用、阻断项和责任角色 |
| `scripts/verify-v1-release-readiness.ts` | 校验 JSON、输出机器状态，并在要求 ready 时失败关闭 |
| `packages/integrations/src/v1-release-evidence.ts` | 以只读 GitHub/GHCR API 复核绿色 run 身份和七类不可变 digest |
| `scripts/verify-v1-platform-evidence.ts` | 仅对 ready 清单执行外部平台实证；blocked 状态在网络请求前失败 |
| `scripts/verify-target-intranet.sh` | 在真实目标主机组合校验受审源码、七类运行镜像、HTTPS 与最小权限，并原子生成脱敏机器报告 |
| `scripts/test-target-intranet-verification.sh` | 覆盖成功报告、三层失败、哈希/URL/端口/符号链接、拒绝覆盖和中断清理 |
| `scripts/verify-managed-device-pwa-evidence.ts` | 离线校验真实受管手机会话、候选/环境身份、固定步骤和实际附件，并原子生成不可覆盖报告 |
| `docs/delivery/templates/managed-device-pwa-session.template.json` | 故意含占位值、不能直接通过 Schema 的受管手机会话填写模板 |
| `scripts/restore.sh` | 在破坏性恢复前校验操作身份、批准断言、归档/发布身份和隔离路径，成功后生成绑定技术报告与最终健康状态的不可覆盖主机报告 |
| `scripts/test-restore-prebackup-dir-security.sh` | 覆盖操作元数据、二次风险确认、路径/容器挂载隔离、报告身份、权限、拒绝覆盖和失败关闭 |
| `.github/workflows/v1-readiness.yml` | 在候选制品和全部批准齐备后生成只读最终就绪证明，不执行生产操作 |
| `packages/contracts/test/v1-release-readiness.test.ts` | 覆盖完整通过、真实阻断、缺失/重复门禁、证据失败、提交不匹配和人工批准缺失 |

## 2. 使用命令

~~~sh
# 只检查 JSON、Schema 和跨字段约束；已纳入 pnpm check
pnpm delivery:v1:validate

# 输出可供自动化读取的 JSON 状态
pnpm delivery:v1:status

# 发布前强制门禁；当前应以退出码 2 拒绝发布
pnpm delivery:v1:require-ready

# 只对 ready 清单查询 GitHub/GHCR 实时状态；当前应在联网前拒绝
GITHUB_REPOSITORY=owner/repository \
GITHUB_ACTOR=operator \
GITHUB_TOKEN=temporary-read-token \
  pnpm delivery:v1:verify-platform

# 校验其他候选清单
pnpm exec tsx scripts/verify-v1-release-readiness.ts --file /absolute/path/to/manifest.json --json
~~~

目标办公内网机器证据不能由 GitHub runner 或开发机替代。部署完成后，目标环境运维负责人应在精确提交的干净 checkout 中按[部署验证清单](../admin/deployment-verification.md#目标办公内网机器证明)运行 `verify-target-intranet.sh`。它只有在源码 SHA、发布清单 SHA、七类 digest 与实际运行容器、服务健康/最小权限、目标 HTTPS 和 CA 全部通过后才写入 `0600` JSON；对应正负向测试已纳入 `pnpm check`、PR CI 和发布候选 workflow。

该 JSON 仍只是 `target_intranet_deployment` 的一部分机器证据。其审批编号为操作者断言且 `approvalIndependentlyVerified=false`；防火墙/DNS 管理证据、受管设备、生产恢复、运行观察和可识别运维批准仍须从独立渠道取得。只有原始报告哈希、脱敏副本、外部记录和人工批准相互核对后才能更新机器清单，不能因为包装器或其测试绿色而关闭该门禁。

真实受管手机证据同样不能由自动化浏览器替代。终端与业务验收负责人应按[受管手机验收手册](../admin/managed-device-pwa-verification.md)在目标 HTTPS origin 上完成旧版安装、Service Worker 升级、新版 standalone、核心登录、离线壳、联网重验、退出及站点数据清理，并用独立批准值向校验器提供版本、完整 Git SHA、URL 和环境 ID。报告会核对实际附件字节和哈希并保留 `sessionId`，但 `physicalDeviceIndependentlyVerified`、`managementStatusIndependentlyVerified`、`approvalIndependentlyVerified` 固定为 `false`；必须从 MDM、原始附件和公司批准渠道再复核，不能凭机器报告单独关闭 `managed_device_pwa`。

生产恢复入口在 `231d8e82164f8e31b1cc978975bf56e7ac6a26bb` 完成了操作身份、外部批准引用、业务理由、跳过恢复前备份二次确认、每 operation 独占技术挂载、技术报告 SHA 和最终主机健康报告绑定。exact-SHA 本地栈又完成 38 表、11 migrations、pg-boss 24、错误 S3 凭据破坏前拒绝和 1 个 41-byte 对象的 age+Ed25519 隔离恢复；证据见[生产恢复防护验收](./evidence/production-restore-guard-acceptance-231d8e8-20260720.json)。该证据固定记录 `productionRestoreEntrypointExecuted=false`、`approvalIndependentlyVerified=false` 和 `productionBackupRestoreGateClosed=false`，不能替代经审批的目标环境 `restore.sh`、物理异介质、原始 `0600` 报告或业务 RPO/RTO。

退出码定义：

- `0`：清单有效；若使用 `--require-ready`，同时表示全部门禁通过。
- `1`：文件、JSON、Schema 或跨字段约束无效。
- `2`：清单有效，但 `--require-ready` 发现至少一个阻断门禁。

`delivery:v1:validate` 只证明清单内部一致，不能证明外部证据真实。`delivery:v1:verify-platform` 会通过临时只读令牌查询 GitHub run 与 GHCR digest，不修改 tag、制品或仓库；它仍不能替代目标环境、专业意见和批准记录的人工真实性复核。真正发布必须通过 `delivery:v1:require-ready`、平台实证和人工抽查。

## 3. 失败关闭规则

- 必须且只能出现全部 14 个门禁；缺失、重复或增加未定义门禁均失败。
- `overallStatus` 必须由逐项状态计算：只有 14 项全部 `passed` 才能写 `ready`。
- 已通过门禁不得保留 blocker，且其全部证据必须为 `success`；阻断门禁必须说明至少一个具体 blocker。
- 两个本地门禁必须各有至少一条绑定 `implementationCommit` 的成功机器证据。
- GitHub 门禁必须有两个不同的绿色 run，分别覆盖 CI 与 Security，并绑定同一 `evidenceCommit`。
- GHCR 门禁必须有绑定 `evidenceCommit` 的绿色 `release` workflow，并分别有 `api`、`postgres`、`minio`、`worker`、`web`、`gateway`、`backup` 七个不同的成功 registry 制品引用。本地 image ID 不能代替 registry digest。
- 目标内网、真机 PWA、生产恢复、真实适配器、专业复核、教育发布、运营演练、残余风险、阻断缺陷和业务发布门禁必须保留可识别批准人、角色、时间和批准引用；批准元数据必须与成功 approval 证据引用一致。
- `restore.sh` 的操作者、理由和批准引用只是输入断言，主机报告中的 `approvalIndependentlyVerified` 必须保持 `false`；只有独立渠道复核原始审批、报告哈希、目标环境和介质/RPO/RTO 后才能更新生产恢复门禁。
- `pending`、`todo`、`tbd` 等孤立占位值不能作为证据引用；阻断状态可以引用真实存在的待办、审批或受控登记编号，但不能把它改写成成功。
- 银行、税务、发票红冲、正式签章、人事处分、关键权限和对外法律承诺继续由业务工作流的人工批准控制；本发布清单不执行任何外部动作。

## 4. 十四项门禁

| 门禁 | 最低通过证据 | 是否必须人工批准 |
| --- | --- | --- |
| `local_core_acceptance` | 绑定实现提交的完整本地机器验收 | 否 |
| `local_security_and_sensitive_data` | 绑定实现提交的密钥、依赖、SAST、镜像和敏感数据机器复核 | 否 |
| `github_ci_security` | 两个绑定证据提交的独立绿色 CI/Security run | 否 |
| `ghcr_release_artifacts` | 绿色 release run 及七个绑定证据提交的 GHCR digest、SBOM/provenance 记录 | 否 |
| `target_intranet_deployment` | 耀光广州目标内网的部署、网络、身份、健康和运行观察 | 是 |
| `managed_device_pwa` | 真实受管手机安装、升级、离线与缓存清理 | 是 |
| `production_backup_restore` | 生产范围备份、异介质隔离恢复及 RPO/RTO | 是 |
| `real_llm_github_adapters` | 真实最小权限适配器、隐私、质量、成本和停用 | 是 |
| `compliance_professional_review` | 适用范围内的真实专业复核记录 | 是 |
| `education_content_clearance` | 逐篇专业/事实/权利复核及真实发布登记 | 是 |
| `operational_responsibility_drills` | 真实责任人的审批、异常和补偿控制演练 | 是 |
| `residual_risk_decisions` | 每项残余风险的整改或书面接受决定 | 是 |
| `known_blocking_defects_closed` | 阻断缺陷清零或经批准判定不阻断 | 是 |
| `business_release_approval` | 全部上游门禁关闭后的最终公司负责人批准 | 是 |

## 5. 候选更新流程

1. 冻结实现提交，记录完整小写 40 位 `implementationCommit`；任何功能、迁移、运行时依赖或镜像输入变化都产生新候选。
2. 在精确提交上完成适当范围的本地测试和安全复核，保存脱敏机器证据、SHA-256、执行时间和范围边界。
3. 冻结用于 GitHub/GHCR 验证的 `evidenceCommit`。CI、Security、release run 和七个 registry 制品必须精确绑定该提交，不能混用历史绿色结果。
4. 逐项更新证据和 blocker。没有真实执行、凭据、设备、目标环境或专业人员时保持 `blocked`，不得预填成功。
5. 由真实责任人通过公司批准渠道形成批准记录，再将同一记录编号写入 `approval` 元数据和成功的 approval 证据。系统或开发者不能替代法务、财税、运维、风险或公司负责人签署。
6. 运行 `pnpm check`、`pnpm delivery:v1:status` 和人工证据抽查。准备最终证明时必须再运行 `pnpm delivery:v1:require-ready` 与 `pnpm delivery:v1:verify-platform`。
7. 机器清单随候选证据提交；后续任何源码漂移都要重新评估受影响门禁。若只提交证据文档，应明确它不改变被验证的实现或制品身份。

## 6. 候选制品与最终证明顺序

`release.yml` 和 `v1-readiness.yml` 具有不同职责，不能合并为一个前置门禁：

1. 实现与证据提交先进入 `main`，CI 与 Security 实际绿色。
2. 对不可变 Git tag 运行 `release.yml`。该 workflow 构建、扫描并发布七类候选 digest、SBOM/provenance 和清单；这些 tag 仍不是生产批准。
3. 使用 release run、七类真实 registry digest、目标内网、真机、恢复、真实适配器、专业复核和批准记录更新机器清单。全部成功后才能写 `ready`。
4. 将 ready 清单提交到 `main`，并确认 `implementationCommit → evidenceCommit → manifest_commit` 均为可达祖先关系；最终清单的 `candidate.branch` 必须是 `main`。
5. 仓库管理员在 GitHub Settings → Environments 建立 `v1-production-approval`，限制为 `main`，配置真实 required reviewers，并复核令牌只有 `actions:read`、`packages:read` 和 `contents:read`。仅在 YAML 中出现 environment 名称不能证明这些设置已配置。
6. 人工触发 “Attest final V1 readiness”，输入包含 ready 清单的完整 40 位 commit。workflow 在 environment 批准后再次失败关闭 Schema，实时读取 CI/Security/release run，HEAD 核对七类 GHCR digest，并上传 manifest、平台核验 JSON 和 SHA-256。

最终证明 job 是只读的：它不创建或覆盖 GHCR tag，不部署主机，不执行恢复，也不进行银行、税务、发票、签章、人事、权限或法律动作。workflow 绿色、证明 artifact 可下载、environment 设置和所有原始批准均可核对时，才可把它作为最终 V1 门禁的一项外部证据。

## 7. 当前阻断边界

当前只有本地核心验收和本地安全/敏感数据两项通过。候选 `231d8e82164f8e31b1cc978975bf56e7ac6a26bb` 在 `ffe102e…` 受管真机证据入口基础上增加了生产恢复防护和 exact-SHA 签名隔离恢复，但没有物理设备、MDM 原始记录、真实生产恢复或独立批准，不能增加通过门禁。GitHub runner 受账户付款或额度限制，GHCR、目标办公内网、真实受管手机、生产范围恢复、真实 LLM/GitHub 适配器、73 条专业复核、十二篇教育内容权利/发布复核、真实责任人演练、残余风险决定、缺陷关闭确认和最终业务批准均未完成。清单如实保留这些状态；修复一个外部条件后，只更新有新证据覆盖的对应门禁。
