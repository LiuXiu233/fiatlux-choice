# 备份、恢复与恢复演练

## 备份内容与边界

`backup.sh` 生成：

- PostgreSQL 自定义格式 dump，覆盖业务、权限、审计、pg-boss 等同库数据；一次性 backup-tools 使用只读 `fiatlux_backup`，不能写业务或执行 DDL。
- MinIO 私有桶的对象镜像。
- `metadata.json` formatVersion 2 与逐文件 `manifest.sha256`。metadata 记录稳定部署来源 `sourceId`、归档名、来源数据库/桶、UTC 创建时间、backup image 发布版本及 PostgreSQL/mc 工具版本。
- 生产环境使用 age 加密的数据归档。
- 数据归档旁生成 `<归档名>.sha256`，供审批人转录到独立、只读的批准记录。
- 数据归档旁生成规范化单行 `<归档名>.attestation.json` 与 64-byte Ed25519 `<归档名>.attestation.sig`。证明精确绑定归档文件名、SHA-256、字节数、来源 ID、来源数据库/桶、backup tool release、UTC 创建时间和签名公钥 DER SHA-256 指纹。
- 若设置了可读的 `FIATLUX_ENV_FILE`，额外生成 age 加密的部署配置与发布状态副本，并为该密文生成独立的 attestation 与签名。

生产备份默认先停止 Caddy、API 和 worker，待数据库与对象桶归档及配置加密完成后恢复原先运行的服务。这段短维护窗口用于避免 PostgreSQL 记录与 MinIO 对象来自不同业务时点。`--allow-live-writes` 仅用于人工明确接受跨存储不一致风险的特殊场景。

不进入数据备份：age 私钥、备份 Ed25519 私钥、Docker 主机密钥、GitHub/LLM 服务端密钥的外部托管副本。它们必须独立托管。Caddy 内部 CA 丢失后可重新生成，但所有终端需要重新信任；如业务要求证书连续性，应由安全负责人另行加密托管 Caddy CA 卷，不能与 age 私钥或签名私钥存放在同一位置。

## 创建备份

开发环境允许未加密、未签名备份；生产环境同时强制 age 加密和 Ed25519 来源签名。首次部署在受控管理员设备生成签名密钥，私钥与 age identity 分开保管：

```sh
umask 077
openssl genpkey -algorithm ED25519 -out backup-signing-private.pem
openssl pkey -in backup-signing-private.pem -passin pass: \
  -pubout -out backup-signing-public.pem
openssl pkey -pubin -in backup-signing-public.pem -outform DER \
  | sha256sum
```

把公钥 DER SHA-256 通过不同于可写备份介质的批准渠道交给恢复批准人。生产主机上的私钥必须是非符号链接普通文件，精确权限 `0400` 或 `0600`；`backup.sh` 会验证它确为未加密 Ed25519 私钥，只经 stdin 送入一次性 backup-tools 容器，不把私钥内容放入 Compose 环境、命令行、归档或日志。

```sh
sudo install -o fiatlux -g fiatlux -m 0400 \
  backup-signing-private.pem /etc/fiatlux-choice/backup-signing-private.pem
sudo install -o root -g fiatlux -m 0640 \
  backup-signing-public.pem /etc/fiatlux-choice/backup-signing-public.pem
```

