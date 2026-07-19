# 安全加固基线

## 身份、权限与审批

- 服务端强制 RBAC 和公司作用域，前端隐藏按钮不算授权控制。
- 新权限默认拒绝；关键权限修改优先由另一名有权人员批准并记录前后差异。只有一名实际操作者时仍须走申请与批准两个步骤，显式确认 `SELF_APPROVAL_ACKNOWLEDGED`、记录原因，并指定事后独立复核责任人。
- 银行付款、税务申报、发票红冲、合同正式签署、合同终止、人事处分、关键权限修改和对外法律承诺保持人工批准。
- session cookie 使用 `Secure`、`HttpOnly`、`SameSite=Lax/Strict`；登录与高风险接口限流。
- 首次管理员密码首次登录即更换；离职、设备丢失和疑似泄漏时立即撤销所有会话与 token。

## 主机与容器

- 生产主机只运行审核过的固定版本；Docker socket 不挂入应用容器。
- 自有 api、worker、web、gateway 镜像以非 root 用户运行，根文件系统只读，drop all capabilities，并启用 `no-new-privileges`。
- 自建 `Dockerfile.postgres` 继承官方基础镜像中已归 `postgres` 的数据目录，移除 `gosu` 后让 runtime 从入口即以 `postgres` 用户运行；fresh named volume 初始化已实际通过。Compose 与其余发布容器一致 `cap_drop: ALL`、只读根文件系统并启用 `no-new-privileges`，不保留官方 root entrypoint 的 `CHOWN`、`DAC_OVERRIDE`、`FOWNER`、`SETGID` 或 `SETUID` 例外。
- 只有 Caddy 发布端口。禁止临时把 PostgreSQL 5432、MinIO 9000/9001 或 API 3000 映射到生产宿主机。
- Compose 日志轮转不能替代集中审计备份；审计事件按批准的档案策略保留。

## TLS 与浏览器

- 内网也必须使用 TLS，受管设备信任公司批准的 Caddy 内部 CA。
- 生产头包含 HSTS、nosniff、frame deny、权限策略和 CSP。新增第三方脚本/字体/分析服务前先做隐私和 CSP 评审。
- CORS 只允许精确 `APP_ORIGIN`，不能在携带凭据时使用 `*`。
- API 与敏感页面响应 `Cache-Control: no-store`；service worker 只缓存版本化静态资源和非敏感离线壳。

## 数据与文件

- PostgreSQL 和 MinIO 使用独立随机密钥；MinIO 桶保持 anonymous none。
- PostgreSQL bootstrap、migration、runtime、backup、restore 使用五个独立口令。API/worker 只使用无 SUPERUSER/CREATEDB/CREATEROLE/DDL 的 runtime；业务和 pg-boss DDL 只在一次性 migrator 容器执行，restore 仅在人工批准的破坏性操作中使用。
- runtime 对 `audit_events` 只可 SELECT/INSERT；UPDATE/DELETE/TRUNCATE/触发器权限显式撤销，追加写触发器为 `ENABLE ALWAYS` 且归 migrator 所有。主机 root/bootstrap 仍能绕过，必须以异机备份与维护审计补偿。
- 文件对象键不使用原始文件名作为路径；元数据入口按扩展名—声明 MIME 对照表只允许 PDF、纯文本/CSV/Markdown/JSON、常见无脚本图片和非宏 OOXML 等公司文件，并拒绝规范化后的路径/点段/控制字符/保留名、危险双扩展、脚本/活动内容/宏或 ODF 格式和 generic octet-stream。Markdown/JSON 与其他格式一样只以 attachment 下载，不作为可信代码或页面解释。完成上传时再次核对对象大小与 SHA-256；下载使用 attachment Content-Disposition 和 `nosniff`。该声明型 allowlist 不验证真实文件 magic，也不替代反病毒或内容安全扫描。
- 个人信息按业务必要性收集；业务变更、权限拒绝和已授权文件流发放写入追加审计，文件事件 `download_issued` 只表示服务端已取得对象并开始发放，不证明客户端下载完成。普通列表/详情查询目前依赖最小化应用访问日志，产品尚无通用业务导出，因此不得宣称所有查询或导出均已有逐记录业务审计。日志与 AI 输入先最小化/脱敏。
- 生产备份必须 age 加密并异机保存，私钥独立托管；age 不认证创建者，恢复还必须匹配独立受审的归档 SHA-256。归档守卫只提取目录/普通文件并限制成员数与展开总量；每月实际恢复。

