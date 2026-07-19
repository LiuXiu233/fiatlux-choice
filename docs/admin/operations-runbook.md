# 运行维护手册

## 健康语义

- `/health/live`：只表示 API 进程仍能响应，供诊断使用，不证明依赖可用。
- `/health/ready`：并行检查常驻 Drizzle/PostgreSQL 客户端、pg-boss 与 MinIO。每项探针使用 `READINESS_TIMEOUT_MS` 作为应用层协作式 deadline；正常事件循环调度下超时或失败返回 HTTP 503，部署验收的 `curl --max-time 10` 是调度阻塞时的外部硬中止。API 容器健康检查请求 bounded ready，因此依赖持续失败会显示 `unhealthy`；Docker Compose 不会仅因 `unhealthy` 自动重启容器，值班人仍须按故障树处理。尚未结束的底层探针保持 single-flight，重复健康请求不会堆叠新的数据库或对象存储操作。
- worker 只在本进程通过受控 `JobQueue.work` 注册了全部七类唯一订阅、pg-boss 能读到全部声明队列，且同一常驻 Drizzle 客户端能查询 PostgreSQL 后，才每 10 秒更新自身 `/tmp` tmpfs 私有心跳；任一订阅被受控取消、队列停止、数据库查询或组合探针持续失败时不会刷新，30 秒后判定不健康。它仍不能证明每个空闲订阅最近一次 fetch 或每项业务任务按时完成，不能替代失败任务、积压和租约监控。
- Caddy 的容器健康检查同时请求 API live 与 Web 登录壳；其中任一路径不可达都不会保持 `healthy`。
- 健康响应不得包含连接串、凭据、数据库版本细节、内部堆栈或公司数据。
- 普通建连失败返回脱敏的 `DEPENDENCY_UNAVAILABLE`。若连接在查询过程中中断，API 返回 `DEPENDENCY_OUTCOME_UNKNOWN`；这意味着写入可能已经提交。不得自动重放非幂等请求，须先按 `requestId`、资源状态和审计事件核对结果，再人工决定后续动作。

