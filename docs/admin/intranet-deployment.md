# FIAT LUX CHOICE 内网部署手册

## 1. 部署边界

本部署面向耀光（广州）电子竞技有限公司的受控办公内网。系统不是互联网公开服务；只有 Caddy 网关发布宿主端口，PostgreSQL、MinIO、API、worker 和 Web 静态服务均不直接发布端口。

生产拓扑：

```text
内网终端 -- HTTPS:8443 --> Caddy --> Web
                              |
                              +----> API ----> PostgreSQL
                                      |        (pg-boss 同库)
                                      +------> MinIO
                              worker --+------> LLM/GitHub 适配器
```

`backend` Docker 网络设置为 `internal: true`，只承载 PostgreSQL 和 MinIO；API 与 worker 同时加入 `edge`，因此可按适配器策略访问经批准的外部接口。数据库和对象存储不能从办公网直接访问。

## 2. 主机要求

- 建议 Linux 服务器：4 核 CPU、8 GB 内存、100 GB 以上 SSD，另配独立备份介质。
- 支持 `linux/amd64` 或 `linux/arm64`；发布工作流构建两种架构。
- Docker Engine 25 或更高版本，Docker Compose v2.24 或更高版本。
- 内网 DNS 名，例如 `choice.internal.example`，解析到服务器固定地址。
- 主机启用 NTP、磁盘加密、自动安全更新和仅管理员可用的 SSH。
- 防火墙仅允许受控办公网访问 `${HTTPS_PORT:-8443}`；SSH 仅允许管理网段。

部署前必须实际运行：

```sh
docker compose version
docker buildx version
docker info --format '{{.OSType}}/{{.Architecture}} {{.ServerVersion}}'
```

不要安装或回退到已停止维护的 Compose v1，也不要把未经校验的二进制放入仓库。

2026-07-20 不可变实现提交 `101d2f0…` 已在开发机用全新卷和 `compose.prod.yml` 完成 production-like 复验：38 张业务表、11 个迁移、pg-boss 24、六常驻服务健康与重启持久性、部署/MinIO 最小权限检查、桌面/390×844 移动仿真、PWA、七镜像扫描/SPDX 和一次 age+Ed25519 隔离恢复均通过；脱敏证据见[当前候选验收记录](../delivery/evidence/production-like-acceptance-101d2f0-20260720.json)。这只证明本机 Docker Desktop arm64、HTTPS 和依赖组合能够运行，不证明目标 Linux 主机、GHCR 多架构发布、广州办公内网 DNS/CA、防火墙、独立备份审批渠道或真实受管移动设备已经验证。

## 3. 目录和账户

Linux 主机建议使用专用账户：

```sh
sudo useradd --create-home --shell /bin/bash fiatlux
sudo usermod --append --groups docker fiatlux
sudo install -d -o fiatlux -g fiatlux -m 0750 /opt/fiatlux-choice
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/backups/fiatlux-choice
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/lib/fiatlux-choice/pre-restore-backups
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/lib/fiatlux-choice/restore-drill-reports
sudo install -d -o root -g root -m 0755 /var/lib/fiatlux-choice
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/lib/fiatlux-choice/backup-scratch
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/lib/fiatlux-choice/restore-scratch
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/lib/fiatlux-choice/maintenance
sudo install -d -o root -g fiatlux -m 0750 /etc/fiatlux-choice
sudo install -d -o root -g fiatlux -m 0750 /etc/fiatlux-choice/approved-backups
```

`BACKUP_DIR`/`RESTORE_SOURCE_DIR` 是可审计归档源；执行恢复时它会以只读方式挂载到 `backup-tools:/restore-source`。`RESTORE_PRE_BACKUP_DIR` 必须指向上面的独立可写目录，不能把恢复前备份写回只读 U 盘、审批介质或源归档目录。
`RESTORE_DRILL_REPORT_DIR` 同样必须是独立可写目录；定期恢复演练的日志和容器报告写入此目录，不写回只读归档源。
`BACKUP_APPROVED_MANIFEST_DIR` 及其父链必须保持 root 所有且不允许 group/other 写入；批准文件使用 `root:fiatlux 0640`。部署用户只能读取，不能拥有、改写、替换或通过可写父目录重定向该批准记录；批准目录也不能放在 `BACKUP_DIR` 子树中。备份签名公钥可以放在 `/etc/fiatlux-choice`，但批准的公钥 DER SHA-256 必须由 root 控制的生产配置或等价独立审批渠道提供，不能从可写备份目录自动推导。

