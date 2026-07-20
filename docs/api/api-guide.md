# FIAT LUX CHOICE API 指南

## 1. 入口与版本

| 用途 | 路径 |
| --- | --- |
| API 基础路径 | /api/v1 |
| Swagger UI | /api/docs |
| 综合健康 | /health |
| 存活检查 | /health/live |
| 就绪检查 | /health/ready |

示例使用 https://choice.internal.example:8443。开发环境通常由 Vite 把 /api 代理到 API。

当前生成的 OAS 3.1 文档是受控候选契约；最终 path/operation 数量与 parser、运行时路由逐项对账结果必须在代码冻结后重新生成和复跑，不沿用此前候选统计。发布流程还需加入版本间 compatibility diff，定义弃用窗口，并生成、验证和发布受支持 SDK；在这些闸门完成前不要把临时生成的客户端当作官方 SDK。

## 2. 认证

API 使用名为 fiatlux_session 的 HttpOnly Cookie。Cookie path 为 /api/v1，SameSite=Strict；生产必须开启 Secure。浏览器请求需要 credentials。

登录：

~~~sh
curl --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie-jar /tmp/fiatlux.cookies \
  --data '{"email":"admin@example.com","password":"REPLACE_WITH_REAL_PASSWORD"}' \
  https://choice.internal.example:8443/api/v1/auth/login
~~~

读取当前会话：

~~~sh
curl --cookie /tmp/fiatlux.cookies \
  https://choice.internal.example:8443/api/v1/auth/me
~~~

退出会撤销 sessions 表记录并清除 Cookie：

~~~sh
curl --request POST \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  https://choice.internal.example:8443/api/v1/auth/logout
~~~

已登录用户改密：

~~~sh
curl --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  --data '{"currentPassword":"REPLACE_CURRENT","newPassword":"REPLACE_WITH_14_PLUS_CHARACTERS"}' \
  https://choice.internal.example:8443/api/v1/auth/change-password
~~~

首次 seed 新建的 owner 和 `POST /users` 新建的成员都设置 `mustChangePassword=true`；重复 seed 只补齐系统数据，不覆盖既有 owner 的密码。新成员须先通过角色审批成为 active 才能登录。带 `mustChangePassword` 的会话在改密前只允许 `GET /auth/me`、`POST /auth/change-password` 和 `POST /auth/logout`，其他受保护路由返回 403。

新密码至少 14 位且必须不同于当前密码。成功会把 `mustChangePassword` 清为 false，保留发起改密的当前会话，并撤销该用户的其他未撤销会话；当前没有自助忘记密码或恢复码 API。

不要把 Cookie、密码或响应中的敏感数据写入仓库、工单和 shell 历史。生产集成应使用受控秘密注入和短期会话。

## 3. 请求安全

- POST、PUT、PATCH 和 DELETE 如果带 Origin，必须与 WEB_ORIGIN 完全一致。
- 全局限流默认每分钟 300 次；登录每分钟 8 次。
- 客户端可以发送 X-Request-Id；服务端错误也返回 requestId，便于审计和日志关联。
- 不要在请求体传 orgId 来改变作用域，服务端只信任会话。
- CORS 只允许配置的 Web origin 并携带凭据。

## 4. 响应格式

单条或动作成功：

~~~json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000000"
  }
}
~~~

列表：

~~~json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "pageCount": 0
  }
}
~~~

错误：

~~~json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": {},
    "requestId": "req-1"
  }
}
~~~

常见状态：400 输入错误，401 未登录或会话失效，403 权限或 Origin 拒绝，404 不存在或不在当前组织，409 版本/状态冲突，503 依赖未就绪。

## 5. 列表与搜索

通用查询参数：

| 参数 | 默认 | 边界 |
| --- | --- | --- |
| page | 1 | 最小 1 |
| pageSize | 20 | 1–100 |
| search | 无 | 最长 200 字符 |
| status | 无 | 资源支持的状态 |
| category | 无 | 资源支持的类别 |

不同资源对 search、status 和 category 的实现程度不同。调用方应把未知过滤结果视为接口契约问题，不在客户端模拟安全过滤。

## 6. 通用资源端点

以下资源使用通用资源路由框架；除下文列出的通知特殊边界外，提供 `GET /资源`、`POST /资源`、`GET /资源/:id`、`PATCH /资源/:id` 和 `DELETE /资源/:id`：