日常检查：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/compose.sh ps
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
systemctl --failed
df -h /var/lib/docker /var/backups/fiatlux-choice
```

验证输出若报告数据库 runtime 身份、role flags、audit 权限或触发器所有者不符，立即停止上线；不要用 bootstrap/migrator URL 临时替换 API/worker。数据库密码轮换、旧卷角色迁移和故障处置见[PostgreSQL 最小权限角色手册](./database-roles.md)。`db-bootstrap` 不是日常健康修复命令，执行会轮换四个应用/运维角色口令并转移所有权，生产必须进入维护窗口。

## 日志

所有容器使用 `json-file`，单文件最大 10 MB，最多保留 5 个压缩文件。应用日志应为 JSON，并包含 `requestId`、`actorId`、`action`、`result` 与必要的 trace 标识。

```sh
./scripts/compose.sh logs --since 30m api worker
./scripts/compose.sh logs --since 30m caddy
./scripts/compose.sh logs --tail 200 postgres minio
```

禁止记录密码、session、Authorization、完整身份证号、银行账号、LLM API key、原始敏感提示词或未脱敏附件内容。向外部人员提供日志前必须人工脱敏并记录交付依据。

## 巡检节奏

每日：

- live/ready、容器重启次数、worker 失败任务和磁盘使用率。
- 上一次备份服务状态与加密文件大小；异常小的备份视为失败。
- 登录失败、关键权限修改、人工审批与外部适配器失败事件。
- 合规来源 `changed`/`failed`、已到期人工复核、连续失败次数、异常长租约及 `monitor_result_discarded` 审计；202 排队记录不能当作抓取成功。

每周：

- GitHub Actions 安全扫描结果、依赖更新和镜像高危漏洞。
- PostgreSQL/MinIO 容量趋势、备份介质剩余空间。
- 长时间未完成任务、失败重试与通知积压。

每月：

- 独立恢复演练及 RPO/RTO，抽查附件校验和。
- 管理员、Docker 组、公司角色和外部 token 权限复核。
- Caddy CA、LLM/GitHub 凭据、age 密钥托管清单复核。

## 常用处置

单个应用重启：

```sh
./scripts/compose.sh restart api
./scripts/compose.sh up -d --wait api
```

查看一次性迁移：

```sh
./scripts/compose.sh ps --all migrate
./scripts/compose.sh logs migrate
```

迁移必须依次通过一次性 `migrate`、`queue-migrate`、`database-permissions` 服务执行；禁止把 DDL 放进 API/worker 多副本启动入口。重复运行当前迁移与授权收敛应安全，但每次生产迁移前仍需完整加密备份。

临时停止外部 AI 调用：在生产环境文件中切换 `LLM_DRIVER=mock`，然后重建 API 和 worker。所有模拟结果必须明确标为模拟，不得显示外部操作成功。

```sh
./scripts/compose.sh up -d --wait --force-recreate api worker
```

### 成员停用与离职处置

1. 先确认至少保留一名未归档、状态为 `active` 的 owner，并确定另一名审批人或单人例外的事后复核责任人。
2. 在“成员与权限”提交停用或离职申请。看到“申请已进入人工审批”只代表已创建 `critical` 审批，不能据此声称账号已经停用。
3. 审批前完成任务、文件、合同、发票、设备和外部系统权限交接；审批中心的理由与意见不得包含密码、Cookie、token 或密钥。
4. 批准后重新登录或刷新成员列表，确认状态为 `inactive`/`offboarded`，原本组织会话访问返回 401，并在审计日志核对 `membership` 状态事件和 `revoke_for_membership_lifecycle` 的撤销数量。
5. 用该用户在其他组织的授权测试账号验证其 membership 与会话未受影响；没有跨组织场景时无需为了测试创建生产身份。
6. 驳回时确认成员仍为 `active` 且会话未被批量撤销。409 表示最后 owner、重复决定或陈旧版本保护生效；不要绕过保护直接执行 SQL。
7. 系统只撤销 FIAT LUX CHOICE 当前组织会话。邮箱、GitHub、云平台、银行、税务、电子签章、门禁和设备证书必须按各系统流程人工回收并保存回执。

临时停用原因消除后，只能对 `inactive` 成员发起“申请重新启用”。批准前复核身份、职责、至少一个未归档角色和外部权限；批准后确认成员变为 `active`，同时审计事件 `ensure_revoked_for_membership_reactivation` 显示旧会话仍保持撤销。成员必须重新登录生成新会话。驳回或 409 不得恢复访问。`offboarded` 不支持直接重新启用，需等待未来重新入职流程，禁止通过 SQL 改回 active。

登录创建会话会在数据库事务内重新核对已验证的密码哈希，并锁定目标组织 membership 后再次确认 `active`。因此改密、停用或离职与登录并发时，要么登录先完成后新会话被撤销，要么状态/密码先变化后登录被拒绝；不得出现撤销完成后又由旧密码晚插入有效会话。遇到 401/403 时重新读取成员状态，不要重放旧 Cookie。

审计导出或故障排查只能使用会话撤销数量、membership ID、approval ID 和 request ID；不得查询、复制或记录 `sessions.token_hash`。

## 告警分级

- P0：疑似数据泄漏、管理员账户接管、审计链破坏、数据库不可恢复。立即隔离入口并启动安全事件流程。
- P1：ready 持续失败、worker 全面停摆、磁盘超过 90%、当天备份失败。目标 30 分钟内响应。
- P2：单一非关键集成失败、个别任务可重试、容量超过 75%。下一个工作日处理。

关闭入口但保留数据服务：

```sh
./scripts/compose.sh stop caddy api worker
```

不要在不明原因下执行 `down --volumes`、`docker system prune --volumes`、手工删除 PostgreSQL/MinIO 卷或清空审计表。

## MinIO 凭据轮换与旧 ID 撤销

优先保持 `S3_ACCESS_KEY_ID`、`S3_BACKUP_ACCESS_KEY_ID`、`S3_RESTORE_ACCESS_KEY_ID` 不变，只轮换各自 secret。进入维护窗口，更新受控环境文件后运行一次性 `minio-bootstrap`，再重建 API/worker，并执行 `verify-minio-permissions.sh`。同一 access ID 的 `mc admin user add` 会收敛当前 secret；只有“新 secret 正向成功 + 旧 secret 对 `mc stat` 失败 + 无 admin 权限”都有实测记录，才能宣称轮换完成。

如果合规或事件响应要求更换 access ID，`minio-bootstrap` 只会创建/收敛配置中的新 ID，**不会自动知道或删除旧 ID**。操作人必须在审批记录中列出每个旧 ID，先禁用、用旧凭据负向验证，再由 root-only 一次性维护容器删除；不得把 MinIO root 凭据放入 API、worker、backup 或 restore 常驻环境。示意流程如下，`OLD_ACCESS_ID` 必须来自批准记录且先做人工作为安全标识符复核：

```sh
export OLD_ACCESS_ID=fiatlux-app-old
./scripts/compose.sh run --rm --no-deps --pull never \
  -e "OLD_ACCESS_ID=$OLD_ACCESS_ID" --entrypoint /bin/sh minio-bootstrap -ec '
    case "$OLD_ACCESS_ID" in *[!A-Za-z0-9._-]*|"") exit 2;; esac
    mc alias set root http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --api S3v4 >/dev/null
    mc admin user disable root "$OLD_ACCESS_ID"
    mc admin user remove root "$OLD_ACCESS_ID"
  '
```

随后用已隔离保存的旧 access ID/secret 从非 root `backup-tools` 执行 `mc stat`，必须认证失败；再确认三个新账号各自只有 app、只读 backup、破坏性 restore 的预期边界。删除旧 ID 不可自动批量推断，以免误删仍在用的公司存储身份。

## 容量与保留

备份脚本不自动删除历史文件，避免一次错误同时删除可恢复点。运营人员应在“已存在另一介质副本且最近恢复演练通过”后，按公司批准的保留策略清理。至少保留每日 14 份、每周 8 份、每月 12 份；具体期限还需结合会计档案、合同档案和诉讼保全要求人工确认。
