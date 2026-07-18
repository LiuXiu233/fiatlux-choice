# 运行维护手册

## 健康语义

- `/health/live`：只表示 API 进程仍能响应。失败时容器会被判定不健康。
- `/health/ready`：应检查 PostgreSQL、pg-boss 与 MinIO。依赖不可用时返回 HTTP 503。
- 健康响应不得包含连接串、凭据、数据库版本细节、内部堆栈或公司数据。

日常检查：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/compose.sh ps
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
systemctl --failed
df -h /var/lib/docker /var/backups/fiatlux-choice
```

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

迁移必须通过 `migrate` 服务单独执行；禁止把迁移放进 API 多副本启动入口。重复运行当前迁移命令应安全，但每次生产迁移前仍需完整加密备份。

临时停止外部 AI 调用：在生产环境文件中切换 `LLM_DRIVER=mock`，然后重建 API 和 worker。所有模拟结果必须明确标为模拟，不得显示外部操作成功。

```sh
./scripts/compose.sh up -d --wait --force-recreate api worker
```

## 告警分级

- P0：疑似数据泄漏、管理员账户接管、审计链破坏、数据库不可恢复。立即隔离入口并启动安全事件流程。
- P1：ready 持续失败、worker 全面停摆、磁盘超过 90%、当天备份失败。目标 30 分钟内响应。
- P2：单一非关键集成失败、个别任务可重试、容量超过 75%。下一个工作日处理。

关闭入口但保留数据服务：

```sh
./scripts/compose.sh stop caddy api worker
```

不要在不明原因下执行 `down --volumes`、`docker system prune --volumes`、手工删除 PostgreSQL/MinIO 卷或清空审计表。

## 容量与保留

备份脚本不自动删除历史文件，避免一次错误同时删除可恢复点。运营人员应在“已存在另一介质副本且最近恢复演练通过”后，按公司批准的保留策略清理。至少保留每日 14 份、每周 8 份、每月 12 份；具体期限还需结合会计档案、合同档案和诉讼保全要求人工确认。