| 路径资源 | 业务名称 |
| --- | --- |
| objectives | 目标 |
| projects | 项目 |
| tasks | 任务 |
| decisions | 决策 |
| obligations | 公司义务 |
| compliance-items | 合规知识 |
| compliance-events | 合规日历 |
| risks | 风险 |
| contracts | 合同 |
| financial-entries | 收支 |
| invoices | 发票 |
| cash-flow | 现金流 |
| products | 产品 |
| opportunities | 市场机会 |
| github-insights | GitHub 情报 |
| notifications | 通知 |
| workflow-definitions | 工作流定义 |
| workflow-runs | 工作流运行 |

POST 使用对应 create schema。PATCH 使用 create schema 的部分字段，并强制 expectedVersion。DELETE 使用查询参数 expectedVersion，并执行软归档。

通知不是普通全量 CRUD。`POST /notifications` 只允许创建 `status=queued` 的记录（省略时也默认为 `queued`），客户端不能创建 `sent`/`failed` 来伪造投递结果。member/viewer 的 `GET /notifications` 和 `GET /notifications/:id` 只返回当前用户作为 recipient 的记录，跨收件人读取表现为 404；标记本人站内通知已读必须使用 `POST /notifications/:id/read` 并提交 `expectedVersion`。只有具有 `notifications:manage` 的 admin/owner 能跨收件人创建、查看和归档通知；任何角色都不能用 `PATCH /notifications/:id` 改写标题、正文、收件人或投递事实，只有 worker 能把 `queued` 更新为 `sent` 或 `failed`。合规监控 worker 已在处理来源的同一事务中原子完成其系统站内通知的 `queued → sent`，不代表外部邮件或企业协作渠道送达。

`POST /notifications` 和 `POST /workflow-runs` 除写入记录外还会投递后台任务；队列不可用时 API 返回 503 并尽力把新记录标为 failed。201 只说明记录已创建并成功入队，不能解释为通知已经送达或工作流已经完成。

不属于上述通用 CRUD 的已知路由：

| 路由 | 说明 |
| --- | --- |
| GET /dashboard | 组织经营摘要 |
| GET /audit-events、GET /audit-events/:id | 只读审计 |
| GET/POST /users、PATCH /users/:id | 成员管理；创建成员同时生成初始角色审批 |
| GET /roles、POST /role-assignments | 读取角色与申请角色变更 |
| GET/POST /approvals、GET /approvals/:id、POST /approvals/:id/approve、POST /approvals/:id/reject | 人工审批 |
| GET/POST /external-actions、GET /external-actions/:id、POST /external-actions/:id/transition | 外部动作真实性状态机 |
| POST /github-insights/:id/refresh | 仅在批准的 read-only GitHub 模式排队刷新；服务端保存当前版本快照，见下文 |
| GET /compliance-items/monitoring-status | 按会话组织只读汇总来源监控与人工复核工作量；需要 `compliance-items:read` |
| POST /compliance-items/:id/monitor | 有 `compliance-items:update` 权限者人工排队检查白名单官方来源；可选 body 为 `{ "reason": "..." }`，202 只代表已排队 |
| GET /compliance-items/:id/snapshots | 读取该官方来源追加式监测快照历史 |
| GET /compliance-items/:id/reviews | 按页读取追加式专业复核历史；需要 `compliance-items:read` |
| POST /compliance-items/:id/reviews | 登记版本绑定、证据支持的专业复核；需要 `compliance-items:update` 与 `files:read` |
| GET /settings/integrations、POST /settings/integrations/:id/test | 集成边界和连接探测 |
| GET/POST /backups | 查看或排队备份任务 |
| GET /operations/incidents | 按组织列出顾问、工作流和备份的 `lease_expired` 人工处置事项 |
| POST /operations/incidents/:id/resolve | 追加证据化人工调查结论；不重放或修改原失败运行 |
| GET /advisors、提示词版本和 advisor-runs 路由 | 权限感知顾问与审计，详见第 11 节 |

OAS 3.1 是当前候选的机器可读接口清单；运行时 Zod/领域校验仍是实际执行边界。发现文档与运行时不一致时应作为契约缺陷处理并阻断兼容性发布，不能在客户端静默猜测。