Docker 组等价于主机 root 权限。只能把受信任的部署账户加入该组，不允许普通应用用户登录主机。

将已审核的发布版本检出到 `/opt/fiatlux-choice`。生产主机应使用经核对的固定 Git SHA，不直接跟随 `main`；只有实际验证过 Git 签名时才能称为“签名 tag”。当前 BuildKit provenance 不是 Git 或镜像签名。

## 4. 生产配置与密钥

```sh
sudo install -o root -g fiatlux -m 0640 \
  infra/env/production.env.example \
  /etc/fiatlux-choice/production.env
sudoedit /etc/fiatlux-choice/production.env
```

使用 URL 安全的随机十六进制，避免数据库 URL 与 MinIO 健康探针中的编码歧义。数据库五类身份必须分别生成，不能复用：

```sh
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 48
```

前五个数据库值分别用于 `POSTGRES_BOOTSTRAP_PASSWORD`、`POSTGRES_MIGRATION_PASSWORD`、`POSTGRES_RUNTIME_PASSWORD`、`POSTGRES_BACKUP_PASSWORD`、`POSTGRES_RESTORE_PASSWORD`，随后用于 `MINIO_ROOT_PASSWORD` 和 `SESSION_SECRET`。另为 `INITIAL_ADMIN_PASSWORD` 生成独立、至少 14 位的随机引导密码；它只用于显式 seed。LLM 与 GitHub 凭据按最小权限配置；不启用时保持 mock/manual，不伪造外部调用成功。角色能力和旧卷升级步骤见[PostgreSQL 最小权限角色手册](./database-roles.md)。

默认 `DATABASE_POOL_SIZE=5` 按单个数据库客户端计：API 与 worker 各有一个常驻 Drizzle/postgres.js 池和一个 pg-boss/node-postgres 池，分别使用 `fiatlux-api`、`fiatlux-api-queue`、`fiatlux-worker`、`fiatlux-worker-queue` 作为 PostgreSQL `application_name`，默认总上限为 20 条按需连接。Drizzle 池保持已打开的空闲连接，不再每 20 秒为低频人工请求重新建立 DNS/TCP/SCRAM 会话；pg-boss 池也使用同一连接数和建连 deadline。`DATABASE_CONNECT_TIMEOUT_SECONDS=10` 约束真实建连；`READINESS_TIMEOUT_MS=3000` 是 API ready 的应用层协作式 deadline，事件循环严重受压时 JavaScript timer 也可能延后，因此部署验收的 `curl --max-time 10` 仍是外部硬中止。API 容器自身 5 秒 health timeout 请求 bounded ready，依赖故障会使其显示 `unhealthy`，但 Docker 不会仅凭此状态自动重启；不要通过盲目重启或增大连接池、超时来掩盖宿主过载、DNS、凭据或数据库故障。调整前后都要记录 `pg_stat_activity`、ready 延迟和业务请求证据。

在与生产服务器分离的管理员设备生成 age 身份：

```sh
age-keygen -o age-identity.txt
age-keygen -y age-identity.txt
```

第二条输出是可公开的 `BACKUP_AGE_RECIPIENT`。私钥至少保留两份加密离线副本，并记录保管人；生产服务器上用于恢复演练的副本权限必须为 `0600`。私钥不能存入 Git、数据备份或密码明文笔记。

另行生成 Ed25519 备份签名密钥；它与 age 密钥用途相反：age identity 用于解密，Ed25519 private key 用于证明备份创建者。两者不得复用或放在同一离线副本中。