## LLM 与外部适配器

- 顾问只能获得调用者权限范围内的检索结果，不允许模型自行扩大查询范围。
- 系统提示、工具 schema 和知识库版本均记录；事实、推断、建议、来源、风险、缺失信息和置信度分栏。
- 工具调用使用明确 allowlist、超时、重试上限和幂等键；外部内容一律标为不可信数据。
- 真实 compatible LLM 只接受经批准的 HTTPS `LLM_BASE_URL`，所有环境均拒绝 HTTP，且携带 token 与公司上下文的请求不得跟随重定向。
- 无合法稳定接口时使用 manual/mock，结果状态必须是“待人工处理”或“模拟”，不能是“已付款/已申报/已签署”。
- LLM/GitHub token 最小权限、可轮换，不能写入数据库明文字段、日志、Git 或浏览器存储。

## CI 与发布

- `pnpm-lock.yaml` 必须提交，CI 使用 `--frozen-lockfile`。
- PR 必须通过格式、类型、单元、集成、E2E、迁移和生产构建。
- Gitleaks、依赖审计、Semgrep SAST 和实际运行的 CodeQL 发现阻断项时必须阻断发布。仓库内版本化 Semgrep OSS 规则覆盖 TypeScript/Node.js 的高信号注入、命令与动态执行、SSRF、不安全 TLS、弱密码学、硬编码秘密和敏感日志；CI 固定 CLI 镜像版本与 digest，负向 canary 证明规则触发，正常源码 finding 失败，并保存 JSON/SARIF 普通 artifact。故意脆弱的 `security/semgrep/canary/**` 只由隔离 canary gate 扫描，并通过版本化 CodeQL config 从正式 CodeQL 分析排除；其他源码和测试不因此排除。私有仓库因 GitHub entitlement 不具备 CodeQL 能力时只能明确记录为“未运行”，不能记为通过；Semgrep 尚未获得安全负责人书面批准为等效 SAST，因此不能称为 CodeQL 已通过，生产发布前仍须启用 CodeQL 能力或完成等效性批准并留存结果。
- Trivy 对最终发布的七个镜像运行 `ignore-unfixed=false` 严格扫描，保存包含无公开修复版本项的完整 JSON 报告。自动闸门阻断所有 HIGH/CRITICAL 且 `FixedVersion` 非空的发现；闸门通过只证明可修复项为零，不证明总数为零。无修复项仍须在完整报告中逐项人工判断；PR 文件系统 SARIF 扫描不能替代这份完整发布报告，也不得通过忽略未修复项制造“零高危”结论。
- 没有公开修复版本的 HIGH/CRITICAL 必须逐项记录受影响资产、适用性、补偿控制、责任人、复核期限和退出条件，并在生产发布前完成修复、迁移到受支持实现，或由有权负责人正式限期接受风险。风险接受到期、适用性变化或修复版本发布时必须重新打开处置。
- 此前 MinIO OSS 候选镜像的 6 个 HIGH/CRITICAL 是旧镜像历史计数；冻结候选重建后的本地 arm64 完整报告为 HIGH/CRITICAL/fixable/unfixed 全部 0，旧数不得继续写成当前发现。最终 GHCR 双平台镜像仍要按上一条独立扫描。即使扫描为 0，MinIO OSS 的长期维护/支持和退出路径仍需生产决策；internal network、不发布宿主端口、最小权限和不透传用户 S3 请求头是补偿控制，不是供应商支持承诺。
- 发布镜像使用不可变版本与 digest，生成 SPDX SBOM 和 BuildKit 来源证明。MinIO/mc 源码按完整 Git commit 和 codeload tarball SHA-256 固定并在构建前校验，不按 mutable tag clone。部署端必须以独立受审的发布清单 SHA-256 为入口，在拉取后和启动后逐一核对七个本地 RepoDigest，并在启动后核对 api/worker/web/gateway/minio/postgres 六个常驻容器的实际 image ID；backup 保持按需。升级和回滚一致切换 PostgreSQL、MinIO 与应用后才写全局版本状态，禁止留下下一次启动才切换的混合版本。禁止生产使用 `latest`。
- BuildKit provenance、SBOM 和同 artifact 的 `.sha256` 都不是发布者数字签名。当前没有 cosign/Sigstore/企业签名服务；独立人工批准清单是补偿控制，无法取得时不得升级或回滚。
- GitHub Actions 第三方 action 固定到审核过的完整 commit SHA，并保留版本注释，由 Dependabot 提交升级。