`GET /compliance-items/monitoring-status` 返回 `generatedAt`、八项非负计数、`oldestDueAt`、`nextFutureMonitorAt` 和可空的 `latestDispatch`。计数分别聚合未归档来源、当前可领取到期来源、有效租约、`pending_fetch`、`failed`、`changed`、`stale` 和已过下次复核日的 `reviewed` 来源；集合可能重叠。`latestDispatch` 只接受可验证的 `occurredAt/batchLimit/dueCount/queuedCount/hasMoreDue`，并强制 `queuedCount <= dueCount`；旧审计缺字段或结构无效时返回 `null`，不会补造事实。该 GET 不写审计、不排队、不改变来源，且只读取会话组织的数据。

人工监控 POST 响应包含 `sourceId`、`jobId` 和 `status=queued`。同一组织、同一来源已有有效租约时，重复请求复用在途 job，不会二次抓取。实际成功、变化、失败或陈旧结果丢弃必须查看来源字段与审计事件，不能把 HTTP 202 当作官方网页已抓取或政策已人工复核。人工复核到期、已有正文哈希变化和连续第三次失败会由 worker 在来源更新事务中创建一条 `todo/high` 任务：执行时仍为有效成员且仍有 `compliance-items:update` 或通配权限的人工触发者优先成为协调责任人，否则确定性选择最早加入的有效 owner；同时原子送达一条站内通知。来源事件 metadata 的 `escalationTaskId`、`escalationNotificationId`、`escalationAssigneeId` 和 `assignmentStrategy` 分别指向任务、通知、协调人和选择策略。任务或通知出现仍只表示需要人工处理，不表示协调人具有专业资质、来源已经复核或问题已经解决。

专业复核不能走通用 `POST/PATCH /compliance-items`。专用 POST 必须提交当前 `expectedVersion`、结论、来源生命周期、复核人姓名/角色/机构、胜任依据、同组织 `uploaded` 证据文件、适用条件、摘要、缺失信息、下一复核日和登记原因。例如：

~~~json
{
  "expectedVersion": 3,
  "reviewOutcome": "applicable",
  "resultingStatus": "active",
  "reviewerName": "真实复核人姓名",
  "reviewerRole": "公司治理法律顾问",
  "reviewerOrganization": "复核人所在机构或内部组织",
  "reviewerQualification": "与本来源相关的执业、岗位、项目经验或内部授权依据",
  "evidenceFileId": "00000000-0000-4000-8000-000000000000",
  "applicability": "在已核对的主体、地域、行为和公司事实条件下适用。",
  "summary": "已核对官方来源版本、效力线索和公司事实。",
  "missingInformation": "暂无已知缺失信息；公司事实变化时必须重新复核。",
  "nextReviewAt": "2027-01-20",
  "reason": "登记本次可追溯专业意见，供后续义务和顾问上下文使用。"
}
~~~

`applicable`/`not_applicable` 必须配合 `active|superseded|repealed`；`changes_required`/`insufficient_information` 必须保持 `uncertain`。复核日必须在当前时点之后且不超过 366 天。API 在单一事务锁定来源版本、内容/元数据哈希、证据和站内登记人，并追加 `professional_review` 审计；版本冲突返回 409。旧意见仍从 GET 历史读取，其证据即使不再是当前证据也禁止归档。201 只证明系统保存了某人登记的意见和证据，不证明资质、结论正确或外部机构批准。

`obligations` 和 `compliance-events` 都可选填 `sourceId` 与 `evidenceFileId`。`sourceId` 必须指向同一组织内未归档的合规来源，但建立引用不代表该来源已经完成适用性、现行有效性或专业复核；`evidenceFileId` 必须指向同一组织内未归档且状态为 `uploaded` 的文件，被义务或合规日历引用后不能归档。证据为空不会自动阻止业务状态更新，调用方仍必须按人工复核流程确认完成事实并保存外部凭证。

`POST /github-insights/:id/refresh` 不接收客户端自行声称的版本。API 读取当前 insight 版本，将其作为 `expectedVersion` 写入 job，并在 202 响应中返回 `insightId`、`repository`、`expectedVersion` 和 `status=queued`。worker 在读取目标和写回结果时都校验该版本并使用 CAS；重复 job 或排队后发生人工更新时，陈旧结果会被丢弃，不能覆盖新数据，也不能被记为一次成功刷新。