```sh
umask 077
openssl genpkey -algorithm ED25519 -out backup-signing-private.pem
openssl pkey -in backup-signing-private.pem -passin pass: \
  -pubout -out backup-signing-public.pem
openssl pkey -pubin -in backup-signing-public.pem -outform DER \
  | sha256sum

sudo install -o fiatlux -g fiatlux -m 0400 \
  backup-signing-private.pem /etc/fiatlux-choice/backup-signing-private.pem
sudo install -o root -g fiatlux -m 0640 \
  backup-signing-public.pem /etc/fiatlux-choice/backup-signing-public.pem
```

把输出的 64 位小写 SHA-256 经独立批准后写入 root 所有、部署用户只读的 `BACKUP_SIGNING_PUBLIC_KEY_SHA256`；同时配置 `BACKUP_SIGNING_PRIVATE_KEY_FILE`、`BACKUP_SIGNING_PUBLIC_KEY_FILE` 和 `BACKUP_REQUIRE_SIGNATURE=true`。签名私钥需要在线供每日一次性备份容器使用，因此不能替代离线 age identity；至少再保存一份加密离线副本并记录轮换/泄露处置。生产脚本拒绝符号链接、加密私钥、非 Ed25519 私钥以及权限不是 `0400`/`0600` 的文件。

验证生产配置不会输出展开后的密钥：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/compose.sh config --quiet
```

不要把 `./scripts/compose.sh config` 的完整输出发送到工单或聊天，因为它包含插值后的秘密。

## 5. 首次启动与初始化

使用 GHCR 发布镜像时，先以只读 package token 登录；也可在受控主机从审核过的源码构建。

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/compose.sh pull
./scripts/bootstrap-database.sh --apply --confirm DATABASE-BOOTSTRAP
./scripts/compose.sh up -d --wait --remove-orphans
./scripts/compose.sh ps
```

第一次 `bootstrap-database.sh` 在自动删除的一次性容器内创建/轮换角色并转移既有应用对象所有权，然后执行 Drizzle、pg-boss 与权限收敛。生产执行前要求入口/API/worker 已停止。常规启动顺序由 Compose 强制为：PostgreSQL 健康 -> 一次性业务迁移 -> 一次性 pg-boss 迁移 -> 权限收敛；MinIO 健康 -> 私有桶初始化；随后启动 API/worker/Web/Caddy。任一步失败时 API 不会启动，必须查看对应日志，不能改成忽略错误或临时给 runtime DDL。

```sh
./scripts/compose.sh logs --no-log-prefix migrate
./scripts/compose.sh logs --no-log-prefix queue-migrate database-permissions
./scripts/compose.sh logs --tail 100 api worker caddy
```

服务 ready 后，**仅在新建空库的首次初始化窗口**运行 seed：

```sh
SEED_MODE=bootstrap ./scripts/compose.sh run --rm seed
```

确认命令输出显示目标 organization、引导管理员和导入 73 条合规来源；再通过 UI/API 抽查来源保持 `reviewStatus=pending`、`contentHashStatus=pending_fetch`、业务 `status=draft`。seed 会创建 owner 角色，但不会替代登录和权限验收。

seed 是**非日常运维命令**，且必须显式选择模式。`bootstrap` 只接受空组织初始化，遇到既有 organization slug 会失败，不会更新 owner 密码或自动转成维护。既有组织补提示词/合规元数据只能用 `SEED_MODE=metadata-only`，该模式拒绝管理员身份/密码并且不修改 membership、assignment、角色或权限；系统角色维护必须另走经批准的 `system-role-maintenance`。不要把任何 seed 模式放进常规重启、systemd 或升级流程。

随后用受控浏览器完成：

1. 用 `INITIAL_ADMIN_EMAIL` 和引导密码首次登录，确认角色为 owner。
2. 打开“设置 → 登录密码”，输入当前引导密码并设置新的独立密码（至少 14 位）。成功后系统撤销该用户的其他会话。
3. 退出并用新密码重新登录，确认引导密码不再可用；保存登录、改密和审计结果，但不得保存明文密码或 Cookie。
4. 从生产环境文件清空 `INITIAL_ADMIN_PASSWORD`，再用 `./scripts/compose.sh config --quiet` 验证配置。API 和 worker 从不接收该变量；不得用重新 bootstrap 作为密码恢复手段。
5. 在密码管理系统中记录 owner 恢复责任人；当前没有自助忘记密码、恢复码或 MFA。唯一 active owner 无法登录时，按 README 的离线 one-off recovery 流程从 stdin 提供临时密码，并记录固定确认、理由、批准编号和唯一 requestId。

