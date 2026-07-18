# 备份、恢复与恢复演练

## 备份内容与边界

`backup.sh` 生成：

- PostgreSQL 自定义格式 dump，覆盖业务、权限、审计、pg-boss 等同库数据。
- MinIO 私有桶的对象镜像。
- `metadata.json` 与逐文件 `manifest.sha256`。
- 生产环境使用 age 加密的数据归档。
- 若设置了可读的 `FIATLUX_ENV_FILE`，额外生成 age 加密的部署配置与发布状态副本。

生产备份默认先停止 Caddy、API 和 worker，待数据库与对象桶归档及配置加密完成后恢复原先运行的服务。这段短维护窗口用于避免 PostgreSQL 记录与 MinIO 对象来自不同业务时点。`--allow-live-writes` 仅用于人工明确接受跨存储不一致风险的特殊场景。

不进入数据备份：age 私钥、Docker 主机密钥、GitHub/LLM 服务端密钥的外部托管副本。它们必须独立离线托管。Caddy 内部 CA 丢失后可重新生成，但所有终端需要重新信任；如业务要求证书连续性，应由安全负责人另行加密托管 Caddy CA 卷，不能与 age 私钥存放在同一位置。

## 创建备份

开发环境允许未加密备份；生产环境强制加密：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/backup.sh --require-encryption
```

成功标准：命令退出码为 0，生成 `fiatlux-*.tar.gz.age`、对应 `*.config.tar.gz.age`，并输出归档 SHA-256。只看到文件存在不代表备份成功。

把加密文件复制到与生产主机故障域不同的介质，并再次计算 SHA-256。传输和删除均记录操作人、时间、源/目标和校验值。

部署主机完全丢失时，先在隔离管理员设备解密 `*.config.tar.gz.age`，人工检查其中的 `production.env` 和可选 `releases/` 状态，再以部署手册规定的所有者与权限安装。配置恢复不会由数据恢复脚本自动覆盖，避免把错误环境或旧凭据直接写入生产：

```sh
age --decrypt --identity age-identity.txt \
  --output config.tar.gz fiatlux-....config.tar.gz.age
tar -tzf config.tar.gz
```

检查清单后再提取；不得在共享终端、聊天目录或未加密临时目录长期保留明文配置。

## 独立恢复演练

演练不会接触当前项目卷。脚本创建名称以 `fiatlux-restore-` 开头的随机 Compose 项目，使用随机凭据和全新 PostgreSQL/MinIO 卷；恢复后执行当前迁移、启动 API/worker、检查 ready、业务表数量和对象数量，最后销毁演练卷。

```sh
./scripts/restore-drill.sh \
  --file /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --identity /etc/fiatlux-choice/age-identity.txt
```

`KEEP_RESTORE_STACK=1` 只用于故障调查。保留后必须记录项目名，并在调查结束时确认名称前缀再清理：

```sh
COMPOSE_PROJECT_NAME=fiatlux-restore-... FIATLUX_ENV=development \
  ./scripts/compose.sh down --volumes --remove-orphans
```

报告保存在备份目录的 `restore-drill-*.log`，容器恢复报告保存在 `restore-reports/`。记录：备份时间、开始/结束时间、恢复点差异（RPO）、恢复用时（RTO）、表/对象数、迁移版本和异常。

## 生产恢复

生产恢复是破坏性操作，必须经过人工批准并进入维护窗口。先确认目标数据库和桶名称；默认还会创建恢复前加密备份。

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/restore.sh \
  --file /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --identity /etc/fiatlux-choice/age-identity.txt \
  --confirm-database fiatlux_choice \
  --confirm-bucket fiatlux-choice \
  --approve YES-I-UNDERSTAND
```

脚本执行顺序：恢复前备份 -> 停止入口/API/worker -> 校验归档路径与清单 -> 替换数据库 -> 替换对象桶 -> 当前迁移 -> 重启并验证。

仅当目标数据库已经损坏、无法生成备份且审批人接受风险时，才可加 `--skip-pre-backup`。恢复失败时保持应用停止，先保全日志和现有卷，不要反复重试破坏性步骤。

## 定期任务验证

```sh
systemctl status fiatlux-choice-backup.timer
systemctl status fiatlux-choice-restore-drill.timer
journalctl -u fiatlux-choice-backup.service --since yesterday
journalctl -u fiatlux-choice-restore-drill.service --since '40 days ago'
```

备份从未实际恢复过，就不能视为有效备份。
