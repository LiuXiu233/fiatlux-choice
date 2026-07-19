# 安全威胁模型

## 范围与假设

系统服务于 1–2 人极小团队，但不能因此省略权限、审计和恢复。目标是部署在受控中国境内办公内网；当前通过的是开发机 production-like QA，并非目标办公内网。互联网、LLM 提供商、GitHub、邮件及未来财税/银行适配器均视为外部不可信边界。

需保护的核心资产：

- 用户身份、会话、角色、关键权限和人工批准记录。
- 合同、劳动用工、财税发票、银行与现金流数据。
- 个人信息、附件、知识产权、合规研究和法律审阅记录。
- AI 提示词、模型输入输出、工具调用和人工修改审计。
- PostgreSQL、MinIO 对象、备份、恢复密钥和发布供应链。

信任边界：

```text
用户设备 | Caddy（TLS/CSP/安全头） | Web/API | 领域权限与审计 | PostgreSQL/MinIO
                       |
                       +-- worker/pg-boss -- 外部 LLM/GitHub/人工适配器
CI 运行器 -- GHCR/SBOM -- 内网生产主机
备份主机 -- 加密归档 -- 离线 age 身份保管人
```

## 主要威胁与控制

| 威胁 | 示例 | 预防/检测控制 | 剩余风险与责任人 |
| --- | --- | --- | --- |
| 账户接管 | 弱密码、会话窃取 | Argon2、HttpOnly/Secure/SameSite cookie、会话过期、登录限流、TLS、审计 | 极小团队应启用第二管理员恢复机制；产品负责人 |
| 引导凭据常驻 | 首次 seed 密码留在日常容器环境或被误重跑 | 独立一次性 seed 服务；API/worker 不接收引导密码；首次改密后清空配置，缺失密码时 seed 失败关闭 | 获批密码恢复仍需临时凭据和双重核对；系统管理员 |
| 越权与 IDOR | 普通成员读取合同或财务 | 服务端 RBAC、按公司作用域查询、默认拒绝、拒绝测试与审计 | 代码新增资源时需补权限矩阵；研发负责人 |
| 高风险自动执行 | LLM 发起付款、签署或处罚 | 工作流停在人工批准；适配器默认 manual/mock；不伪报成功 | 人工可能误批；审批人复核依据与金额 |
| Prompt injection | 文件或 GitHub 内容诱导顾问泄密/调用工具 | 外部内容标记不可信、工具白名单、按权限取数、输出事实/推断分离、全链路审计 | 模型仍可能给出错误建议；业务责任人复核 |
| 隐私外传 | 将个人信息或过量公司记录发送给 LLM | 数据最小化、递归字段/常见标识符脱敏、模型上下文 512 KB UTF-8 硬上限、工具审计只保存实际脱敏输出、供应商白名单、调用前授权 | 语义文本仍可能含未识别敏感信息；信息安全与合规负责人 |
| 恶意上传 | 脚本、超大文件、路径穿越、危险双扩展 | 大小限制；扩展名与声明 MIME 精确匹配；基于 NFKC 规范化检查路径/点段/控制字符/保留名；拒绝脚本、HTML/SVG、可执行、宏或 ODF 格式、generic octet-stream 和危险双扩展；随机对象键、私有桶、完成时大小/SHA-256 复核、下载权限、attachment 与 `nosniff` | allowlist 不能识别伪装内容或恶意 PDF/Office；Markdown/JSON 也只是非可信附件；尚无 magic 检测、反病毒、内容安全扫描或 DLP；管理员 |
| SQL/命令注入 | 搜索、报表、脚本参数 | 参数化 ORM、输入 schema、脚本名称白名单、不拼接 shell 密钥 | 复杂报表需专项测试；研发负责人 |
| 官方来源抓取 SSRF/内容投毒/资源耗尽 | 恶意 URL、DNS 重绑定、私网重定向、压缩炸弹、超大正文 | 精确官方主机白名单、每跳 DNS 公网校验并固定连接地址、最终 HTTPS、GET-only、15 秒/2 MiB 上限、拒绝意外压缩、组织+来源租约 | 官方站自身被入侵或内容误发仍需人工复核；信息安全与合规负责人 |
| 审计篡改 | 管理员删除不利记录 | 应用无更新/删除审计接口；runtime 无 UPDATE/DELETE/TRUNCATE/TRIGGER、不是所有者且无法 SET ROLE；触发器 ENABLE ALWAYS；异机备份与异常告警 | migrator/bootstrap 或 Docker 主机管理员仍可显式绕过；公司负责人双人复核 |
| 数据库常驻高权 | API/worker 被攻陷后执行 DDL、建库、建角色或禁用触发器 | bootstrap/migrator/runtime/backup/restore 分离；常驻服务仅 runtime；pg-boss migrate=false；部署验证查询实际 role flags 与对象权限 | runtime 对多数业务表仍有模块化单体所需 DML，应用组织隔离依赖服务端 RBAC；研发与运维负责人 |
| 服务暴露 | DB/MinIO 监听办公网 | 只有 Caddy 发布端口、backend internal 网络、主机防火墙、部署验证 | Docker 配置变更可重新暴露；运维负责人 |
| 绕过安全网关 | 直接暴露 Web/API，缺失 CSP 或 TLS 边界 | 生产 Compose 只发布 Caddy；Caddy 注入 CSP/HSTS；浏览器验证响应头 | Fastify Helmet 单独关闭 CSP，绕过 Caddy 就没有同等保证；运维负责人 |
| 恶意或伪造备份 | 路径穿越、symlink/hardlink/device/FIFO、展开炸弹，或攻击者用公开 age recipient 生成替换密文 | 独立受审归档 SHA-256；同一 Go parser 先全量检查再安全提取；仅目录/普通文件；成员数/展开大小/逐文件完整覆盖清单 | 尚无备份数字签名；审批渠道或 Docker 主机失陷仍可绕过；公司与安全负责人 |
| 备份不可恢复 | 文件存在但损坏或无密钥 | manifest、age、每日备份、每月独立恢复演练、RPO/RTO 记录 | 同城灾害需异地介质；公司负责人 |
| 供应链攻击 | 恶意依赖、mutable 源码 tag、Action/镜像 tag 被替换 | lockfile、第三方 Actions 完整 commit SHA、MinIO/mc commit+tarball SHA-256、依赖审计、CodeQL、Trivy、Gitleaks、SBOM、BuildKit provenance、七组件受审 digest 清单 | provenance 不是签名；尚无 cosign/Sigstore；固定 SHA 仍需 Dependabot/人工更新；研发负责人 |
| PWA 缓存泄漏 | 共用设备离线看到旧公司数据 | service worker 不缓存 API/私有页面；所有 `/api/*` 响应统一 `Cache-Control: no-store`；退出清缓存、设备锁屏和磁盘加密 | 受管设备仍需限制浏览器配置、下载文件和截图；前端负责人 |
| 日志泄密 | token、身份证号进入日志 | 字段白名单、日志脱敏、轮转、访问控制、外发前人工复核 | 异常堆栈可能含输入；运维负责人 |

