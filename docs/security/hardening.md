# 安全加固基线

## 身份、权限与审批

- 服务端强制 RBAC 和公司作用域，前端隐藏按钮不算授权控制。
- 新权限默认拒绝；关键权限修改必须由另一名有权人员批准并记录前后差异。
- 银行付款、税务申报、发票红冲、正式签署、人事处分、关键权限和对外法律承诺保持人工批准。
- session cookie 使用 `Secure`、`HttpOnly`、`SameSite=Lax/Strict`；登录与高风险接口限流。
- 首次管理员密码首次登录即更换；离职、设备丢失和疑似泄漏时立即撤销所有会话与 token。

## 主机与容器

- 生产主机只运行审核过的固定版本；Docker socket 不挂入应用容器。
- 自有 api、worker、web、gateway 镜像以非 root 用户运行，根文件系统只读，drop all capabilities，并启用 `no-new-privileges`。
- PostgreSQL 官方入口初始化卷需要最小的 `CHOWN`、`DAC_OVERRIDE`、`FOWNER`、`SETGID`、`SETUID`；这组例外只用于数据库容器，不扩展到应用。
- 只有 Caddy 发布端口。禁止临时把 PostgreSQL 5432、MinIO 9000/9001 或 API 3000 映射到生产宿主机。
- Compose 日志轮转不能替代集中审计备份；审计事件按批准的档案策略保留。

## TLS 与浏览器

- 内网也必须使用 TLS，受管设备信任公司批准的 Caddy 内部 CA。
- 生产头包含 HSTS、nosniff、frame deny、权限策略和 CSP。新增第三方脚本/字体/分析服务前先做隐私和 CSP 评审。
- CORS 只允许精确 `APP_ORIGIN`，不能在携带凭据时使用 `*`。
- API 与敏感页面响应 `Cache-Control: no-store`；service worker 只缓存版本化静态资源和非敏感离线壳。

## 数据与文件

- PostgreSQL 和 MinIO 使用独立随机密钥；MinIO 桶保持 anonymous none。
- 文件对象键不使用原始文件名作为路径；限制大小、扩展名和 MIME，下载使用安全的 Content-Disposition。
- 个人信息按业务必要性收集，查询、导出、下载和删除均审计；日志与 AI 输入先最小化/脱敏。
- 生产备份必须 age 加密并异机保存，私钥独立托管；每月实际恢复。

## LLM 与外部适配器

- 顾问只能获得调用者权限范围内的检索结果，不允许模型自行扩大查询范围。
- 系统提示、工具 schema 和知识库版本均记录；事实、推断、建议、来源、风险、缺失信息和置信度分栏。
- 工具调用使用明确 allowlist、超时、重试上限和幂等键；外部内容一律标为不可信数据。
- 无合法稳定接口时使用 manual/mock，结果状态必须是“待人工处理”或“模拟”，不能是“已付款/已申报/已签署”。
- LLM/GitHub token 最小权限、可轮换，不能写入数据库明文字段、日志、Git 或浏览器存储。

## CI 与发布

- `pnpm-lock.yaml` 必须提交，CI 使用 `--frozen-lockfile`。
- PR 必须通过格式、类型、单元、集成、E2E、迁移和生产构建。
- Gitleaks、依赖审计和实际运行的 CodeQL 发现阻断项时必须阻断发布。私有仓库因 GitHub entitlement 不具备 CodeQL 能力时只能明确记录为“未运行”，不能记为通过；生产发布前须启用该能力或由安全负责人批准等效 SAST 方案并留存结果。
- Trivy 对最终发布的六个镜像运行 `ignore-unfixed=false` 严格扫描，保存包含无公开修复版本项的完整 JSON 报告。自动闸门至少阻断所有 HIGH/CRITICAL 且 `FixedVersion` 非空的发现；PR 文件系统 SARIF 扫描不能替代这份完整发布报告，也不得通过忽略未修复项制造“零高危”结论。
- 没有公开修复版本的 HIGH/CRITICAL 必须逐项记录受影响资产、适用性、补偿控制、责任人、复核期限和退出条件，并在生产发布前完成修复、迁移到受支持实现，或由有权负责人正式限期接受风险。风险接受到期、适用性变化或修复版本发布时必须重新打开处置。
- 当前公开 MinIO OSS 候选镜像仍有 6 个无公开修复版本的 HIGH/CRITICAL。仅 internal network、不发布宿主端口、不启用 OIDC/LDAP/S3 Select，以及不透传用户 S3 请求头属于补偿控制，不是修复；完成迁移、取得供应商修复版或形成符合上一条要求的正式风险接受之前，不得将其批准用于目标生产。
- 发布镜像使用不可变版本与 digest，生成 SPDX SBOM 和来源证明。禁止生产使用 `latest`。
- GitHub Actions 第三方 action 固定到审核过的完整 commit SHA，并保留版本注释，由 Dependabot 提交升级。

## 密钥轮换

| 密钥 | 建议周期 | 立即轮换触发 |
| --- | --- | --- |
| SESSION_SECRET | 90–180 天 | 会话疑似泄漏、管理员设备失陷 |
| PostgreSQL/MinIO | 至少每年 | 配置或主机泄漏、运维离职 |
| LLM/GitHub token | 90 天或供应商更短要求 | 权限扩大、日志泄漏、人员变更 |
| age 身份 | 按离线托管制度 | 私钥副本丢失或未授权访问 |
| Caddy 内部 CA | 到期前计划轮换 | 根私钥疑似泄漏 |

轮换前确认依赖方和恢复链路；轮换后撤销旧密钥并实际验证。仅修改环境文件但未重建容器，不算完成轮换。