`POST /workflow-runs` 只接受当前仍 enabled、未归档的 definition。API 在创建时验证发起人具备每一步所需权限，并在同一事务保存 `definitionVersion` 和 `stepsSnapshot`；worker 只执行这份不可变快照，因此定义后续修改不会改变已经排队的 run。缺少快照的旧运行失败关闭，不会回读最新定义继续执行。

创建任务：

~~~sh
curl --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  --data '{"title":"核对首期课程退款条款","status":"todo","priority":"high"}' \
  https://choice.internal.example:8443/api/v1/tasks
~~~

更新任务：

~~~sh
curl --request PATCH \
  --header 'Content-Type: application/json' \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  --data '{"status":"done","expectedVersion":1}' \
  https://choice.internal.example:8443/api/v1/tasks/00000000-0000-4000-8000-000000000000
~~~

发生 409 时重新 GET 记录，对比 version 后人工合并。不要盲目增加 expectedVersion。

## 7. 数据约定

### ID

业务 ID 使用 UUID。

### 日期时间

接受带时区的 ISO 8601 字符串，也接受不带时区的中国本地时间并转换为 +08:00。仅日期字段转换为当天 00:00:00+08:00。集成方最好始终显式发送时区。

### 金额

API 的 amountCents、taxAmountCents 和 valueCents 使用整数分，不使用浮点元。例如 100.25 元发送 10025。currency 是三位大写代码，V1 主要使用 CNY。

### 版本

可变记录从 version 1 开始。更新和归档必须使用当前 expectedVersion。

### 归档

DELETE 通常设置 archivedAt，不物理删除。列表和单条读取默认排除已归档记录。

### 业务关系

除 `projects.objectiveId` 和 `tasks.projectId` 外，类型化引用还包括 `decisions.objectiveId/projectId/taskId`、`products.projectId` 以及 `opportunities.productId/projectId`。API 会校验引用属于当前组织且目标未归档，并执行以下组合规则：

- decision 同时填写 objective/project/task 中任意两项或三项时，已填写项必须来自同一条活动 objective→project→task 链；只填一项仍允许。
- opportunity 同时填写 product 和 project 时，product 必须已归属该活动 project；只填一项仍允许。
- PATCH 按“当前记录 + 本次 patch”的有效组合校验，不能用分次更新绕过；显式发送 `null` 可以解除可空关系。
- 若 project 改 objective、task 改 project 或 product 改 project 会破坏活动 decision/opportunity，API 返回 409。objective/project/task/product 仍有活动下游引用时也不能归档。

这些写入在组织级 PostgreSQL 事务 advisory lock 下串行化，工作流的 `create_task` 也使用同一锁并在事务内重新验证项目与负责人。该保证属于 API/worker 应用边界；拥有数据库写权限的特权管理员仍可直接绕过，任何紧急 SQL 修复都必须进入维护窗口、先备份、单独批准并补充一致性核对和审计证据。

## 8. 文件 API

### 第一步：声明元数据

POST /api/v1/files，提供 filename、contentType、sizeBytes、checksumSha256 和 classification。SHA-256 必须是 64 位小写十六进制。

响应包含 file 和 upload ticket。当前 ticket 指向受认证的 PUT /api/v1/files/:id/content。

### 第二步：上传内容

~~~sh
curl --request PUT \
  --header 'Content-Type: application/octet-stream' \
  --header 'Origin: https://choice.internal.example:8443' \
  --header 'Content-Length: 1234' \
  --cookie /tmp/fiatlux.cookies \
  --data-binary @document.pdf \
  https://choice.internal.example:8443/api/v1/files/00000000-0000-4000-8000-000000000000/content
~~~

API 在 50,000,000 字节上限内有界接收文件（约 47.7 MiB），在进入对象存储前检查真实内容，再核对声明的大小与 SHA-256。元数据创建只接受扩展名与声明 MIME 匹配的 PDF、纯文本/CSV/Markdown/JSON、常见无脚本图片和非宏 OOXML 等格式；HTML、SVG、脚本、可执行、宏或 ODF 格式、generic octet-stream，以及 NFKC 规范化后的路径/点段/控制字符/保留名和危险双扩展会被拒绝，重命名也执行同一策略。内容门禁要求文本为无二进制控制字节的有效 UTF-8、JSON 可解析、PDF/PNG/JPEG/GIF/WebP 具有对应格式信封；DOCX/XLSX/PPTX 还会校验 ZIP 中央目录与本地头一致、规范路径、条目/展开上限、`[Content_Types].xml`、根关系及对应主部件，并拒绝加密、ZIP64/分卷、宏、ActiveX、嵌入对象和常见可执行条目。失败发生在对象写入前，记录保持 `pending` 并写请求拒绝审计。Markdown/JSON 与其他格式一样只作为 attachment 返回，不能作为可信页面或代码解释。通过 PUT 后状态为 `stored`，尚不能下载。

