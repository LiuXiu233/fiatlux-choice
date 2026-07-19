# 部署验证清单

## 自动门禁

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
./scripts/test-database-privileges.sh
DB_PRIVILEGE_TEST_SIMULATE_LEGACY=1 ./scripts/test-database-privileges.sh
./scripts/test-release-image-verification.sh
./scripts/test-release-transition-security.sh
./scripts/test-maintenance-lock-security.sh
./scripts/test-backup-container-security.sh
./scripts/test-restored-object-verification.sh
pnpm test:e2e
pnpm build
```

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

独立权限脚本在随机新卷上执行正向/负向测试：runtime 业务 DML/audit append/pg-boss 可用；DDL、建库、建角色、SET ROLE、replica bypass、禁用触发器和审计修改失败；backup 可 pg_dump 但不可写；restore 可在维护边界建库并 SET ROLE migrator、但不可建角色。第二次命令先模拟旧单超级用户拥有所有业务/pg-boss 对象，再验证所有权完整转移。

## 灾备

```sh
./scripts/backup.sh --require-encryption
# 审批并把对应清单安装到 BACKUP_APPROVED_MANIFEST_DIR 后：
./scripts/restore-latest-drill.sh
./scripts/upgrade.sh --to vNEXT
./scripts/rollback.sh --to vPREVIOUS
```

最后两条默认 dry-run。第一版交付报告必须记录实际执行命令、退出码、时间、环境、失败修复与证据路径；不能用“配置看起来正确”替代实际验证。