## 滥用场景

1. 顾问读取上传合同中的恶意指令并尝试调用 GitHub 或付款工具。预期：文档内容仅作为不可信事实来源；未授权工具不可见；高风险动作只能生成待审批建议。
2. 成员修改请求中的 `companyId` 访问另一公司数据。预期：服务端从会话作用域确定公司，拒绝并写审计。
3. 管理员误把 MinIO 控制台发布到 `0.0.0.0`。预期：生产 Compose 无 MinIO ports；部署验证发现非网关宿主端口。
4. 升级迁移、PostgreSQL binary 或 MinIO 跨版本破坏兼容性。预期：升级前加密备份；expand/contract；七组件一致切换但不执行数据库 schema 降级；常规流程禁止 PostgreSQL major 变化，minor 回退要求独立人工兼容复核；应用 schema、数据库数据目录或 MinIO 数据格式不兼容时停止并完整恢复。
5. 攻击者取得加密备份但没有 age 身份。预期：无法读取；身份独立离线保存。若生产主机与身份同时失陷，需按数据泄露事件处理。反向场景中，知道公开 age recipient 的攻击者能生成另一份有效密文，因此恢复仍必须匹配独立受审 SHA-256。

## 明确不覆盖

- 本系统不是银行、税务、电子签章或政务系统，不代表外部操作已经完成。
- mock/manual 适配器不提供真实外部交易保证。
- 当前 `LLM_DRIVER=mock`、`GITHUB_INTEGRATION_MODE=manual`；只验证流程和边界，不验证真实模型质量或真实 GitHub 读取。
- Caddy 内部 CA 不替代企业完整 PKI；较大部署应接入正式内部 CA。
- 单主机 Compose 不提供主机级高可用；通过可靠硬件、异机备份和可接受 RTO 管理风险。
- 法律、财税与 AI 建议都需有资质人员复核，系统输出不构成正式法律或税务意见。
- 当前 73 条合规来源全部是 pending/pending_fetch/draft，没有专业复核批准；新增健康素养来源也不是医疗诊断或电竞训练时长处方。

## 复核触发条件

新增公网入口、移动端原生应用、新 LLM 供应商、银行/税务/电子签章接口、跨境数据、超过当前团队规模、处理敏感个人信息或发生安全事件时，必须更新本模型并重新执行安全测试。
