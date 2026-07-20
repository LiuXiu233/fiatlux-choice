# 电竞教育 WordPress 内部审阅包

本文说明如何从精确 Git 候选生成 12 篇电竞教育文章的 WordPress 块 HTML 和治理审阅表。该目录只服务于内部审阅、受控预览和逐篇问题关闭，不是公开发布包、专业意见、素材许可、人工批准或 `education_content_clearance` 放行报告。

## 1. 固定安全边界

- 每篇 HTML 的注释和可见正文都固定包含 `FIATLUX_REVIEW_ONLY_DO_NOT_PUBLISH`。
- 即使结构化状态未来全部满足准备条件，manifest 仍固定为 `mode=review_only`，工具也不会生成“已发布”状态。
- 工具不接受 WordPress 用户名、密码、Cookie、nonce 或应用密码，不登录、不联网、不调用 WordPress API，也不提交表单。
- 工具只从指定的完整 40 位 Git SHA 读取两份内容文件；工作树中尚未提交的修改不会进入审阅包。
- `publicationEligible=true` 最多表示内容库中的结构化复核、权利、来源和人工发布准备状态没有已知缺项，不代表专业判断、批准真实性或公开发布已经完成。
- 公开页面放行验证器会拒绝仍含上述标记的页面，因此审阅 HTML 不能原样成为公开文章。

真实发布仍须由获授权人员在全部复核和逐篇批准完成后人工执行，并按[逐篇放行手册](./education-content-clearance.md)登记真实 post ID、URL、时间、截图、HTML 和批准证据。

## 2. 生成前检查

1. 将需要审阅的内容修改提交到 Git；执行 `git status --short`，确认候选 SHA 中确实包含预期的两份内容文件。
2. 执行 `pnpm content:education:validate`，先关闭 Schema、来源冲突、重复 ID/slug 和跨包版本问题。
3. 在加密或受控介质上创建仓库外父目录。父目录必须由当前操作者拥有、不是符号链接，且权限精确为 `0700`。
4. 输出目录必须尚不存在。每次内容或状态变化都使用新的目录名，不能覆盖旧包。
5. 不要在文章、审阅表、目录名或命令行中加入学员个人信息、账号、密码、验证码或 WordPress 凭据。

示例：

```bash
install -d -m 700 /secure/fiatlux-education-review
cd /path/to/fiatlux-choice
REPOSITORY_ROOT=$(pwd -P)
CANDIDATE_GIT_SHA=$(git rev-parse HEAD)

pnpm content:education:review-bundle -- \
  --output "/secure/fiatlux-education-review/${CANDIDATE_GIT_SHA}" \
  --repository-root "$REPOSITORY_ROOT" \
  --git-sha "$CANDIDATE_GIT_SHA" \
  --json
```

命令拒绝相对路径、不安全父目录、符号链接祖先、非完整 SHA 和已有输出目录。输出目录及其两个子目录固定为 `0700`，每个文件固定为 `0600`。

## 3. 目录结构

一次完整生成应得到 26 个文件：

```text
<output>/
├── README.md
├── manifest.json
├── articles/
│   └── 01-<slug>.review.html ... 12-<slug>.review.html
└── reviews/
    └── 01-<slug>.review.md   ... 12-<slug>.review.md
```

- `articles/*.review.html`：可供 WordPress 块编辑器或受控预览使用的内部 HTML，包含正文、练习、模板、来源、AI 披露和显著禁止发布标记。
- `reviews/*.review.md`：逐篇治理状态、阻断原因、负责人备注、权利依据、来源适用性、复核问题和人工检查表。
- `README.md`：候选 SHA、生成时间、文章数量和工具边界。
- `manifest.json`：候选内容文件、逐篇内容哈希、25 个非 manifest 产物的字节数和 SHA-256、准备状态与固定安全声明。

`manifest.json` 最后写入。目录缺少 manifest 时必须视为生成中断，不能继续分发或审阅；换用新的空目录重新生成。manifest 不保存自身递归哈希，跨介质转移时应另行记录 manifest 或受保护归档的 SHA-256。

## 4. manifest 判读

重点核对：