该门禁是保守的格式与容器结构检查，不会完整渲染或语义解析 PDF/图片/Office 正文，也不是反病毒、内容安全、沙箱或 DLP。格式正确的恶意文档、多格式 polyglot 或未知解析器漏洞仍可能通过；用户必须只下载可信来源文件，并在受管终端使用已更新的阅读器。被拒绝的保守格式应转换为受支持的静态格式后重新上传，不得关闭门禁绕过。

### 第三步：完成校验

~~~sh
curl --request POST \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  https://choice.internal.example:8443/api/v1/files/00000000-0000-4000-8000-000000000000/complete
~~~

`POST /files/:id/complete` 是当前流程的必需步骤，不是未来扩展。API 通过对象存储 head 再次核对大小与 SHA-256，将状态改为 `uploaded`；下载端点只接受 `uploaded`。只有 uploader 或具有 `files:update` 权限的用户可以上传和 complete。下载在权限、组织、状态和对象读取成功后写入 `download_issued` 追加审计，再开始返回 attachment 流；该事件不声称客户端完整接收。

### 下载与归档

- GET /files/:id/download 返回受权限控制的附件流。
- PATCH /files/:id 可更新 filename、classification 和 expectedVersion。
- DELETE /files/:id?expectedVersion=1 软归档元数据。

合同和发票的 `fileId` 只接受当前组织中 `uploaded` 且未归档的文件。文件一旦被未归档合同或发票引用，归档会返回 409；引用创建/更新取得共享行锁，文件归档取得排他行锁并复核引用，两条事务会串行化，避免并发绕过。

单文件上限 50,000,000 字节。病毒查杀不在当前实现内；大型视频和赛事回放使用受控媒体存储。

## 9. 审批 API

| 方法与路径 | 作用 |
| --- | --- |
| GET /approvals | 列出审批 |
| POST /approvals | 创建一般人工审批 |
| GET /approvals/:id | 读取审批 |
| POST /approvals/:id/approve | 批准 pending 审批 |
| POST /approvals/:id/reject | 驳回 pending 审批 |

批准和驳回都要求非空 comment。申请人自批时，API 还要求 acknowledgement 的值为 SELF_APPROVAL_ACKNOWLEDGED；Web 只在识别到当前用户就是申请人时展示明确自批责任确认并发送该值。仍应优先使用双人复核。

角色分配使用 `POST /role-assignments` 创建 critical 审批，申请必须提交 membership 当前 `expectedVersion`、唯一 `idempotencyKey`、`membershipId`、`roleId`、`mode` 和原因。审批 payload 保存版本与幂等快照；批准时在事务内重新核对 membership 版本、当前角色关系和最后一个 owner 约束，任何并发变化都返回 409 并要求读取最新版本后重新申请。缺少版本或幂等快照的 legacy 角色审批失败关闭，不能直接批准生效。

成员停用/离职使用 `POST /users/:userId/lifecycle`，请求体如下：

~~~json
{
  "action": "deactivate",
  "reason": "临时停用并完成职责复核",
  "expectedVersion": 2,
  "idempotencyKey": "membership-change-20260718-001"
}
~~~

`action` 只能是 `deactivate`、`offboard` 或 `reactivate`。首次创建返回 201；相同 membership、幂等键和请求语义的重放返回原审批及 200，幂等键语义不一致或已有另一笔待审批申请返回 409。申请只创建 `critical` 审批，不立即改变成员。

- `deactivate`/`offboard` 只接受 `active`，批准时事务内重新校验状态、版本和最后 owner，再写入 `inactive`/`offboarded` 并撤销该用户在当前组织的全部未撤销会话。
- `reactivate` 只接受 `inactive`，批准后写回 `active`，但会再次确保本组织旧会话全部保持撤销；用户必须重新登录生成新会话。
- `offboarded` 不接受 `reactivate`，需要未来重新入职流程。驳回不改变成员或会话。

## 10. 外部动作 API

POST /external-actions 支持：

