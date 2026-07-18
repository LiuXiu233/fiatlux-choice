# 升级与回滚

## 发布物

每个发布版本必须对应：Git tag、Git SHA、六个不可变镜像（api、worker、web、gateway、minio、backup）、镜像 digest、SPDX SBOM、构建来源证明、迁移清单和测试报告。禁止使用 `latest`。

## 升级前检查

1. CI、Trivy、依赖审计和 secret scan 全部通过；CodeQL 必须实际运行通过。若私有仓库 entitlement 不可用，只能记录“未运行”，并在生产发布前补充经安全负责人批准的等效 SAST 结果。
2. 在全新数据库和上一版本快照上执行迁移。
3. 数据库变更遵循 expand/contract：先扩展 schema，等待所有旧进程不再依赖旧结构后，后续版本再收缩。
4. 最近一次独立恢复演练通过，age 私钥可用，备份介质空间充足。
5. 确认维护窗口、审批人、操作人、回滚目标和沟通渠道。

默认 dry-run 不修改系统：

```sh
./scripts/upgrade.sh --to v1.1.0
```

实际升级：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/upgrade.sh --to v1.1.0 --apply --confirm UPGRADE
```

脚本先做加密备份，再拉取镜像、单独执行迁移、重建服务、验证健康和容器安全参数，最后才写入 `data/releases/current` 与 `previous`。任何中途失败都不能手工伪造版本状态。

首次部署由 `production.env` 的 `APP_IMAGE_TAG` 决定；首次成功升级后，`data/releases/current` 成为 Compose 的本机版本状态并优先于环境文件，确保重启不会退回旧镜像。该状态文件必须与发布记录一起备份和审计，但不能在验证失败前提前修改。

## 应用回滚

默认 dry-run：

```sh
./scripts/rollback.sh
./scripts/rollback.sh --to v1.0.1
```

只有确认旧应用可读取当前 schema 后才能执行：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
./scripts/rollback.sh --to v1.0.1 \
  --apply --confirm APP-ONLY-ROLLBACK
```

该脚本不执行数据库 down migration。自动数据库降级容易造成不可逆数据丢失，项目明确不提供。若当前 schema 与旧应用不兼容，应停止应用并使用升级前完整备份按恢复手册恢复，而不是继续尝试旧镜像。

## 升级后观察

至少观察一个完整 worker 周期：

```sh
./scripts/compose.sh ps
./scripts/compose.sh logs --since 30m api worker caddy
./scripts/verify-deployment.sh --ca "$CADDY_ROOT_CA_FILE"
```

抽查登录、RBAC 拒绝、任务状态迁移、审批、文件下载、AI 顾问审计和通知。确认旧版本未继续运行，数据库与对象存储没有暴露宿主端口。