| 字段 | 含义 |
| --- | --- |
| `candidate.gitSha` | 本次审阅唯一绑定的候选提交 |
| `candidate.contentFiles` | 两份候选 JSON 的路径、字节数和原始文件 SHA-256 |
| `articles[].contentSha256` | 对候选提交中逐篇结构化文章计算的 SHA-256 |
| `articles[].blockingReasons` | 当前结构状态尚未关闭的逐篇问题 |
| `articles[].publicationEligible` | 结构化准备指示，不是发布批准 |
| `artifacts[]` | README、12 个 HTML 和 12 个审阅表的字节数与 SHA-256 |
| `summary` | 文章、结构可准备和阻断数量 |
| `safety` | 无外部发布、无凭据、无 API、无专业/权利/批准替代的固定声明 |

如果 manifest、文件哈希、候选 SHA 或文章版本不一致，应停止审阅并从正确提交重新生成；不得手工修改 manifest 来“修复”漂移。

## 5. 低人力审阅流程

1. 内容负责人先读每篇 `reviews/*.review.md`，把每个阻断原因转换为 FIAT LUX CHOICE 中有负责人和期限的任务或风险。
2. 对前四篇基础内容优先完成内部试讲、专业/事实、来源、广告与不承诺、权利、隐私、健康和内容安全复核。
3. 复核人核对相同 SHA 的 HTML 与审阅表；修改意见回写版本化 JSON，而不是直接把审阅包当作新的事实源。
4. 修改 JSON、递增文章版本、提交新 SHA、重新校验并生成新目录。旧目录保留为受控审阅历史或按批准的保存期限安全删除。
5. 如需在 WordPress 中检查排版，只能由获授权人员在访问受控的非公开草稿或隔离预览环境中人工操作，保持禁止发布标记，不得把预览成功登记为公开发布。
6. 全部真实复核、素材权利和逐篇批准完成后，另行从获批准候选制作公开版本；公开版本不得包含审阅标记，并须保持与候选 SHA、文章哈希和批准记录的可追溯关系。
7. 人工发布后运行逐篇放行证据流程。只有真实公开页面、旧模板处置、附件和最终批准全部通过，才可更新 V1 门禁。

1–2 人团队可以由同一自然人承担多个内部角色，但必须如实披露同人复核/批准；能力不足的法律、健康、知识产权、隐私或电竞专业事项仍需适合的外部复核人。

## 6. 保存、传递与销毁

- 默认保存在仓库外，不提交 Git，也不上传到公开网盘、公开 issue、聊天群或邮件附件。
- 只向本篇必要的复核人授予最小访问；转移前后核对 manifest/归档 SHA-256。
- HTML 和 Markdown 都按不可信输入处理；预览时关闭脚本执行和外部资源自动加载，不把自由文本中的链接当作已审核来源。
- 审阅包设计上不需要个人信息。若人工备注另含身份或敏感信息，应放在受控证据系统中，不要回写审阅包。
- 保存期限、删除批准和销毁证据按公司档案与内容治理规则执行；删除旧包不能删除已经用于批准或争议处理的必要证据。

## 7. 工程验证

```bash
pnpm test:education-content-evidence
pnpm lint:shell
pnpm typecheck
```

自动验收会从当前 HEAD 真实生成 12 个 HTML、12 个 Markdown、README 和 manifest，独立复算候选及产物哈希，检查 `0700/0600`、12 篇阻断状态、禁止发布标记和无 TCP/HTTP/HTTPS 调用，并验证相对路径、不安全父目录及覆盖尝试失败关闭。

截至 2026-07-20，当前 12 篇均为 `pending` / `pending_clearance` / `not_published`，生成结果应为 `publicationEligibleCount=0`、`blockedArticleCount=12`。该结果是诚实的准备状态，不是缺陷规避，也不能把 `education_content_clearance` 从 blocked 改为 passed。

实现提交 `9c5633e1c3e9650507231106fcd8a451bf32053f` 的[脱敏机器证据](../delivery/evidence/education-wordpress-review-bundle-acceptance-9c5633e-20260720.json)记录了 exact-SHA 产物、权限、哈希、网络防护、浏览器和三张受影响应用镜像检查。证据本身没有保存审阅正文、凭据、身份或外部操作回执，也不是逐篇真实放行报告。