- bank_payment
- tax_filing
- invoice_red
- contract_sign
- contract_terminate
- hr_discipline
- permission_change
- external_legal_commitment

以上八类均为必须人工批准的高风险动作。创建 schema 的 adapter 只接受 `manual` 或 `mock`；提交 `real` 会在请求校验阶段被拒绝，因为当前没有合法稳定的真实执行适配器。每个动作必须提供至少 8 字符的 idempotencyKey 和原因，并从 pending_approval 开始。

状态大致为：

~~~text
pending_approval -> approved -> submitted -> confirmed
                         |           |
                         |           +-> failed -> submitted
                         +-> simulated
任一允许节点可按状态机进入 cancelled
~~~

POST /external-actions/:id/transition 记录状态变化。manual 进入 submitted 必须有 `evidence.externalReference`，进入 confirmed 必须有 `evidence.receiptReference`；mock 只能进入 simulated 或 cancelled。

`contract_sign`、`contract_terminate` 和 `invoice_red` 的 confirmed 不是两个可分离的写操作。服务端在同一事务中锁定并复核创建时保存的目标版本（签署/红冲还复核已上传文件快照），再分别把合同从 pending_signature 改为 active、合同从 active 改为 terminated、发票从 issued/received/paid 改为 red_confirmed，同时更新外部动作和审计；任一目标已变化则整体返回 409，不会留下“动作已确认但业务记录未更新”的半完成状态。

`bank_payment` 可在创建时关联金额匹配、状态为 `draft` 且尚未关联其他动作的 expense，系统会保存台账目标版本并把 `externalActionId` 作为受控关系写入。付款进入 `confirmed` 时，服务端在同一事务按该 snapshot/CAS 复核金额、状态、版本和关系后过账；任何变化都整体返回 409。若付款动作在允许节点被取消，或其 pending 审批被驳回，系统在同一事务清空这笔 draft expense 的 `externalActionId`、递增版本并写审计，使其可重新发起；并发变化同样整体冲突，不能遗留错误绑定。

这些 API 记录真实世界动作，不代表系统拥有银行、税务或签章接口。

## 11. AI 顾问 API

| 方法与路径 | 作用 |
| --- | --- |
| GET /advisors | 列出当前用户可用顾问和 active 提示词 |
| GET /advisors/:key/prompt-versions | 列出提示词版本 |
| POST /advisors/:key/prompt-versions | 创建并启用新版本 |
| GET /advisor-runs | 列出运行 |
| POST /advisor-runs | 创建权限过滤的运行 |
| GET /advisor-runs/:id | 读取完整审计记录 |
| PATCH /advisor-runs/:id | 记录人工修改 |

创建示例：

~~~json
{
  "advisor": "legal_compliance",
  "question": "这份合同签署前还缺少哪些复核？",
  "context": [
    {
      "resourceType": "contracts",
      "resourceId": "00000000-0000-4000-8000-000000000000"
    }
  ]
}
~~~

返回 201 表示已排队，不表示模型已完成。读取 run.status，直到 completed 或 failed。详情包含 modelCalls、toolCalls、citations 和 edits。

运行默认只对发起人可见。读取他人运行需要 `advisor-runs:read-all` 或 `*`；即使具备该权限，调用者仍必须拥有该顾问的 requiredPermission 和运行中每类 context resource 的 `:read` 权限。任一条件不满足时单条读取表现为 404；列表过滤、详情读取和人工修改使用同一可见性规则。默认 member 没有 `read-all`，只能读取或修改自己仍有权访问的运行；admin/owner 虽具备跨发起人读取能力，也不能绕过顾问和上下文权限。

人工修改只允许 completed 运行，必须发送完整 AdvisorOutput、reason 和 expectedVersion，并满足上述可见性边界。

## 12. 管理与运维 API

| 路径 | 权限与用途 |
| --- | --- |
| GET/POST /users | 列出或创建成员；创建同时请求初始角色审批 |
| PATCH /users/:id | 修改非纪律性显示名称 |
| GET /roles | 读取角色和权限 |
| POST /role-assignments | 请求角色分配或移除审批 |
| GET /audit-events | 读取组织审计 |
| GET /audit-events/:id | 读取单个审计事件 |
| GET /settings/integrations | 列出集成模式 |
| POST /settings/integrations/:id/test | 测试连接并审计结果 |
| GET/POST /backups | 列出或排队备份任务 |
| GET /operations/incidents | `operations-incidents:read`；分页读取租约失效处置事项 |
| POST /operations/incidents/:id/resolve | `operations-incidents:update`；追加人工调查审计 |