随后创建生产备份：

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
export BACKUP_SOURCE_ID=fiatlux-choice-prod-guangzhou
./scripts/backup.sh --require-encryption --require-signature
```

成功标准：命令退出码为 0，生成 `fiatlux-*.tar.gz.age`、数据归档的 `.sha256`、`.attestation.json`、`.attestation.sig`，以及 `*.config.tar.gz.age` 对应的 `.sha256`、attestation 与签名，并输出归档 SHA-256 和签名证明路径。任一签名步骤失败会清除本次未完成输出；只看到文件存在不代表备份成功。数据库 dump、对象镜像和明文 tar 只在 `BACKUP_SCRATCH_DIR` 中暂存；生产配置先复制到同一受保护 scratch 内的 owner-only 输入目录，再以单独只读目录挂载给配置备份容器，避免 Docker Desktop 单文件 bind 的所有权差异和扩大读取范围。最终备份目录只接收加密归档及其 sidecar。

生产必须把 `BACKUP_SCRATCH_DIR`、`RESTORE_SCRATCH_DIR`、`RESTORE_PRE_BACKUP_DIR` 和 `FIATLUX_MAINTENANCE_DIR` 显式放在受保护的主机路径。两个 scratch 和恢复前输出在正常运行期间可能含明文或密文，公司必须使用经批准的主机全盘/卷加密并限制为部署用户 `0700`；Docker 配置本身不能证明底层已加密。正常退出会清理，SIGKILL、宿主断电或文件系统故障仍可能留下明文。下次操作发现陈旧 scratch、partial 或维护锁会失败关闭，不会自动删除；操作人先保全日志、确认没有活跃进程，再按安全介质清除流程人工处置。

`backup.sh` 在检查和停止服务前原子取得稳定维护锁。backup、restore、upgrade、rollback 和生产 database bootstrap 共用 `FIATLUX_MAINTENANCE_DIR`，嵌套的 pre-backup 只在 token 精确匹配时可重入。不同归档目录也不能绕过锁；并发请求、陈旧锁和无法解释的 partial 均失败关闭。不得把删除锁写进定时任务。

把加密文件复制到与生产主机故障域不同的介质，并再次计算 SHA-256。传输和删除均记录操作人、时间、源/目标和校验值。

### 来源审批与 SHA-256

age 为密文提供完整性保护和保密性，但**不认证备份的创建者**：任何知道 age 公钥的人都可以为该接收者生成另一份有效密文。Ed25519 attestation 补上来源真实性与字段绑定，但只有在恢复人从独立批准渠道取得公钥指纹时才形成信任锚；若生产主机或签名私钥已失陷，攻击者仍可能签出伪造归档。签名也不替代破坏性恢复的人工批准和独立归档 SHA-256。因此，恢复不得自动信任与归档位于同一可写目录的 `.sha256` sidecar，也不得自动信任同目录中的公钥或指纹。审批人必须核对备份任务、时间、目标公司、介质、签名公钥指纹与两次独立计算结果，再通过受控审批记录确认归档 SHA-256 和允许的签名指纹。

定时恢复演练使用与备份目录分离的批准清单目录，例如：

```sh
sudo install -d -o root -g fiatlux -m 0750 /etc/fiatlux-choice/approved-backups
sudo install -o root -g fiatlux -m 0640 \
  /var/backups/fiatlux-choice/fiatlux-....tar.gz.age.sha256 \
  /etc/fiatlux-choice/approved-backups/fiatlux-....tar.gz.age.sha256
```

复制动作必须发生在审批完成后；批准目录不能指向备份目录，文件不能是符号链接。当前实现是主机文件 Ed25519 密钥，不是 HSM、企业签名服务或不可导出密钥；SHA-256 与公钥指纹的批准来源仍依赖独立审批渠道和目录权限。无法建立这条可信渠道时，生产恢复与定时演练都应失败关闭，不能以“age 已加密”或“旁边有签名”为由放行。

`restore-latest-drill.sh` 只会在完整数据归档中选择最新文件，显式排除时间通常更晚的 `*.config.tar.gz(.age)`，避免把配置密文误送入数据恢复。它会逐级验证批准清单、批准目录及其全部父目录：批准目录不得等于或位于可写 `BACKUP_DIR` 树中，不得使用符号链接，group/other 均不得有写权限；以普通部署用户运行时，该用户不得拥有或可写路径上的任何一级，以 root 手工运行时则要求整条信任路径均由 root 所有。文档中的 `root:fiatlux 0750` 目录和 `root:fiatlux 0640` 文件允许 `fiatlux` 读取但不能替换、改写或自行 `chmod`，符合该门禁。若通过 `BACKUP_EXPECTED_SHA256` 或 `BACKUP_SIGNING_PUBLIC_KEY_SHA256` 直接提供批准值，这些变量本身必须来自等价的受控、不可由部署用户修改的审批渠道。最新归档的 attestation/signature 默认取同名 sidecar；公钥取 `BACKUP_SIGNING_PUBLIC_KEY_FILE`，但最终仍以独立批准的 DER 指纹为锚。

部署主机完全丢失时，先在隔离管理员设备解密 `*.config.tar.gz.age`，人工检查其中的 `production.env` 和可选 `releases/` 状态，再以部署手册规定的所有者与权限安装。配置恢复不会由数据恢复脚本自动覆盖，避免把错误环境或旧凭据直接写入生产：

```sh
age --decrypt --identity age-identity.txt \
  --output config.tar.gz fiatlux-....config.tar.gz.age
tar -tzf config.tar.gz
```

解密前先用通用 verifier 核对配置密文签名、批准 SHA-256、来源和工具版本；示例参数与数据归档相同：

```sh
./scripts/verify-backup-attestation.sh \
  --file fiatlux-....config.tar.gz.age \
  --attestation fiatlux-....config.tar.gz.age.attestation.json \
  --signature fiatlux-....config.tar.gz.age.attestation.sig \
  --public-key /etc/fiatlux-choice/backup-signing-public.pem \
  --expected-signing-key-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-source-id fiatlux-choice-prod-guangzhou \
  --expected-source-database fiatlux_choice \
  --expected-source-bucket fiatlux-choice \
  --expected-backup-tool-release v1.0.0