如果 seed 输出的 organization/email、模式或 metadata requestId 与批准配置不一致，或者既有组织 bootstrap 没有按设计失败，立即停止上线并按事件/变更流程处理，不要直接修改数据库。

## 6. 内网 TLS

生产 Caddy 使用内部 CA 为 `APP_DOMAIN` 签发证书，并在网关统一注入 CSP、HSTS 和其他浏览器安全头。Fastify 单独不提供 CSP，API 与 Web 不得绕过 Caddy 直接发布。导出根证书，不要导出根私钥：

```sh
mkdir -p data
./scripts/compose.sh cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  data/caddy-root.crt
sudo install -o root -g root -m 0644 data/caddy-root.crt \
  /etc/fiatlux-choice/caddy-root.crt
```

通过受控终端管理把根证书安装到公司设备的系统信任库，并记录证书指纹、批准人、分发范围和撤销流程。不要让用户在浏览器中长期点击“忽略证书错误”。

内网 DNS 配置完成后验证：

```sh
export APP_DOMAIN=choice.internal.example
export CADDY_ROOT_CA_FILE=/etc/fiatlux-choice/caddy-root.crt
curl --cacert "$CADDY_ROOT_CA_FILE" \
  "https://$APP_DOMAIN:8443/health/ready"
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
```

## 7. systemd 托管

```sh
sudo install -o root -g root -m 0644 infra/systemd/*.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fiatlux-choice.service
sudo systemctl enable --now fiatlux-choice-backup.timer
sudo systemctl enable --now fiatlux-choice-restore-drill.timer
systemctl list-timers 'fiatlux-choice-*'
```

systemd 单元默认每日备份、每月在独立卷恢复演练。首次启用前先手工执行一次签名备份和恢复演练，确认 age identity、Ed25519 私钥/公钥、独立批准的公钥指纹、磁盘空间和镜像权限。每份待演练归档还必须由审批人把核对后的 `.sha256` 清单复制到 `BACKUP_APPROVED_MANIFEST_DIR`；同一可写备份目录中的 SHA sidecar、公钥或指纹不会被自动信任。归档 attestation/signature 可以与归档一起保存，因为任何篡改都会被独立指纹锚定的签名验证发现；缺失任一批准值或签名材料时定时演练按设计失败关闭。

## 8. 上线验收

至少保存以下证据：

- 发布 Git SHA、镜像 tag 与 digest、数据库迁移版本。
- `verify-deployment.sh` 输出，以及 `/health/live`、`/health/ready` 响应。
- 桌面 Playwright/PWA 结果、真实受管手机浏览器结果；iPhone 14 Chromium 仿真只能作为补充，不能标作真机。
- RBAC 拒绝、审计追踪、高风险人工审批的端到端结果。
- Trivy、CodeQL、依赖审计、secret scan 与 SBOM。
- 首次加密且 Ed25519 签名的备份、独立 SHA/公钥指纹批准记录、带签名字段的独立恢复演练报告、实际 RPO/RTO。
- 内网 DNS、防火墙和 CA 分发审批记录。

任何一项缺失，都只能标记为“待验证”，不能声明生产部署完成。

此前的 formatVersion 1／同内容标签升级回滚只保留为历史证据。2026-07-19 首轮严格七组件相邻演练在回滚后 idle 登录暴露 postgres.js `CONNECT_TIMEOUT` 并正确阻断；修复后第二轮以 10 migrations 的 N 与 9 migrations 的本地 synthetic bridge、七个内容全异镜像，完成真实 registry push/pull、46 秒升级、43 秒应用回滚、双 formatVersion 2 恢复点和同一 API 进程启动 308 秒后的 HTTPS CRUD。它证明本地工程路径与缺陷修复，不是历史生产 N−1、GHCR、目标办公内网或经批准生产发布。目标办公内网部署与恢复、最终 GitHub CI/GHCR、受审 N−1 和业务批准仍待完成，不得预填为通过。