### CI 构建工具链固定记录

解析时间：`2026-07-19T01:37:50Z`。下表的 digest 是 registry 多架构 index digest，不是某个单一 runner 架构的 manifest digest。更新任一项时必须重新核对官方版本、registry digest、amd64/arm64 清单、真实构建来源证明 fixture 和三个工作流引用；不得只改 tag。

| 组件 | 固定引用 | 解析与版本来源 |
| --- | --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12` | [Docker Hub 官方 tag API](https://hub.docker.com/v2/repositories/docker/dockerfile/tags/1.25.0)；七个 Dockerfile 首行完全一致，静态正/负向测试拒绝无 digest 或 mutable tag |
| Node bases | `node:24.12.0-alpine3.23@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8`（API/worker build 与 runtime）；`node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99`（仅 Web build stage，不进入最终 Web 镜像） | [Alpine tag API](https://hub.docker.com/v2/repositories/library/node/tags/24.12.0-alpine3.23) 与 [Bookworm tag API](https://hub.docker.com/v2/repositories/library/node/tags/24.12.0-bookworm-slim)；解析时 tag/index digest 精确匹配。API/worker build stage 固定 `BUILDPLATFORM`，避免在多架构构建中用 QEMU 执行 Node/pnpm；runtime 仍跟随 target platform，静态负例拒绝把 runtime 固定到构建平台。当前唯一生产 native addon `argon2@0.41.1` 同包携带 amd64/arm64 musl N-API prebuild，但每个平台仍必须实际运行 hash/verify 或相应 worker 工具回归，不能只凭文件存在放行 |
| Go base | `golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2` | [Docker Hub 官方 tag API](https://hub.docker.com/v2/repositories/library/golang/tags/1.26.5-alpine)；解析时 tag/index digest 精确匹配 |
| Alpine runtime base | `alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40` | [Docker Hub 官方 tag API](https://hub.docker.com/v2/repositories/library/alpine/tags/3.23)；解析时 tag/index digest 精确匹配 |
| PostgreSQL base | `17.10-alpine3.23@sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4` | [Alpine 3.23 tag API](https://hub.docker.com/v2/repositories/library/postgres/tags/17.10-alpine3.23)；解析时 tag/index digest 精确匹配。`Dockerfile.postgres` 由该基线生成独立发布组件，执行安全更新、移除 root-only `gosu` 并固定 `USER postgres`；backup 仍独立构建且按需。Worker 在 Alpine runtime 内安装同 major 的 `postgresql17-client`，实际解析版本必须进入最终 SBOM，并通过真实数据库备份测试 |
| Docker Buildx | `v0.35.0` | [Docker Buildx v0.35.0 官方 release](https://github.com/docker/buildx/releases/tag/v0.35.0)；`setup-buildx-action` 显式 `version`，运行时再断言实际 CLI 版本 |
| BuildKit | `docker.io/moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec` | [Docker Hub 官方 tag API](https://hub.docker.com/v2/repositories/moby/buildkit/tags/v0.31.2)；运行时断言实际 daemon `v0.31.2`、builder 容器原始 image reference 及要求的平台 |
| QEMU/binfmt | `docker.io/tonistiigi/binfmt:qemu-v10.2.3@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0` | [Docker Hub 官方 tag API](https://hub.docker.com/v2/repositories/tonistiigi/binfmt/tags/qemu-v10.2.3)；只注册发布需要的 `arm64`，并核对 action 实际平台输出与 BuildKit `linux/arm64` 能力 |
| Trivy | `v0.70.0` | [Trivy v0.70.0 官方 release](https://github.com/aquasecurity/trivy/releases/tag/v0.70.0)；固定 action commit 的同时在 release/security workflow 显式固定扫描器版本 |
| Syft | `v1.42.3`，Linux amd64 archive `sha256:0d6be741479eddd2c8644a288990c04f3df0d609bbc1599a005532a9dff63509` | [Syft v1.42.3 官方 release](https://github.com/anchore/syft/releases/tag/v1.42.3) 与该 release 的官方 checksums；checksums 文件本身再固定为 `sha256:3c4a66ddb6e0689fac2be19247064f6053e2a2746035dfbcef8609baa9088f92`，不执行 mutable `main/install.sh` |

`ci.yml` 的原生镜像作业和多架构镜像矩阵、`release.yml` 的验证、构建扫描与 promotion 均使用同一固定 Buildx/BuildKit；多架构作业还使用同一固定 QEMU。`security.yml` 不创建 BuildKit/QEMU builder，不能把其文件系统扫描结果冒充镜像构建验证。`scripts/verify-build-toolchain.sh` 对实际 CLI、daemon、容器引用和平台失败关闭。

同次解析还以各官方 GitHub repository 的 tag ref/peeled ref 核对工作流出现的 12 组第三方 action：checkout、pnpm setup、Node setup、Buildx setup、build/push、artifact upload/download、Gitleaks、Trivy、CodeQL、QEMU setup、registry login；完整 40 位 commit 均与文件中的版本注释精确一致。该一次性结果不能替代后续 Dependabot 更新时的重新审核。

发布来源证明固定为 `mode=max,version=v0.2`。真实 BuildKit v0.31.2 输出的 statement `_type` 必须精确为 `https://in-toto.io/Statement/v1`，`predicateType` 必须精确为 `https://slsa.dev/provenance/v0.2`；不得接受旧 `Statement/v0.1` 或其他 schema。该参数与 schema 的权威定义见 [Docker provenance attestations](https://docs.docker.com/build/metadata/attestations/slsa-provenance/)，attestation manifest 与 in-toto blob 的层级见 [Docker image attestation storage](https://docs.docker.com/build/metadata/attestations/attestation-storage/)。发布校验必须读取实际 in-toto layer，逐层核对 digest/size、`subject[].digest.sha256`、`predicateType` 与 `predicate.metadata["https://mobyproject.org/buildkit@v1#metadata"].vcs.revision`，不能把 blob 内的 `subject` 误当作 manifest 字段。

