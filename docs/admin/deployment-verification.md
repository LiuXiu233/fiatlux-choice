# 部署验证清单

## 自动门禁

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
MIGRATION_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/fiatlux_choice_migration_test \
  MIGRATION_TEST_RESET=RESET_DEDICATED_MIGRATION_TEST_DATABASE \
  pnpm test:database-migrations
./scripts/test-database-privileges.sh
DB_PRIVILEGE_TEST_SIMULATE_LEGACY=1 ./scripts/test-database-privileges.sh
./scripts/test-release-image-verification.sh
pnpm test:target-intranet-verification
./scripts/test-release-transition-security.sh
./scripts/test-maintenance-lock-security.sh
./scripts/test-backup-container-security.sh
./scripts/test-restored-object-verification.sh
pnpm test:e2e
pnpm build
```

迁移验收会删除并重建目标数据库的 `public`/`drizzle` schema，只能指向 loopback 且名称以 `_migration_test` 结尾的专用数据库；它先验证上一迁移升级时业务数据不变且不发明专业复核 provenance，再从空库验证当前全部迁移。不得把生产或开发常用数据库传入该命令。

生产 Compose 与镜像：

```sh
FIATLUX_ENV=production \
FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env \
./scripts/compose.sh config --quiet

docker buildx build --platform linux/amd64,linux/arm64 \
  --file Dockerfile.api --tag fiatlux-choice-api:verify .
```

其余镜像由 CI matrix 构建。多架构构建、SBOM 和 Trivy 必须使用同一 Git SHA；发布清单四列必须把七个 digest 绑定到该 SHA，部署前还必须通过 clean checkout 校验。

## 核心端到端验收

- 管理员登录、会话过期、退出和失败限流。
- 普通成员无法查看或修改无权限公司数据；拒绝事件进入审计。
- 目标 -> 项目 -> 任务 -> 决策 -> 审批 -> 审计可完整完成。
- 合同、义务、合规日历、风险、财务、发票和现金流可创建、检索和关联。
- 合规专业复核必须绑定当前来源版本、实名/机构/胜任依据/缺失信息和已上传证据；桌面/移动均能查看追加历史，普通编辑不能伪造 reviewed 或确定生命周期，当前与历史证据归档失败。
- 银行付款、税务申报、红冲、正式签署、人事处分、关键权限和对外承诺均停留在人工批准边界。
- 模拟适配器明确显示模拟/待人工处理，不返回伪造外部成功。
- 七类 AI 顾问只读取权限范围内数据，输出事实/推断/建议、依据、风险、缺失信息和置信度；调用、提示版本、工具与人工修改均可追溯。
- 文件上传限制大小与类型，下载执行权限检查，对象桶保持私有。

## 浏览器与 PWA

- 桌面 Chromium、移动端窄视口均无横向溢出、遮挡或不可操作控件。
- PWA manifest、图标、service worker、安装与更新流程有效。
- service worker 不缓存 `/api`、鉴权响应、公司数据页面或敏感错误内容。
- 断网只显示受控离线壳，不展示陈旧敏感数据为当前事实。

## 运行时安全

```sh
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
docker compose ls
docker system df
```

`verify-deployment.sh` 要求 PostgreSQL、MinIO、API、worker、Web 和 Caddy 六个常驻服务都存在 Docker healthcheck 且实际为 `healthy`，并检查应用容器非 root、只读根文件系统、`no-new-privileges`、API/worker 不持有一次性 seed/bootstrap/migration/backup/restore 变量，以及除 Caddy 外无宿主端口。API 容器健康检查使用 bounded ready，同时覆盖 PostgreSQL、pg-boss 与 MinIO；worker 只有在全部七类订阅经封装注册、pg-boss 自身连接能读到全部声明队列且常驻 Drizzle 客户端能查询数据库时才刷新心跳。Caddy 健康检查覆盖代理后的 API live 与 Web 登录壳，而脚本另以外部硬超时请求代理后的 ready；Docker 的 `unhealthy` 状态本身不等于自动恢复。脚本还从实际常驻容器确认 API/worker 都连接为 `fiatlux_runtime`，并查询该角色不是 SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS、无 public schema CREATE、无 audit UPDATE/DELETE，审计触发器为 ENABLE ALWAYS 且所有者是 migrator。检查不输出连接串或口令。

### 目标办公内网机器证明

在耀光广州目标主机已经使用不可变发布清单部署、受控 CA 已安装且当前源码目录为待验收提交的干净 checkout 后，由目标环境运维负责人运行：

```sh
export RELEASE_VERSION=v1.0.0-rc.1
export RELEASE_GIT_SHA=<40位已批准发布提交>
export RELEASE_MANIFEST=/srv/fiatlux-choice/release-manifest.tsv
export RELEASE_MANIFEST_SHA256=<64位已批准清单SHA-256>
export APP_DOMAIN=choice.internal.example
export CADDY_ROOT_CA_FILE=/etc/fiatlux-choice/caddy-root.crt

