# 安全事件响应

## 首要原则

保护人员和证据，停止继续泄漏，不伪造“已恢复”。安全事件中的付款、税务、签署、通知监管机关或对外法律承诺仍需有权人员人工批准。

## 处置顺序

1. 记录发现时间、发现人、现象、受影响账户/主机和当前版本。
2. 疑似主动攻击时停止 Caddy、API 与 worker，保留 PostgreSQL/MinIO 和容器日志。先在受控主机的加密介质上创建仅响应人员可读的证据目录，并把当前 shell 的新文件权限收紧；不得把证据写到仓库、普通用户目录或共享临时目录：

```sh
evidence_dir=/var/lib/fiatlux-choice/incidents/REPLACE_WITH_INCIDENT_ID
install -d -m 0700 "$evidence_dir"
umask 077
./scripts/compose.sh stop caddy api worker
./scripts/compose.sh logs --since 24h > "$evidence_dir/incident-containers.log"
./scripts/compose.sh ps -q | xargs docker inspect > "$evidence_dir/incident-inspect.json"
chmod 0600 "$evidence_dir/incident-containers.log" "$evidence_dir/incident-inspect.json"
sha256sum "$evidence_dir/incident-containers.log" "$evidence_dir/incident-inspect.json" \
  > "$evidence_dir/SHA256SUMS"
```

`docker inspect` 会把容器环境变量、挂载和网络配置写入原始证据，其中可能包含数据库、MinIO、LLM、GitHub 和会话凭据。该 JSON 必须视为最高敏感级别：只允许进入批准的事件证据库，不得上传普通工单、聊天、邮件、GitHub issue 或 CI artifact，也不得作为一般诊断附件。完成取证后仍须按事件流程立即轮换其中出现的全部凭据；限制访问并不能替代撤销。

3. 不执行 prune、不删除卷、不清空审计、不在原日志上编辑脱敏。
4. 从可信管理员设备轮换受影响的 GitHub、LLM、会话和外部 token；撤销旧凭据。
5. 评估数据类别、人员范围、时间范围、跨境与外部接收方；由合规负责人判断通知义务。
6. 从已知可信版本重建应用，在隔离项目中恢复并验证备份后再决定生产恢复。
7. 记录根因、控制失效、修复、验证证据和剩余风险；更新威胁模型与测试。

## 证据保护

- 计算导出日志与备份的 SHA-256，记录保管链。
- 原始证据只读保存；用于分析的副本需单独标识。
- 日志和数据库可能包含个人信息，只向必要人员开放。
- 容器 inspect 原始证据可能直接包含生产 secret；访问、复制、解密、销毁和凭据轮换都要进入保管链。
- 系统时钟、时区和 NTP 状态纳入证据，所有报告同时记录 UTC 与 Asia/Shanghai。

## 恢复上线门槛

- 攻击入口已关闭，受影响凭据已撤销。
- 干净镜像、SBOM、漏洞扫描和来源证明已验证。
- 数据库/对象恢复清单通过，ready 与核心 E2E 通过。
- 权限、审计、高风险人工批准和外部适配器边界重新验证。
- 公司负责人和安全/合规责任人共同批准恢复入口。
