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

2026-07-18 候选验证已在开发机以 production-like Compose 完成，入口为 `https://choice.localhost:18443`。这只证明本机 Docker、HTTPS 和依赖组合能够运行，不证明目标 Linux 主机、多架构发布、广州办公内网 DNS/CA、防火墙或真实移动设备已经验证。

## 3. 目录和账户

Linux 主机建议使用专用账户：

```sh
sudo useradd --create-home --shell /bin/bash fiatlux
sudo usermod --append --groups docker fiatlux
sudo install -d -o fiatlux -g fiatlux -m 0750 /opt/fiatlux-choice
sudo install -d -o fiatlux -g fiatlux -m 0700 /var/backups/fiatlux-choice
sudo install -d -o root -g fiatlux -m 0750 /etc/fiatlux-choice
```

Docker 组等价于主机 root 权限。只能把受信任的部署账户加入该组，不允许普通应用用户登录主机。

将已审核的发布版本检出到 `/opt/fiatlux-choice`。生产主机应使用签名 tag 或固定 Git SHA，不直接跟随 `main`。

## 4. 生产配置与密钥

```sh
sudo install -o root -g fiatlux -m 0640 \
  infra/env/production.env.example \
  /etc/fiatlux-choice/production.env
sudoedit /etc/fiatlux-choice/production.env
```

使用 URL 安全的随机十六进制，避免数据库 URL 与 MinIO 健康探针中的编码歧义：

```sh
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 48
```

分别用于 `POSTGRES_PASSWORD`、`MINIO_ROOT_PASSWORD` 和 `SESSION_SECRET`。另为 `INITIAL_ADMIN_PASSWORD` 生成独立、至少 14 位的随机引导密码；它只用于显式 seed。LLM 与 GitHub 凭据按最小权限配置；不启用时保持 mock/manual，不伪造外部调用成功。

在与生产服务器分离的管理员设备生成 age 身份：

```sh
age-keygen -o age-identity.txt
age-keygen -y age-identity.txt
```

第二条输出是可公开的 `BACKUP_AGE_RECIPIENT`。私钥至少保留两份加密离线副本，并记录保管人；生产服务器上用于恢复演练的副本权限必须为 `0600`。私钥不能存入 Git、数据备份或密码明文笔记。

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
./scripts/compose.sh up -d --wait --remove-orphans
./scripts/compose.sh ps
```

启动顺序由 Compose 强制为：PostgreSQL 健康 -> 一次性迁移；MinIO 健康 -> 私有桶初始化；随后启动 API/worker/Web/Caddy。迁移失败时 API 不会启动，必须先查看迁移日志，不能把迁移容器改成忽略错误。

```sh
./scripts/compose.sh logs --no-log-prefix migrate
./scripts/compose.sh logs --tail 100 api worker caddy
```

服务 ready 后，**仅在新建空库的首次初始化窗口**运行 seed：

```sh
./scripts/compose.sh run --rm api \
  node packages/db/dist/seed-cli.js
```

确认命令输出显示目标 organization、引导管理员和导入 72 条合规来源；再通过 UI/API 抽查来源保持 `reviewStatus=pending`、`contentHashStatus=pending_fetch`、业务 `status=draft`。seed 会创建 owner 角色，但不会替代登录和权限验收。

seed 是幂等数据初始化，但**不是无副作用的日常命令**：每次执行都会把引导 owner 的密码改成当时 `INITIAL_ADMIN_PASSWORD`/`BOOTSTRAP_ADMIN_PASSWORD` 的值。不要把 seed 放进常规重启、systemd 或升级流程；确需重跑时，必须先取得管理员密码重置批准并通知 owner。

随后用受控浏览器完成：

1. 用 `INITIAL_ADMIN_EMAIL` 和引导密码首次登录，确认角色为 owner。
2. 打开“设置 → 登录密码”，输入当前引导密码并设置新的独立密码（至少 14 位）。成功后系统撤销该用户的其他会话。
3. 退出并用新密码重新登录，确认引导密码不再可用；保存登录、改密和审计结果，但不得保存明文密码或 Cookie。
4. 将生产环境中的 `INITIAL_ADMIN_PASSWORD` 替换为另一个未分发的随机 guard 值并重启。该变量当前仍是生产 Compose 的必填配置；替换不会自动改变数据库密码，只有误重跑 seed 才会使用它。
5. 在密码管理系统中记录 owner 恢复责任人；当前没有自助忘记密码、恢复码或 MFA。

如果 seed 输出的 organization/email 与批准配置不一致，或重复 seed 意外重置密码，立即停止上线并按事件/变更流程处理，不要直接修改数据库。

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

systemd 单元默认每日备份、每月在独立卷恢复演练。首次启用前先手工执行一次备份和恢复演练，确认 age 私钥路径、磁盘空间和镜像权限。

## 8. 上线验收

至少保存以下证据：

- 发布 Git SHA、镜像 tag 与 digest、数据库迁移版本。
- `verify-deployment.sh` 输出，以及 `/health/live`、`/health/ready` 响应。
- 桌面 Playwright/PWA 结果、真实受管手机浏览器结果；iPhone 14 Chromium 仿真只能作为补充，不能标作真机。
- RBAC 拒绝、审计追踪、高风险人工审批的端到端结果。
- Trivy、CodeQL、依赖审计、secret scan 与 SBOM。
- 首次加密备份、独立恢复演练报告、实际 RPO/RTO。
- 内网 DNS、防火墙和 CA 分发审批记录。

任何一项缺失，都只能标记为“待验证”，不能声明生产部署完成。

当前候选已有本机 production-like、age 加密备份、隔离恢复和实际升级/回滚演练证据；这些结果仍未绑定最终 Git SHA，也不能替代目标办公内网证据。目标办公内网部署与恢复、最终 GitHub CI 和业务批准均不得预填为通过。
