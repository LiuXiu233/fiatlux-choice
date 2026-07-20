# 真实 LLM 与 GitHub 适配器验收手册

## 1. 目的与完成边界

本手册用于关闭 V1 的 `real_llm_github_adapters` 门禁。它只适用于目标内网中的最终候选提交，不适用于本地 mock、匿名 GitHub 读取、供应商控制台截图或单独的“连接成功”提示。

门禁至少需要同时证明：真实模型能够执行七类业务顾问并形成完整审计；GitHub 使用绑定单一仓库的最小只读凭据；公司数据处理条件、质量和成本已复核；两类凭据均完成撤销、替换与恢复；`disabled`／`manual` 回退不发起网络请求；证据不含密钥；独立公司批准与机器报告引用一致。

仓库内的 verifier 不持有凭据，也不会调用模型、GitHub、目标应用或审批系统。它只能验证候选身份、会话结构、文件权限、附件字节数/SHA-256 和有限文本密钥模式。因此机器报告成功仍不等于门禁通过，报告永久保留 `approvalIndependentlyVerified=false`。

## 2. 运行时密钥隔离

生产 Compose 只向 worker 注入 `LLM_API_KEY` 与 `GITHUB_TOKEN`。API 只接收非密钥模式和模型元数据，并把真实探测任务排入 `integration.test` 队列；`scripts/verify-deployment.sh` 会拒绝 API 容器出现这两个变量。

worker 的批准配置如下：

```dotenv
LLM_DRIVER=compatible
LLM_BASE_URL=https://approved-provider.example/v1-gateway
LLM_PROVIDER_ID=approved-provider-cn
LLM_API_KEY=<仅由受控秘密系统注入>
LLM_MODEL=<批准的精确模型名>
LLM_MAX_OUTPUT_TOKENS=2048

GITHUB_INTEGRATION_MODE=read_only
GITHUB_TOKEN=<仅由受控秘密系统注入>
GITHUB_PROBE_REPOSITORY=LiuXiu233/fiatlux-choice
```

`LLM_PROVIDER_ID` 是进入模型调用审计的非密钥稳定标识，不得含 `mock`、`simulated` 或 `disabled`。`LLM_BASE_URL` 必须使用 HTTPS，且不能包含 userinfo、query 或 fragment。`LLM_MAX_OUTPUT_TOKENS` 是单次请求硬上限；它不能替代供应商账户级月度硬预算。

`GITHUB_INTEGRATION_MODE=read_only` 同时要求 token 和批准的探测仓库。建议使用有明确到期日的 fine-grained PAT 或 GitHub App installation token，只选择目标仓库，仅保留 GitHub 自动要求的 Metadata read；Contents、Actions、Administration、Issues、Pull requests、Workflows 和 Members 均保持无权限。不得用 classic PAT 的宽泛 `repo` scope 作为 V1 最小权限证据。

worker 会拒绝以下组合并停止启动：

- `mock`／`disabled` 仍携带 `LLM_API_KEY`；
- `manual` 仍携带 `GITHUB_TOKEN`；
- `read_only` 缺少 token 或 `GITHUB_PROBE_REPOSITORY`；
- compatible 模式缺少 HTTPS endpoint 或 API key。

## 3. 供应商和数据处理预审

在发送任何公司记录前，由信息安全和公司责任人记录并复核：

- 供应商主体、合同/订单、处理地域、分包商和事件通知；
- 输入输出保存期限、删除路径、日志保留和客户数据训练开关；
- 是否发生个人信息或重要数据出境，以及适用的人工法律复核结论；
- 退出供应商、删除数据和导出审计记录的能力；
- 精确模型、价格版本、上下文/输出限制、账户月度硬上限和告警阈值。

验收样本只能使用经过人工脱敏的真实公司记录，不得包含身份证号、银行卡、账号口令、完整合同秘密、无关个人信息或敏感个人信息。供应商条款和法律结论可能变化，引用、适用条件、复核时间和附件哈希必须进入会话，不得硬编码为永久事实。

## 4. 目标环境执行顺序

### 4.1 准备证据目录

在受控管理员主机上创建相互隔离、由当前操作者拥有的目录：

```bash
umask 077
mkdir -m 0700 /secure/fiatlux-real-adapters-evidence
mkdir -m 0700 /secure/fiatlux-real-adapters-reports
mkdir -m 0700 /secure/fiatlux-real-adapters-evidence/captures
```

会话 JSON 和所有附件必须由当前操作者拥有且不得向 group/other 开放。报告目录必须预先存在并精确为 `0700`；verifier 不会替操作者创建或放宽目录。

### 4.2 真实连接探测

在设置页分别点击 LLM 和 GitHub 验证。HTTP `202` 和 `status=queued` 只表示任务已交给 worker。等待状态变为 `healthy` 后记录 `integration_checks.id`：

- LLM 探测实际调用批准模型，要求返回顾问结构，并核对 provider、endpoint、model、正数 token 用量和耗时；
- GitHub 探测以带 token 的 `GET /repos/{owner}/{repo}` 读取 `GITHUB_PROBE_REPOSITORY`，拒绝重定向并核对返回仓库身份；
- `healthy` 只证明本次结构化调用或仓库读取，不证明模型业务质量、供应商合规或 token 没有额外权限。

### 4.3 七类顾问质量样本

为总经理、财务、法务合规、产品研发、市场机会、人力行政和信息安全顾问分别创建一条真实运行。每条至少选择一条有权限、已脱敏且适合该顾问的公司记录，并保存：