FIATLUX_ENV=production \
FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env \
./scripts/verify-target-intranet.sh \
  --version "$RELEASE_VERSION" \
  --expected-git-sha "$RELEASE_GIT_SHA" \
  --release-manifest "$RELEASE_MANIFEST" \
  --manifest-sha256 "$RELEASE_MANIFEST_SHA256" \
  --url "https://$APP_DOMAIN:8443" \
  --ca "$CADDY_ROOT_CA_FILE" \
  --report-dir /var/lib/fiatlux-choice/deployment-reports \
  --environment-id fiatlux-guangzhou-office-prod \
  --operator-identity <受控运维身份> \
  --approval-reference <真实变更审批编号>
```

包装器依次失败关闭地调用源码、七类发布镜像/实际运行容器和 HTTPS/最小权限三个只读 verifier；只有全部成功且 CA DER 指纹、Docker/Compose 版本可读取时，才原子生成目录 mode `0700`、文件 mode `0600` 的 JSON，并在终端打印报告路径及 SHA-256。输入清单哈希、完整 Git SHA、无路径 HTTPS URL、端口和 DNS label 都会先校验；既有同名报告不会覆盖，失败或中断不会留下可被误认的成功 JSON。

报告中的 `operatorIdentity`、`environmentId` 和 `assertedApprovalReference` 都是操作者提供的标识，其中 `approvalIndependentlyVerified` 固定为 `false`。报告只证明执行时的干净源码、清单绑定、七镜像运行身份、六服务健康、运行时最小权限、目标 HTTPS 与 CA 指纹；**不证明**防火墙策略、真实受管手机/PWA、备份恢复、真实外部适配器、专业意见、审批真实性或最终业务批准。原始报告可能暴露内部主机名和人员/审批标识，应保存在受控证据库；进入 Git 仓库前必须脱敏并保留原件哈希与独立审批渠道引用，不能仅凭该 JSON 将 V1 目标内网门禁改为通过。

独立权限脚本在随机新卷上执行正向/负向测试：runtime 业务 DML、组织级业务引用链 advisory transaction lock、audit append 和 pg-boss 可用；DDL、建库、建角色、SET ROLE、replica bypass、禁用触发器和审计修改失败；backup 可 pg_dump 但不可写；restore 可在维护边界建库并 SET ROLE migrator、但不可建角色。第二次命令先模拟旧单超级用户拥有所有业务/pg-boss 对象，再验证所有权完整转移。

## 灾备

```sh
./scripts/backup.sh --require-encryption
# 审批并把对应清单安装到 BACKUP_APPROVED_MANIFEST_DIR 后：
./scripts/restore-latest-drill.sh
./scripts/upgrade.sh --to vNEXT
./scripts/rollback.sh --to vPREVIOUS
```

最后两条默认 dry-run。第一版交付报告必须记录实际执行命令、退出码、时间、环境、失败修复与证据路径；不能用“配置看起来正确”替代实际验证。

本地相邻版本演练还必须覆盖低频人工请求窗口：记录回滚后 API `StartedAt` 和 restartCount，在超过数据库 idle 阈值及批准的回归窗口后，经正式 Caddy HTTPS 登录并完成任务 create/read/update/archive/归档后 404；同时扫描常驻 API 日志中的 `CONNECT_TIMEOUT`/依赖错误并核对四个 runtime `application_name`。one-shot 数据库连接成功不能代替该业务验证。2026-07-19 的 synthetic bridge 已在 308 秒窗口通过，但目标内网和最终受审 N−1 仍需复演。