```

检查清单后再提取；不得在共享终端、聊天目录或未加密临时目录长期保留明文配置。

## 独立恢复演练

演练不会接触当前项目卷。脚本创建名称以 `fiatlux-restore-` 开头的随机 Compose 项目，使用随机凭据和全新 PostgreSQL/MinIO 卷；恢复后依次执行 Drizzle 迁移、pg-boss 迁移和权限收敛，启动 API/worker。它从版本化 `packages/db/restore-acceptance.json` 取得精确业务表集合和 pg-boss schema version，并由单元测试强制该清单与 Drizzle 导出表及 `pg-boss` 依赖自带版本同步；迁移期望则直接从 `_journal.json`、连续 idx/tag、对应 SQL 文件及每个 SQL 的 SHA-256 派生。当前候选必须精确得到 38 张表、10 个 `0000`–`0009` 迁移、pg-boss schema 24、worker healthy 和 API database/queue/object-storage ready，不接受“表数大于零”或只看最后迁移时间。

对象恢复不是只核对数量：恢复容器会按归档中已通过内部 manifest 校验的每个对象路径，从目标桶逐个重新下载，比较字节数和 SHA-256，再检查目标桶文件数没有额外路径。只有所有对象逐项一致才原子写入带 `objectsVerified`、总对象数、总字节数和对象核验清单 SHA-256 的恢复报告；演练会再次核对报告、目标桶计数和 MinIO app/backup/restore 最小权限。任一对象缺失、额外或内容损坏均失败关闭。

```sh
./scripts/restore-drill.sh \
  --file /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --expected-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-source-id fiatlux-choice-prod-guangzhou \
  --expected-source-database fiatlux_choice \
  --expected-source-bucket fiatlux-choice \
  --expected-backup-tool-release v1.0.0 \
  --attestation /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age.attestation.json \
  --signature /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age.attestation.sig \
  --signing-public-key /etc/fiatlux-choice/backup-signing-public.pem \
  --expected-signing-key-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --identity /etc/fiatlux-choice/age-identity.txt
```

`KEEP_RESTORE_STACK=1` 只用于故障调查。保留后必须记录项目名，并在调查结束时确认名称前缀再清理：

```sh
COMPOSE_PROJECT_NAME=fiatlux-restore-... FIATLUX_ENV=development \
  ./scripts/compose.sh down --volumes --remove-orphans
```

报告保存在 `RESTORE_DRILL_REPORT_DIR` 的 `restore-drill-*.log`，容器恢复报告保存在其 `restore-reports/`。恢复报告还必须记录 `signatureVerified=true`、attestation SHA-256 和签名公钥指纹；同时记录备份时间、开始/结束时间、恢复点差异（RPO）、恢复用时（RTO）、表/对象数、迁移版本和异常。

发布候选可在明确指定的本地 production-like 栈上用一次性工作树 backup image 完成端到端证据演练。此脚本会短暂停止指定项目的写入服务、临时替换该项目的 backup image tag，完成后恢复原 tag 并删除测试密钥/归档/卷；严禁把它指向真实生产项目：

```sh
FIATLUX_ENV=production \
FIATLUX_ENV_FILE=/path/to/local-production-like.env \
COMPOSE_PROJECT_NAME=explicit-local-qa-project \
SIGNED_DRILL_BACKUP_IMAGE=local-working-tree-backup:test \
SIGNED_DRILL_CONFIRM=YES-I-UNDERSTAND \
  ./scripts/test-signed-backup-restore-drill.sh
