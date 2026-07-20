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
| `packages/contracts/test/v1-release-readiness.test.ts` | 覆盖完整通过、真实阻断、缺失/重复门禁、证据失败、提交不匹配和人工批准缺失 |

## 2. 使用命令

~~~sh
# 只检查 JSON、Schema 和跨字段约束；已纳入 pnpm check
pnpm delivery:v1:validate

# 输出可供自动化读取的 JSON 状态
pnpm delivery:v1:status

# 发布前强制门禁；当前应以退出码 2 拒绝发布
pnpm delivery:v1:require-ready

# 校验其他候选清单
pnpm exec tsx scripts/verify-v1-release-readiness.ts --file /absolute/path/to/manifest.json --json
~~~

退出码定义：

- `0`：清单有效；若使用 `--require-ready`，同时表示全部门禁通过。
- `1`：文件、JSON、Schema 或跨字段约束无效。
- `2`：清单有效，但 `--require-ready` 发现至少一个阻断门禁。

`delivery:v1:validate` 只证明清单内部一致，不能证明外部证据真实。真正发布必须运行 `delivery:v1:require-ready`，并人工抽查所有外部引用。

## 3. 失败关闭规则

- 必须且只能出现全部 14 个门禁；缺失、重复或增加未定义门禁均失败。
- `overallStatus` 必须由逐项状态计算：只有 14 项全部 `passed` 才能写 `ready`。
- 已通过门禁不得保留 blocker，且其全部证据必须为 `success`；阻断门禁必须说明至少一个具体 blocker。
- 两个本地门禁必须各有至少一条绑定 `implementationCommit` 的成功机器证据。
- GitHub 门禁必须有两个不同的绿色 run，分别覆盖 CI 与 Security，并绑定同一 `evidenceCommit`。
- GHCR 门禁必须分别有 `api`、`postgres`、`minio`、`worker`、`web`、`gateway`、`backup` 七个不同的成功 registry 制品引用，并绑定同一 `evidenceCommit`。本地 image ID 不能代替 registry digest。
- 目标内网、真机 PWA、生产恢复、真实适配器、专业复核、教育发布、运营演练、残余风险、阻断缺陷和业务发布门禁必须保留可识别批准人、角色、时间和批准引用；批准元数据必须与成功 approval 证据引用一致。
- `pending`、`todo`、`tbd` 等孤立占位值不能作为证据引用；阻断状态可以引用真实存在的待办、审批或受控登记编号，但不能把它改写成成功。
- 银行、税务、发票红冲、正式签章、人事处分、关键权限和对外法律承诺继续由业务工作流的人工批准控制；本发布清单不执行任何外部动作。

## 4. 十四项门禁

| 门禁 | 最低通过证据 | 是否必须人工批准 |
| --- | --- | --- |
| `local_core_acceptance` | 绑定实现提交的完整本地机器验收 | 否 |
| `local_security_and_sensitive_data` | 绑定实现提交的密钥、依赖、SAST、镜像和敏感数据机器复核 | 否 |
| `github_ci_security` | 两个绑定证据提交的独立绿色 CI/Security run | 否 |
| `ghcr_release_artifacts` | 七个绑定证据提交的 GHCR 制品、digest、SBOM/provenance 记录 | 否 |
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
3. 冻结用于 GitHub/GHCR 验证的 `evidenceCommit`。GitHub run 和七个 registry 制品必须精确绑定该提交，不能混用历史绿色结果。
4. 逐项更新证据和 blocker。没有真实执行、凭据、设备、目标环境或专业人员时保持 `blocked`，不得预填成功。
5. 由真实责任人通过公司批准渠道形成批准记录，再将同一记录编号写入 `approval` 元数据和成功的 approval 证据。系统或开发者不能替代法务、财税、运维、风险或公司负责人签署。
6. 运行 `pnpm check`、`pnpm delivery:v1:status` 和人工证据抽查。准备发布时必须再运行 `pnpm delivery:v1:require-ready`。
7. 机器清单随候选证据提交；后续任何源码漂移都要重新评估受影响门禁。若只提交证据文档，应明确它不改变被验证的实现或制品身份。

## 6. 当前阻断边界

当前只有本地核心验收和本地安全/敏感数据两项通过。GitHub runner 受账户付款或额度限制，GHCR、目标办公内网、真实受管手机、生产范围恢复、真实 LLM/GitHub 适配器、73 条专业复核、十二篇教育内容权利/发布复核、真实责任人演练、残余风险决定、缺陷关闭确认和最终业务批准均未完成。清单如实保留这些状态；修复一个外部条件后，只更新有新证据覆盖的对应门禁。
