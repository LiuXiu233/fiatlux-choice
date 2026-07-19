# PostgreSQL 最小权限角色与迁移

## 角色边界

Compose 不再让 `POSTGRES_USER` 同时服务所有进程。数据库使用固定、可审计的五类身份：

| 身份 | 常驻位置 | 数据库能力 | 明确禁止 |
| --- | --- | --- | --- |
| `POSTGRES_BOOTSTRAP_USER`（默认 `fiatlux_bootstrap`） | 仅 PostgreSQL 容器；口令只额外交给显式 `db-bootstrap --rm` 操作 | 集群超级用户、创建/轮换下列角色、旧部署所有权转移 | API、worker、migrate、backup、seed 均不得持有 |
| `fiatlux_migrator` | 一次性 `migrate`、`queue-migrate`、`database-permissions` | 目标数据库所有者；业务与 pg-boss DDL | 非超级用户，无 `CREATEDB`、`CREATEROLE`、`BYPASSRLS` |
| `fiatlux_runtime` | API、worker、seed | 业务表和 pg-boss 所需 DML；审计只可 SELECT/INSERT | 无 DDL、数据库创建、角色创建、审计 UPDATE/DELETE/TRUNCATE、触发器修改 |
| `fiatlux_backup` | 一次性 `backup-tools` | 仅目标库三个应用 schema 的 USAGE/SELECT 与 `pg_dump` | 无全局 `pg_read_all_data`、业务写入、DDL、建库、建角色 |
| `fiatlux_restore` | 仅显式恢复操作 | `CREATEDB`、`pg_signal_backend`，可 `SET ROLE fiatlux_migrator` 恢复对象 | 非超级用户，无 `CREATEROLE`；不得交给常驻服务 |

`fiatlux_restore` 的权限明显高于日常运行身份，因为替换数据库需要终止连接、建库和以迁移所有者恢复对象。它只能在人工批准的维护窗口通过自动删除的一次性容器使用。Docker 主机管理员和 PostgreSQL bootstrap 超级用户仍属于最高信任边界；数据库角色分离不能防御已取得主机 root 的攻击者。

该授权模型假设 Compose PostgreSQL 集群专用于 FIAT LUX CHOICE。backup 的对象权限只授予目标库三个应用 schema，但 PostgreSQL 没有“显式拒绝”权限；若把不相关数据库放进同一集群，其他数据库的 PUBLIC CONNECT/对象授权可能扩大可见范围。不得在未重新设计逐数据库访问控制和完成专项测试前共用集群。

## 配置与密钥

生产配置必须提供五个相互独立、URL 安全且至少 16 字符的值；建议各自运行一次 `openssl rand -hex 32`：

```text
POSTGRES_BOOTSTRAP_USER=fiatlux_bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=...
POSTGRES_MIGRATION_PASSWORD=...
POSTGRES_RUNTIME_PASSWORD=...
POSTGRES_BACKUP_PASSWORD=...
POSTGRES_RESTORE_PASSWORD=...
```

不要在聊天、工单、命令行参数或 `docker compose config` 输出中展开口令。API/worker 只接收含 runtime 身份的 `DATABASE_URL`；worker 的内置数据库 dump 复用自身 runtime 读取权限，不额外常驻 backup/restore 凭据。完整运维备份使用 `fiatlux_backup`。

## 全新数据库引导

