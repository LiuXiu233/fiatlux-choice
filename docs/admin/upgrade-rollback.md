# 升级与回滚

## 发布物

每个发布版本必须对应：Git tag、Git SHA、七个不可变镜像（api、worker、web、gateway、minio、backup、postgres）、严格四列 `version/git_sha/component/digest` 的 `release-manifest.tsv`、清单 SHA-256、SPDX SBOM、构建来源证明、迁移清单和测试报告。七行组件必须绑定同一完整 Git SHA；禁止使用 `latest`。backup 仍是按需工具镜像，其余六个组件是常驻服务。

Git tag、GHCR semver tag、绿色 release workflow 和完整清单只表示形成了**不可变候选制品**，不等于获准部署生产。仓库当前没有可由代码证明的 GitHub production environment 审批；部署前仍须完成本章的 CI、安全、未修复漏洞处置、恢复演练、目标环境和真实责任人批准，并由部署操作人通过独立渠道取得受审 Git SHA 与清单 SHA-256。不得把候选 tag 的存在写成“已上线”或“已批准生产”。

2026-07-19 的本地验证使用 N 10 migrations 与 synthetic bridge 9 migrations、七个内容全异镜像和本机固定 digest registry，完成真实 push/pull、46 秒升级、43 秒应用回滚、双 formatVersion 2 恢复点及回滚后 308 秒 HTTPS CRUD。首轮曾因 idle 后 `CONNECT_TIMEOUT` 正确 BLOCKED，修复后同一 API 进程复验通过。该结果证明脚本和连接修复的本地兼容性，不是历史生产 N−1、GHCR、目标办公内网或批准记录；生产仍须用最终受审制品和真实回滚目标重复本章门禁。

发布工作流的 BuildKit provenance 记录构建输入与过程，**不是发布者数字签名，也不是生产批准**。`release-manifest.tsv.sha256` 与清单位于同一 artifact，只用于传输完整性；审批人必须从受控的 GitHub 工作流/审批记录核对版本、完整 Git SHA、七个 digest 和清单 SHA-256，并把 Git SHA 与清单 SHA-256 通过独立渠道交给部署操作人。执行脚本要求本地 checkout 的 HEAD 精确等于受审 SHA，且 tracked 与非忽略 untracked 状态均为空，从而约束 Compose、升级/恢复脚本及 bind-mounted PostgreSQL/MinIO 策略；秘密和运行数据必须位于 `.gitignore` 覆盖的外部路径。当前未集成 cosign/Sigstore 或企业签名密钥；无法取得独立批准值时，升级和回滚失败关闭。

### 部分镜像 tag 失败处置

GHCR 不提供七个仓库 tag 的跨仓库原子提交。若 promotion 在创建任一组件 tag 后、完整清单成功上传前失败（无论只创建了部分 tag，还是七个 tag 已创建但 artifact 上传失败），该 semver 版本立即标记为**废弃且不可部署**：不得重跑覆盖既有 tag，不得从失败 run 下载或手工补造 `release-manifest.tsv`，也不得把已出现的 tag 纳入升级、回滚或恢复清单。发布工作流只在全部七个 tag 创建并逐一核对成功后上传 release manifest；失败 run 没有可批准的发布清单。

处置人记录 workflow run ID、Git SHA、已创建组件/tag/digest、失败原因和调查结论，然后使用新的 semver/RC 版本重新发布。默认保留废弃 tag 作为调查证据，并在发布记录中明确 `ABANDONED`。如公司要求清理，只能由具备 GitHub Packages 删除权限的授权管理员在双人复核后操作：先确认该 digest 没有其他 tag、发布清单、部署主机或恢复点引用，保存删除前清单与 API 回执，再删除对应 package version/tag 并验证远端返回 404。不得向常规 release workflow 增加删除权限，不得删除或重用原 Git tag，也不得在引用关系不明时删除共享 digest。

## 升级前检查

1. CI、Trivy、依赖审计和 secret scan 全部通过；CodeQL 必须实际运行通过。若私有仓库 entitlement 不可用，只能记录“未运行”，并在生产发布前补充经安全负责人批准的等效 SAST 结果。
2. 在全新数据库和上一版本快照上执行业务迁移、pg-boss 迁移和 `database-permissions`；运行 `test-database-privileges.sh` 的新卷与旧单角色两种模式。
3. 数据库变更遵循 expand/contract：先扩展 schema，等待所有旧进程不再依赖旧结构后，后续版本再收缩。
4. 最近一次 age+Ed25519 独立恢复演练通过；age identity、签名私钥、公钥及独立批准的公钥指纹可用，备份介质空间充足。
5. 确认维护窗口、审批人、操作人、回滚目标和沟通渠道。