- `advisor_runs.id`、`advisor_model_calls.id`、`prompt_versions.id`；
- provider、endpoint、model、完成状态、input/output token 和 latency；
- `company_data.read` 工具调用 ID、引用数量和原始响应审计存在性；
- 事实依据、事实/推断分离、可执行性、安全边界和证据可追溯性五项 1–5 分复核；
- 每项至少 4 分、明确复核人/角色/时间和非空说明。

至少对其中一条已完成运行执行一次有理由的人工修改，保存 `advisor_edits.id`、对应 `audit_events.id`、编辑人、时间，以及 before/after 和 reason 均已保留的证明。不能为了通过验收而删除失败模型调用或覆盖原始输出。

### 4.4 GitHub 刷新证据

对批准仓库创建 GitHub 情报记录并触发真实刷新。保存 insight ID、system actor 的 `refresh` audit event ID、请求/返回仓库、时间和脱敏 payload。人工导入、匿名公开读取、其他仓库的成功读取或 `rate_limit` 200 都不能替代该证据。

### 4.5 撤销、轮换和回退

分别对 LLM 与 GitHub 使用短期验收凭据执行以下顺序：

1. 记录旧凭据的单向 SHA-256 指纹，不记录原文；
2. 在权威供应商系统撤销旧凭据；
3. 再次探测并取得 `unhealthy` 检查 ID，确认响应、数据库和审计均无密钥；
4. 将 LLM 切换为 `disabled` 并清空 `LLM_API_KEY`，将 GitHub 切换为 `manual` 并清空 `GITHUB_TOKEN` 与 probe repository；重启 API/worker；
5. 对两项执行设置页检查，分别取得 `disabled` 与 `manual`，并证明没有外部网络调用；
6. 创建权限不扩大的新短期凭据，更新秘密系统后恢复 compatible/read_only；
7. 取得两个新的 `healthy` 检查 ID；新旧指纹必须不同。

撤销/轮换应使用专门的短期验收凭据，不能未经批准撤销仍被其他生产系统使用的共享凭据。应用不会调用供应商撤销接口，也不会伪造撤销成功。

## 5. 会话 JSON 与附件

先在受保护目录独占创建一份故意失败关闭的模板：

```bash
pnpm delivery:real-adapters:template -- \
  --output /secure/real-adapter-session.json
```

命令拒绝相对路径、非 `0700` 父目录和已有目标，并以 `0600` 创建文件。模板中的 `REPLACE_WITH_*`、零分、零 token、false 和重复 ID 都是有意设置，未经真实执行和逐字段替换不能通过校验。

会话必须通过 `realAdapterAcceptanceSessionSchema`。固定检查顺序为：候选/目标身份、worker-only 密钥、真实 LLM 结构、顾问范围与审计、质量复核、数据处理、成本、GitHub 真实读取、GitHub 最小权限、撤销轮换、disabled/manual 回退、密钥清理。

至少准备以下脱敏附件并在 `checks[].artifactIds` 中引用：

- 目标运行时配置键名与容器环境 allowlist，不含值；
- 七类运行、模型调用、提示词、工具调用、引用和人工编辑的脱敏导出；
- 供应商数据处理/条款人工复核；
- 精确价格版本、账户硬预算与告警设置；
- GitHub selected-repository 和 Metadata-only 权限证明；
- 两类撤销失败、替换恢复以及 disabled/manual 无网络回退记录；
- 对会话与全部可读附件执行的密钥扫描结果。

附件允许 JSON、PDF、JPEG、PNG、CSV 和纯文本。verifier 会对 JSON/CSV/纯文本额外检查常见 Authorization、GitHub token、`sk-` key、私钥和非空密钥赋值；图片/PDF 只验证字节与哈希，仍须人工确认画面没有敏感信息。

## 6. 离线机器校验

所有字段和 SHA-256 填写完毕后，把会话文件权限设为 `0600`，再从独立批准记录复制期望身份到命令行：

```bash
chmod 0600 /secure/real-adapter-session.json
pnpm delivery:real-adapters:verify -- \
  --session /secure/real-adapter-session.json \
  --evidence-root /secure/fiatlux-real-adapters-evidence \
  --report-dir /secure/fiatlux-real-adapters-reports \
  --expected-version v1.0.0 \
  --expected-git-sha <40位候选SHA> \
  --expected-url https://choice.internal.example:8443 \
  --expected-environment-id <目标环境稳定ID> \
  --expected-llm-provider <批准的provider-id> \
  --expected-llm-endpoint <批准的HTTPS endpoint> \
  --expected-llm-model <批准的精确model> \
  --expected-github-repository LiuXiu233/fiatlux-choice \
  --json
```

成功报告使用会话 ID 和候选 SHA 的确定性文件名、权限 `0600`，目标或 partial 已存在时拒绝覆盖。保留会话、附件、原始报告和报告 SHA-256；不要把含内部标识或供应商材料的原始包提交 GitHub。

## 7. 更新 V1 门禁

机器报告完成后，另一名有权责任人通过独立渠道核对：候选 SHA/环境、原始附件、供应商条款和预算、GitHub 权限、撤销控制台事实、质量评分、报告 SHA-256，以及批准记录。随后才可在 `v1-release-readiness.json` 中为该门禁加入绑定候选 SHA 的成功 `machine_evidence` 和同一批准引用的成功 `approval`。

任一下列情况必须保持 `blocked`：没有真实凭据或目标环境；七类顾问未全部运行；token 用量缺失；只做 mock/匿名/`rate_limit` 探测；GitHub 有任何写权限或多仓库范围；未设置供应商硬预算；未做两类撤销轮换；没有 disabled/manual 无网络回退；批准未独立核对；附件或报告含密钥。