```

输出的末行是可归档脱敏 JSON；仍须标记本地/工作树/非生产范围，不能把该确认 token 当作业务批准。

## 生产恢复

生产恢复是破坏性操作，必须经过人工批准并进入维护窗口。先确认目标数据库和桶名称；默认还会创建恢复前加密备份。

`--file` 所在的归档介质只作为恢复源读取，Compose 会把它挂载到 `backup-tools:/restore-source:ro`。恢复前备份必须写入独立的 `RESTORE_PRE_BACKUP_DIR`；生产环境文件必须显式设置该目录，并确保部署用户拥有 `0700` 可写权限、底层卷已加密且与归档源不重叠。脚本在拉取镜像、停止入口/API/worker 或任何数据库/对象桶修改前，会用归档大小的两倍加 64 MiB 作为恢复前备份目录和明文 scratch 的最低可用空间下限，并执行无内容写入探针。源目录只读或输出目录不可写时会失败关闭，不会把恢复前备份写回批准介质。

```sh
export FIATLUX_ENV=production
export FIATLUX_ENV_FILE=/etc/fiatlux-choice/production.env
# production.env must define RESTORE_PRE_BACKUP_DIR as a separate writable path
./scripts/restore.sh \
  --file /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --expected-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-source-id fiatlux-choice-prod-guangzhou \
  --expected-source-database fiatlux_choice \
  --expected-source-bucket fiatlux-choice \
  --restore-image-version v1.0.0 \
  --expected-backup-tool-release v1.0.0 \
  --attestation /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age.attestation.json \
  --signature /var/backups/fiatlux-choice/fiatlux-YYYYMMDDTHHMMSSZ.tar.gz.age.attestation.sig \
  --signing-public-key /etc/fiatlux-choice/backup-signing-public.pem \
  --expected-signing-key-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --release-manifest /srv/releases/v1.0.0/release-manifest.tsv \
  --manifest-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --expected-git-sha 0123456789abcdef0123456789abcdef01234567 \
  --identity /etc/fiatlux-choice/age-identity.txt \
  --confirm-database fiatlux_choice \
  --confirm-bucket fiatlux-choice \
  --approve YES-I-UNDERSTAND