常规升级、回滚和恢复只允许 PostgreSQL 同 major。major 变化必须使用单独设计、测试并批准的 `pg_upgrade` 或逻辑迁移方案，发布脚本没有绕过参数。升级也拒绝 minor 回退；回滚或恢复若确需切到较低 minor，必须先在副本上完成兼容性复核并取得外部人工批准，再显式传入 `--confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED`。该 token 只证明操作人作了显式确认，不证明审批已存在。

默认 dry-run 不修改系统：

```sh
./scripts/upgrade.sh --to v1.1.0
```

实际升级：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/upgrade.sh --to v1.1.0 \
  --release-manifest /srv/releases/v1.1.0/release-manifest.tsv \
  --manifest-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-git-sha 0123456789abcdef0123456789abcdef01234567 \
  --apply --confirm UPGRADE
```

脚本先验证清单、受审 Git SHA 与 clean 部署资产，再拉取七个目标镜像并逐一核对本地 `RepoDigest`。从这次核验到迁移、切换完成之间，所有 one-shot `run` 都显式使用 `--pull never`，所有 `up` 都显式使用 `--pull never --no-build`；不得再次解析远端可变 tag，也不得用本地工作树临时构建替代受审镜像。只有核验通过，才用目标版本 backup image 创建 formatVersion 2 加密恢复点。备份时暂停/恢复的是当前版本入口/API/worker，不会提前重建目标应用。随后脚本显式停止入口/API/worker，先重建并等待目标 PostgreSQL，再执行 Drizzle 业务迁移、pg-boss 迁移和 runtime 授权收敛，最后一致重建 MinIO、桶初始化以及 api/worker/web/gateway；启动后再次核对七个本地 digest，并核对这六个常驻容器的实际 image ID，再验证健康、实际数据库角色姿态和容器安全参数，最后才写入 `data/releases/current`、`previous`、`history.tsv` 与 `data/releases/manifests/` 的受审副本。backup 是按需容器，没有可长期核对的运行实例。任何中途失败都不能手工伪造版本状态，也不能通过给 runtime 临时 DDL 来放行。

上述升级/回滚恢复点在生产环境不仅强制 age 加密，也必须由 Ed25519 私钥签署 attestation；缺少签名私钥时，切换会在停止写入方之前失败。签名不替代发布清单核验、独立归档 SHA-256 或人工批准。

首次部署由 `production.env` 的 `APP_IMAGE_TAG` 决定；首次成功升级后，`data/releases/current` 成为 Compose 的本机版本状态并优先于环境文件，确保重启不会退回旧镜像。该状态文件必须与发布记录一起备份和审计，但不能在验证失败前提前修改。

## 一致版本回滚

默认 dry-run：

```sh
./scripts/rollback.sh
./scripts/rollback.sh --to v1.0.1
```

只有确认旧应用可读取当前 schema、目标 PostgreSQL binary 可安全读取当前同-major 数据目录，且目标 MinIO 可安全读取现有对象数据后才能执行：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/rollback.sh --to v1.0.1 \
  --release-manifest /srv/releases/v1.0.1/release-manifest.tsv \
  --manifest-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-git-sha fedcba9876543210fedcba9876543210fedcba98 \
  --apply --confirm RELEASE-ROLLBACK
```

回滚同样预检清单、目标 Git SHA 和 clean 部署资产并一致切换发布版本：先拉取和核对七个目标组件，再用当前/source backup image 创建 formatVersion 2 恢复点，最后显式停止入口/API/worker，并仅从已核验的本地镜像（`--pull never --no-build`）依次重建目标版本的 PostgreSQL、MinIO、桶初始化和四个应用容器；启动后再核对本地七组件 digest 和六个常驻容器的实际 image ID，最后才写全局 `current`。这避免了数据库、应用或 MinIO 延迟到下一次启动才切换的混合状态，也避免旧 target backup image 生成 source 版本无法可靠恢复的降格归档。该脚本不执行数据库 down migration。若旧应用、目标 PostgreSQL binary 或旧 MinIO 与当前数据不兼容，应停止本流程；恢复回滚前恢复点时使用受审 source 发布的工具链，恢复升级前恢复点时使用生成该 v2 归档的 target/source 兼容工具链。

## 升级后观察

至少观察一个完整 worker 周期：

```sh
./scripts/compose.sh ps
./scripts/compose.sh logs --since 30m api worker caddy
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
```

抽查登录、RBAC 拒绝、任务状态迁移、审批、文件下载、AI 顾问审计和通知。确认旧版本未继续运行，数据库与对象存储没有暴露宿主端口。