连接测试只验证可达性，不执行业务动作。external-manual 测试只确认人工适配器可用。

POST /backups 当前只接受 `scope=database`（省略时同样为 database）。files/full 必须使用管理员完整备份脚本，Web/API 会在入队前拒绝这些 scope，不会排入一个注定失败的伪完整备份。内置 database-only 导出不是完整灾备恢复点，也不持有主机 Ed25519 签名私钥。生产完整备份与恢复使用管理员脚本，由一次性容器完成 age 加密、来源签名和人工批准边界。

`GET /operations/incidents` 支持 `page`、`pageSize`、`status=open|resolved` 和可选 `type=advisor-run|workflow-run|backup`。每项包含租约审计 ID、原运行 ID/状态/版本、脱敏错误、数据库是否已记录部分结果，以及可空人工处置。它只汇总 `lease_expired`，不是所有 worker 失败列表；“未记录部分结果”也不证明外部没有副作用。缺少受控 schema version、证据或禁止重放确认的旧/伪造处置审计不会关闭事项。

处置请求示例：

~~~json
{
  "resolution": "manual_compensation_completed",
  "reviewSummary": "已核对工作流 checkpoint 与目标任务，并完成业务补偿；原失败运行保留。",
  "evidenceReferences": [
    "audit:租约事件 UUID",
    "task:补偿任务 UUID"
  ],
  "compensationReference": "task:补偿任务 UUID",
  "acknowledgement": "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED"
}
~~~

`resolution` 只能是 `no_partial_effects_found` 或 `manual_compensation_completed`。调查说明至少 20 字，证据至少一项；选择人工补偿时主补偿引用必填。数据库已经记录模型输出、工作流 partial output 或备份产物时，服务端拒绝“未发现部分副作用”。成功只新增 `manual_review_completed` 审计，返回 `sourceRecordChanged=false`、`automaticReplay=false`；原记录、队列、模型、工作流和备份命令均不变。同一事件并发关闭只有一个 200，其他请求 409；跨组织 ID 按 404 处理。

## 13. 健康检查

- /health：API 基本响应。
- /health/live：进程存活，不证明依赖可用。
- /health/ready：并行检查常驻数据库连接、pg-boss 队列和对象存储；任一失败或超过协作式 deadline 返回 503。重复请求对尚未结束的探针保持 single-flight，不会无限堆叠依赖操作。

部署探针和上线验收应使用 ready，不能只看 live。

## 14. 客户端集成检查清单

- 使用 Cookie 凭据并正确配置 Origin。
- 不在日志输出 Cookie、密码、API key、文件内容或个人信息。
- 对 401 重新登录，对 403 停止重试，对 409重新读取。
- `DEPENDENCY_UNAVAILABLE` 表示建连阶段依赖不可用；GET 等幂等读取可在退避后重试。任何非幂等写均不得仅因 503 自动重放。
- `DEPENDENCY_OUTCOME_UNKNOWN` 表示连接可能在请求送达依赖后中断。先用 `requestId`、资源状态和审计事件核对是否已生效，再由人工决定是否发起带新依据的重试；不得把“未收到响应”解释为“写入未发生”。
- 使用 requestId 关联支持工单、审计和服务器日志。
- 按整数分处理金额，按带时区 ISO 时间处理日期。
- 只把 confirmed 且有证据的外部动作视为完成。
- 对通知创建的 201 只认作 `queued`，由 worker 的 `sent`/`failed` 决定投递事实；对其他 201/202 后台任务继续轮询最终状态。
- 对 GitHub refresh 使用 202 返回的 `expectedVersion` 关联本次队列请求；不要提交客户端伪造版本，也不要把陈旧 job 被 CAS 丢弃解释为刷新成功。
- 工作流客户端把 run 的 `definitionVersion` 和 `stepsSnapshot` 视为执行依据，不用后来修改的 definition 推断已排队运行会做什么。
- 文件客户端严格执行 POST 元数据 → PUT 内容 → POST complete，不把 `stored` 当成可下载。
- 在 compatibility diff、弃用策略和受支持 SDK 发布闸门完成前，固定并评审 OAS 3.1 快照，不把临时生成客户端当作官方 SDK。