第一次启动必须先拉取镜像，再显式创建角色和 schema；直接在空卷上启动全部服务会让 `migrate` 因 migrator 尚不存在而失败，这是失败关闭行为。

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/compose.sh pull
./scripts/bootstrap-database.sh --apply --confirm DATABASE-BOOTSTRAP
./scripts/compose.sh up -d --wait --remove-orphans
```

`bootstrap-database.sh` 的顺序是：等待 PostgreSQL -> `db-bootstrap --rm` -> Drizzle 迁移 -> pg-boss 迁移和声明队列创建 -> 运行时授权收敛。生产执行前要求 caddy、API、worker 已停止；显式操作容器退出后自动删除。普通重启和扩容不运行 `db-bootstrap`，但会幂等检查迁移、队列版本和授权。

pg-boss 的 schema 变更只允许 `queue-migrate` 以 migrator 执行。API/worker 以 `migrate:false` 启动并且不创建队列；如果发布新增队列但遗漏一次性队列迁移，应用失败关闭，不会临时取得 DDL。

## 从旧单角色部署升级

旧卷中的 `POSTGRES_USER` 往往同时是超级用户和所有业务/pg-boss 对象的所有者。必须按以下顺序迁移：

1. **仍使用旧发布和旧环境文件**创建完整加密备份并核对可恢复性。新配置引用的 `fiatlux_backup` 尚不存在，不能先切换配置再补备份。
2. 进入维护窗口并停止 `caddy api worker`。
3. 将旧 `POSTGRES_USER` 的实际角色名填入新配置的 `POSTGRES_BOOTSTRAP_USER`。不要仅把名字改成 `fiatlux_bootstrap`；环境变量不会在既有卷内自动创建或重命名角色。不同时轮换时，`POSTGRES_BOOTSTRAP_PASSWORD` 仍填旧口令；同时轮换时按下文把该字段设为期望新值，并临时提供 current 旧值。
4. 为 migration、runtime、backup、restore 分别生成新口令，然后切换到包含本方案的新发布资产并执行：

```sh
./scripts/bootstrap-database.sh --apply --confirm DATABASE-BOOTSTRAP
./scripts/compose.sh up -d --wait --remove-orphans
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
```

引导脚本只转移目标数据库中 `public`、`drizzle`、`pgboss` 的应用表、序列、视图、函数和枚举所有权；它刻意不使用 `REASSIGN OWNED`，避免把旧超级用户拥有的其他数据库或 tablespace 一并转移。验证完成前保留升级前备份。若部署包含这三个 schema 之外的自定义对象，必须先登记并人工扩展所有权迁移清单。

如果同时轮换 bootstrap 口令，`POSTGRES_BOOTSTRAP_PASSWORD` 表示**期望新口令**，而数据库在脚本执行前仍只接受旧口令。把旧值通过受控密码管理器临时导出为 `POSTGRES_BOOTSTRAP_CURRENT_PASSWORD`，不要把它追加到长期环境文件：

```sh
# 在不会记录明文的受控 shell 中从密码管理器注入旧值：
export POSTGRES_BOOTSTRAP_CURRENT_PASSWORD='[由密码管理器注入的旧值]'
./scripts/bootstrap-database.sh --apply --confirm DATABASE-BOOTSTRAP
unset POSTGRES_BOOTSTRAP_CURRENT_PASSWORD
```

脚本用 current 值完成认证，所有角色/所有权操作成功后才 `ALTER ROLE` 到期望新值，并立刻以新口令重新连接验证超级用户身份。未提供 current 时默认当前值与期望值相同。旧口令、新口令都不要放进命令历史、日志或 `docker compose config` 输出；若末尾重新连接验证失败，停止应用并由数据库管理员确认哪个口令实际生效，不能盲目反复执行。

## 审计追加写

授权收敛执行三层控制：

1. runtime 对 `audit_events` 只保留 SELECT/INSERT，显式撤销 UPDATE、DELETE、TRUNCATE、REFERENCES、TRIGGER。
2. `audit_events_prevent_update_delete` 设置为 `ENABLE ALWAYS`；即使未来误授 UPDATE/DELETE，触发器仍拒绝修改。
3. runtime 不是表所有者、超级用户或 `BYPASSRLS`，不能禁用触发器、设置 `session_replication_role=replica` 或 `SET ROLE fiatlux_migrator`。

迁移所有者和主机/集群管理员仍可显式禁用或替换控制，因此必须限制维护凭据、保留异机备份并审计维护窗口。

## 备份、恢复、升级和轮换

- `backup.sh` 让 `backup-tools` 以 `fiatlux_backup` 执行 `pg_dump`；该身份不能写业务或执行 DDL。
- `restore.sh` 临时覆盖为 `fiatlux_restore`，替换目标库后用 `--role=fiatlux_migrator` 恢复对象，再依次执行业务迁移、pg-boss 迁移和授权收敛。
- `upgrade.sh` 每次业务迁移后都运行 `queue-migrate` 与 `database-permissions`，确保新表获得 runtime DML、审计特殊撤销不会被默认权限覆盖。
- 轮换任一数据库口令时进入维护窗口、修改受控环境文件、运行 `bootstrap-database.sh`，再重建服务并验证。bootstrap 轮换必须按上一节临时提供 current 认证值；其他四类口令由已认证的 bootstrap 会话直接轮换。只改文件而不轮换数据库角色或重建容器不算完成。

## 自动验证

隔离的新卷测试：

```sh
./scripts/test-database-privileges.sh
```

模拟旧单超级用户拥有全部对象后再迁移：

```sh
DB_PRIVILEGE_TEST_SIMULATE_LEGACY=1 ./scripts/test-database-privileges.sh
```

脚本使用随机测试口令、独立 Compose 项目和自动销毁的卷，验证角色 flags、所有权转移、业务 DML、audit append、审计负向路径、pg-boss 无 DDL 入队、backup pg_dump 和 restore 受控建库。`verify-deployment.sh` 还会在实际部署中检查 API/worker 的连接用户名、数据库 flags、schema CREATE、审计权限、触发器模式与所有者；检查结果不输出连接串或口令。