```

脚本在任何 Compose pull、恢复前备份、停止服务、`dropdb` 或桶操作之前，先核对 Ed25519 公钥类型、独立批准的公钥指纹、规范化 attestation、签名、独立批准的归档 SHA-256、实际归档字节、来源与 backup tool release。随后把四列发布清单、独立清单 SHA-256、完整 Git SHA、clean checkout 与七镜像 digest 绑定，显式选择 `--restore-image-version`；恢复前备份写入独立的 `RESTORE_PRE_BACKUP_DIR`，也使用这个实际 image，并把相同版本写进 metadata。其余顺序为：恢复前备份 -> 停止入口/API/worker -> 切换并等待已核验的同-major PostgreSQL -> 复制归档到受保护 scratch -> 再次核对受审归档 SHA-256 -> 解密 -> 归档只读 inspect 与实际展开容量预检 -> 使用同一个 Go tar 解析器完整预检并提取 -> 核对逐文件清单和 formatVersion 2 来源 metadata -> `pg_restore --list`、数据库角色能力、MinIO 桶及随机探针读/写/删前置检查 -> 由一次性 `fiatlux_restore` 终止连接/重建数据库并通过 `pg_restore --role=fiatlux_migrator` 恢复对象 -> 替换对象桶 -> 从目标桶逐对象读回并核对路径、字节数和 SHA-256 -> 依次运行 `migrate`、`queue-migrate`、`database-permissions` -> 一致启动所选 MinIO/api/worker/web/gateway -> 核对 PostgreSQL 与五个应用/存储常驻容器的 image ID、健康与权限 -> 最后记录 `current`。backup 仍是按需容器。前置检查拒绝不会触发 Compose 或数据修改；进入维护窗口后的其他前置检查拒绝仍会保持应用停止，便于人工调查。

归档守卫只允许目录与普通文件；拒绝绝对路径、`..`、非规范路径、重复路径、符号链接、硬链接、字符/块设备、FIFO、sparse/其他成员、非空 link target、尾随非零数据，以及超过 `RESTORE_MAX_ARCHIVE_MEMBERS`（默认 200,000、硬上限 1,000,000）或 `RESTORE_MAX_EXPANDED_BYTES`（默认 100 GiB、硬上限 1 TiB）的归档。它先完整验证同一私有文件描述符，再写出任何成员；提取目录必须为空，目录固定为 `0700`，文件固定为 `0600`，不恢复归档 uid/gid、特权位或链接。内部 `manifest.sha256` 必须精确覆盖除自身外的所有普通文件，条目数使用同一个 `RESTORE_MAX_ARCHIVE_MEMBERS` 上限，单行最多 16 KiB，总大小最多 `min(条目上限 × 16 KiB, 64 MiB)`，不能引用归档外路径。

`RESTORE_MAX_EXPANDED_BYTES` 是安全上限，不是容量承诺。恢复先为复制/解密保留 `2 × 归档大小 + 64 MiB`，inspect 后再要求剩余空间至少为实际展开字节数 `+ 64 MiB`；不足时在提取和外部修改前退出。CI 用仅 64 MiB 的 `/tmp`、主机 scratch 成功展开 300 MiB payload，并用 128 MiB scratch 验证 fail-fast，避免再次把恢复能力错误绑定到容器 `/tmp`。

### formatVersion 2 与跨版本边界

恢复入口失败关闭，只接受 formatVersion 2；缺少 `sourceId` 的旧 formatVersion 1 归档和未知未来格式都会在破坏数据前拒绝。旧归档不能作为当前恢复验收证据，也不能通过跳过来源检查直接投入生产。升级到首个支持 v2 的版本前，脚本会先拉取并核验目标发布的七个镜像，再用目标版本的 backup image 生成 v2 升级恢复点；必须对这份新恢复点执行一次隔离恢复演练，旧的 2026-07-18 v1 演练不计入当前门禁。

把 postgres 纳入发布清单改变的是外部发布控制契约，不改变 formatVersion 2 数据归档：metadata 中的 `tools.postgres` 仍是 `pg_dump` 客户端版本，不是服务端镜像 digest；数据库服务端 digest 由七组件发布清单绑定。既有 v2 归档结构仍可由兼容的七组件恢复发布读取，并通过 `--expected-backup-tool-release` 核对原 backup 版本；旧六组件发布清单本身不会被新 verifier 接受。若已有正式批准的六组件生产版本，必须先发布并演练一个七组件桥接版本，不能手工给旧清单补行或改摘要。常规脚本拒绝 PostgreSQL major 变化；minor 回退还要求外部兼容性复核及显式 `--confirm-postgres-minor-rollback POSTGRES-MINOR-ROLLBACK-REVIEWED`，该 token 不等于审批证据。

升级恢复点用 target backup image，保证目标版本可读取；回滚前恢复点用当前/source backup image，供回滚失败时切回 source 版本恢复。若一致回滚已经成功，后来需要恢复 source 恢复点，必须检出 source 发布的受审 Git SHA，并向 `restore.sh` 提供 source 的发布清单、独立清单 SHA、`--restore-image-version` 与归档 metadata 中受审的 `--expected-backup-tool-release`。脚本会拉取、核验并实际运行该恢复版本，成功后才更新全局发布状态；手工只设环境 override 不再是受支持流程。长期每个发布候选都必须运行 `test-release-transition-security.sh`，并至少做一次相邻版本真实恢复演练。

PostgreSQL 与 MinIO 没有分布式事务。全部可执行前置检查已前移，错误 S3 凭据时数据库和桶 sentinel 均必须保持不变；但在真正替换阶段遇到宿主崩溃、磁盘或网络故障，仍可能形成部分恢复。此时保持全栈停机，保全日志和 pre-restore 恢复点，禁止开放应用或把半成品备份标作成功，再由批准人决定重跑完整恢复或回到 pre-restore 点。

归档只保存桶内对象，不保存 MinIO 内部卷的实现格式、身份数据库或服务内部元数据；跨版本 MinIO 内部卷不能靠普通归档恢复“原地升级”。必须使用受审版本重新初始化桶并通过对象级恢复；若目标 MinIO 无法读取现有对象，应停止流程并由批准人选择兼容版本或完整恢复点。

仅当目标数据库已经损坏、无法生成备份且审批人接受风险时，才可加 `--skip-pre-backup`。恢复失败时保持应用停止，先保全日志和现有卷，不要反复重试破坏性步骤。

## 定期任务验证

```sh
systemctl status fiatlux-choice-backup.timer
systemctl status fiatlux-choice-restore-drill.timer
journalctl -u fiatlux-choice-backup.service --since yesterday
journalctl -u fiatlux-choice-restore-drill.service --since '40 days ago'
```

备份从未实际恢复过，就不能视为有效备份。
定期恢复演练同样把归档源以 `/restore-source:ro` 挂载；`RESTORE_DRILL_REPORT_DIR` 保存演练日志和容器恢复报告，必须是独立可写且受保护的目录。若只读介质未配置该输出目录，演练会在启动隔离 Compose 前失败关闭。

## 签名密钥轮换与泄露处置

轮换时先生成新 Ed25519 密钥对，记录新旧公钥 DER 指纹、批准人、生效时间和可恢复归档范围。新备份只用新私钥；旧公钥必须保留到所有受保留期约束的旧归档过期或迁移完成。恢复某份旧归档时，批准记录必须明确选择该归档创建时的公钥指纹，不能用当前公钥替代。

怀疑私钥泄露时立即停止自动备份和恢复、隔离主机、保全日志并启动安全事件流程；吊销并轮换签名密钥不等于旧归档自动失效。逐份用事件发生前的独立 SHA-256、异介质副本、备份审计和创建时间重建可信度。没有足够证据的归档不得用于生产恢复。当前实现不支持 CRL/OCSP 或远程 HSM 撤销，这一限制必须记录在风险台账。
