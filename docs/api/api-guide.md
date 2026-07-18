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

Swagger 当前可靠展示路由、标签和摘要。许多请求与响应使用运行时 Zod schema，尚未完整转换为 OpenAPI JSON Schema；调用方必须同时以 packages/contracts/src/index.ts 和本指南为准，不能仅凭 Swagger 自动生成生产客户端。

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

新密码至少 14 位且必须不同于当前密码。成功会保留当前会话并撤销该用户的其他未过期会话；当前没有自助忘记密码或恢复码 API。

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

以下资源由通用资源路由提供 `GET /资源`、`POST /资源`、`GET /资源/:id`、`PATCH /资源/:id` 和 `DELETE /资源/:id`：

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

`POST /notifications` 和 `POST /workflow-runs` 除写入记录外还会投递后台任务；队列不可用时 API 返回 503 并尽力把新记录标为 failed。不要因为收到 201 就假设通知已投递或工作流已完成。

不属于上述通用 CRUD 的已知路由：

| 路由 | 说明 |
| --- | --- |
| GET /dashboard | 组织经营摘要 |
| GET /audit-events、GET /audit-events/:id | 只读审计 |
| GET/POST /users、PATCH /users/:id | 成员管理；创建成员同时生成初始角色审批 |
| GET /roles、POST /role-assignments | 读取角色与申请角色变更 |
| GET/POST /approvals、GET /approvals/:id、POST /approvals/:id/approve、POST /approvals/:id/reject | 人工审批 |
| GET/POST /external-actions、GET /external-actions/:id、POST /external-actions/:id/transition | 外部动作真实性状态机 |
| POST /github-insights/:id/refresh | 仅在批准的 read-only GitHub 模式排队刷新 |
| GET /settings/integrations、POST /settings/integrations/:id/test | 集成边界和连接探测 |
| GET/POST /backups | 查看或排队备份任务 |
| GET /advisors、提示词版本和 advisor-runs 路由 | 权限感知顾问与审计，详见第 11 节 |

Swagger 仍是运行时路由事实的辅助视图；请求/响应 body schema 不完整时，以 `packages/contracts/src/index.ts` 和对应 API 源码为准。

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

当前类型化执行关系只有 `projects.objectiveId` 和 `tasks.projectId`。decisions 没有 objective/project/task 字段，products、opportunities 与 projects 之间也没有类型化关联。客户端不得发送未在契约中的“关系字段”并假设服务端会保存；在正式补充契约和迁移前，只能把相关 UUID 写入说明并由人工核对。

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

API 在 50,000,000 字节上限内有界接收文件（约 47.7 MiB），再写入对象存储，并核对声明的大小与 SHA-256。通过该端点后状态为 `stored`，尚不能下载。

### 第三步：完成校验

~~~sh
curl --request POST \
  --header 'Origin: https://choice.internal.example:8443' \
  --cookie /tmp/fiatlux.cookies \
  https://choice.internal.example:8443/api/v1/files/00000000-0000-4000-8000-000000000000/complete
~~~

`POST /files/:id/complete` 是当前流程的必需步骤，不是未来扩展。API 通过对象存储 head 再次核对大小与 SHA-256，将状态改为 `uploaded`；下载端点只接受 `uploaded`。只有 uploader 或具有 `files:update` 权限的用户可以上传和 complete。

### 下载与归档

- GET /files/:id/download 返回受权限控制的附件流。
- PATCH /files/:id 可更新 filename、classification 和 expectedVersion。
- DELETE /files/:id?expectedVersion=1 软归档元数据。

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

角色分配使用 POST /role-assignments 创建 critical 审批，批准后才修改角色。

## 10. 外部动作 API

POST /external-actions 支持：

- bank_payment
- tax_filing
- invoice_red
- contract_sign
- hr_discipline
- permission_change
- external_legal_commitment
- notification
- github_sync

adapter 为 manual、mock 或 real。前七类自动创建人工审批。每个动作必须提供至少 8 字符的 idempotencyKey 和原因。

状态大致为：

~~~text
pending_approval -> approved -> submitted -> confirmed
                         |           |
                         |           +-> failed -> submitted
                         +-> simulated
任一允许节点可按状态机进入 cancelled
~~~

POST /external-actions/:id/transition 记录状态变化。submitted 必须有 evidence.externalReference；confirmed 必须有非空外部回执；mock 只能 simulated 或 cancelled。

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

人工修改只允许 completed 运行，必须发送完整 AdvisorOutput、reason 和 expectedVersion。

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

连接测试只验证可达性，不执行业务动作。external-manual 测试只确认人工适配器可用。

POST /backups 的 scope 为 database、files 或 full。没有受控 BACKUP_COMMAND 时，worker 只支持 database；files/full 会明确失败。生产完整备份与恢复使用管理员脚本。

## 13. 健康检查

- /health：API 基本响应。
- /health/live：进程存活，不证明依赖可用。
- /health/ready：依次检查数据库、pg-boss 队列和对象存储；任一不可用返回 503。

部署探针和上线验收应使用 ready，不能只看 live。

## 14. 客户端集成检查清单

- 使用 Cookie 凭据并正确配置 Origin。
- 不在日志输出 Cookie、密码、API key、文件内容或个人信息。
- 对 401 重新登录，对 403 停止重试，对 409重新读取。
- 使用 requestId 关联支持工单、审计和服务器日志。
- 按整数分处理金额，按带时区 ISO 时间处理日期。
- 只把 confirmed 且有证据的外部动作视为完成。
- 对 201/202 的后台任务继续轮询最终状态。
- 文件客户端严格执行 POST 元数据 → PUT 内容 → POST complete，不把 `stored` 当成可下载。
- 不依赖尚不完整的 OpenAPI body schema 自动生成生产客户端。