每个发布组件必须对同一多架构 root digest 显式生成 `linux/amd64` 与 `linux/arm64` 两份 SPDX JSON。SPDX 原文只校验 document、非空 packages 与精确 Syft creator 版本；若 SPDX 本身未稳定表达 index root digest 或平台，不得修改或伪造 SPDX 字段。严格 sidecar TSV 负责把组件、平台、root digest、发布 Git SHA、文件名、实际 SPDX SHA-256 与 Syft 版本绑定，随后再次读取两份文件重算摘要并上传两份 SPDX、TSV 与 TSV SHA-256；这仍是完整性证据，不是数字签名。

## 密钥轮换

| 密钥 | 建议周期 | 立即轮换触发 |
| --- | --- | --- |
| SESSION_SECRET | 90–180 天 | 会话疑似泄漏、管理员设备失陷 |
| PostgreSQL/MinIO | 至少每年 | 配置或主机泄漏、运维离职 |
| LLM/GitHub token | 90 天或供应商更短要求 | 权限扩大、日志泄漏、人员变更 |
| age 身份 | 按离线托管制度 | 私钥副本丢失或未授权访问 |
| Caddy 内部 CA | 到期前计划轮换 | 根私钥疑似泄漏 |

轮换前确认依赖方和恢复链路；轮换后撤销旧密钥并实际验证。仅修改环境文件但未重建容器，不算完成轮换。MinIO 优先固定 access ID 轮换 secret；若更换 ID，bootstrap 不会自动撤销旧用户，必须按运维手册以 root-only 一次性操作显式禁用/删除，并用旧凭据做失败验证。
