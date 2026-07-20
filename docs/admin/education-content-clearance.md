# 电竞教育内容逐篇放行与公开发布证据

本流程服务于 V1 门禁 `education_content_clearance`。它把候选 Git 提交中的两份受控内容包、12 篇文章、九项上线事实问卷、逐篇复核、素材权利、人工批准、真实公开页面和七篇旧模板处置绑定为一个可复核会话。当前十二篇仍是内部草案；本工具的存在不代表任何文章已经通过专业复核、取得权利或发布到 `fiatlux.gg`。

## 1. 能做什么、不能做什么

模板生成器从指定的完整 Git SHA 读取：

- `content/education/foundation-articles.json` 中的 4 篇基础内容；
- `content/education/expansion-articles.json` 中的 8 篇扩展内容；
- 每篇文章的 ID、slug、版本、来源、完整文章 SHA-256 和三个公开页面核验标记；
- 两份内容文件本身的字节数和 SHA-256。

验证器随后校验受保护的会话与附件，并对 12 个登记公开 URL 和 7 个旧模板 URL 执行无登录、无 Cookie、无授权头、禁止自动跟随重定向的只读 `GET`。它不会登录、修改或发布 WordPress，不会提交表单，也不会把站内任务或模拟状态解释为外部成功。

机器可以证明候选身份、内容哈希、附件字节、公开 HTTP 状态、候选文字标记、canonical、纠错入口和选定占位文缺失。机器不能独立证明专业判断、权利有效性、复核人身份、试讲真实性、视觉与可访问性质量或批准真实性；这些结论必须由真实责任人通过独立渠道复核。

## 2. 放行范围

九项事实问卷必须按固定顺序全部为 `cleared`：

1. 学员对象与年龄；
2. 收费、预付款与退款；
3. 交付形态；
4. 课程分类；
5. 证书、师资与宣传；
6. 经营主体与渠道；
7. 知识产权；
8. 个人信息与跨境；
9. AI 与人工责任。

每篇文章必须按固定顺序完成八类复核：专业与事实、来源时效与适用性、广告消费者与不承诺、著作权与素材权利、肖像隐私与个人信息、健康边界、内容安全与社群规则、内部试讲与纠错。每个来源都必须逐条登记“当前有效且适用于本文”的人工结论；每项素材必须登记权利人、依据、地域、渠道、期限和证据。

1–2 人团队允许同一自然人承担多个角色，但 `reviewerMode` / `approverMode` 必须按事实填写：

- `different_person`：复核人或批准人与内容负责人/会话操作者不同；
- `same_person_dual_role_disclosed`：确为同一人，已明确披露自我复核或自我批准。

该披露不会把欠缺的专业能力变成有效专业意见。法务、财税、健康、知识产权或数据事项超出内部能力时，应聘请具备相应能力的外部复核人并保存真实委托与结论。

## 3. 安全目录

原始会话、实名批准、截图和附件可能含有限身份信息，默认保存在仓库外的受控介质。先创建三个互相隔离的目录；示例路径需按实际环境修改：

```bash
install -d -m 700 /secure/fiatlux-education/session
install -d -m 700 /secure/fiatlux-education/evidence
install -d -m 700 /secure/fiatlux-education/reports
```

会话和每个附件必须是当前操作者所有的普通文件，且不得向 group/other 开放；建议精确使用 `0600`。证据根目录和报告目录必须精确为 `0700`，不得互相嵌套，也不得使用符号链接绕过目录边界。不得把 WordPress 密码、应用密码、授权头、Cookie、nonce、学员个人信息或敏感个人信息写入会话或附件。

## 4. 创建候选模板

先从发布批准记录独立取得版本、候选提交、目标 URL 和环境 ID，不要从待填写会话反向复制这些值：

```bash
pnpm delivery:education-content:template -- \
  --output /secure/fiatlux-education/session/clearance.json \
  --repository-root /path/to/fiatlux-choice \
  --git-sha 0123456789abcdef0123456789abcdef01234567 \
  --version v1.0.0-rc.4 \
  --url https://choice.internal.example/ \
  --environment-id fiatlux-guangzhou-office-prod
```

命令以独占创建方式写入 `0600` 文件，路径已存在时拒绝覆盖。模板有意保留 `REPLACE_WITH_*`、失败状态、零字节附件和未批准字段，因此刚生成时必须无法通过验证。内容快照由候选提交生成，不应手工改写；内容发生变化时应提交新版本并重新生成完整会话。

## 5. 填写与人工发布顺序

1. 确认九项问卷的实际业务答案、有效区间、复核角色和附件；任何 `unknown` 或未解决许可继续阻断。
2. 对每篇文章按八类固定复核填写实名或可在公司内部唯一识别的身份、角色、时间、结论和附件。
3. 核对每个来源的发布机关、有效状态、更新时间、适用条件和本文引用语境。
4. 登记正文、模板、图片、音视频、游戏画面、引文和其他素材的权利依据；“没有第三方素材”也要形成可复核记录。
5. 完成仅限成年人的内部试讲，记录负面结果、纠错项和问题关闭；`blockingIssuesOpen` 必须真实为零。
6. 每篇取得单独、不可复用的发布批准编号。批准必须晚于该篇全部复核。
7. 获授权人员在 WordPress 人工发布；系统不会代替人执行。登记唯一 post ID、公开 URL、发布时间、发布人和纠错入口。
8. 每篇分别保存 HTML 导出、桌面截图和移动端截图；三个附件不得相同，也不得在不同文章之间复用。
9. 将七篇旧模板分别撤回为 404/410、以 301/308 重定向到本次文章，或在原 URL 原位重写。每个 URL 分别保存 HTTP 与视觉附件。
10. 全部 12 篇可无登录访问、七篇旧模板处置完成后，再取得最终公司放行批准。最终批准必须晚于全部公开观察。

公开页必须返回无跳转 `200`、使用 `fiatlux.gg` HTTPS URL、canonical 与登记 URL 相同，显示候选文章的三个文字标记并包含登记的纠错链接。验证器拒绝 preview/query URL、`wp-admin`、`wp-json`、重复 URL、重复 post ID、重复逐篇批准、复用发布截图以及已知 WordPress/Lorem 占位文。

## 6. 附件登记

对每个附件填写：相对 POSIX 路径、实际字节数、64 位小写 SHA-256、允许的 MIME、采集时间和个人信息范围。文本附件上限为 10 MB；公开页面响应上限为 5 MB，包含分块传输。二进制附件只绑定字节与哈希，机器不会读取图片或 PDF 的语义。

会话中不得存在未登记引用，也不得添加未被任何问卷、复核、批准、发布或隐私检查引用的孤立附件。逐篇发布 HTML/桌面/移动附件以及七个旧页面的 HTTP/视觉附件必须各自唯一。

## 7. 运行验证

从独立批准记录再次输入期望身份：

```bash
pnpm delivery:education-content:verify -- \
  --session /secure/fiatlux-education/session/clearance.json \
  --evidence-root /secure/fiatlux-education/evidence \
  --report-dir /secure/fiatlux-education/reports \
  --repository-root /path/to/fiatlux-choice \
  --expected-version v1.0.0-rc.4 \
  --expected-git-sha 0123456789abcdef0123456789abcdef01234567 \
  --expected-url https://choice.internal.example/ \
  --expected-environment-id fiatlux-guangzhou-office-prod \
  --json
```

验证器失败时不生成成功报告。成功报告以 `0600` 独占、原子方式写入，已有同名报告或 partial 文件时拒绝覆盖。公开 HTTP 只证明验证时点；页面或候选内容之后发生任何实质变化，都必须新建会话并重新验证。

## 8. 当前状态与门禁回填

截至 2026-07-20，仓库只有失败关闭合同、模板、验证器和模拟公开 HTTP 的实现测试；十二篇真实专业/事实/权利/隐私/内容安全复核、九项真实问卷、内部试讲、WordPress 发布、七篇旧模板处置和公司批准均未发生。因此 `education_content_clearance` 必须保持 `blocked`，不得运行一个本地测试后改写为通过。

真实报告完成后仍需由独立负责人核对：原始批准渠道、人员角色、报告 SHA-256、候选提交、全部原始附件和 19 个公开 URL。只有核对完成，发布清单才可同时加入：

- 绑定 `implementationCommit` 的成功 `machine_evidence`；
- 覆盖逐篇事实、专业、来源、权利、隐私、健康和内容安全的成功 `professional_review`；
- 12 篇真实 URL 与七篇旧模板处置登记的成功 `external_publication`；
- 与门禁 `approval.approvalReference` 完全一致的成功 `approval`。

原始会话和含身份的报告默认不提交 Git。仓库只保存经人工确认的脱敏摘要、不可逆哈希、候选 SHA、证据保管位置/记录编号和明确边界；不得为了“变绿”编造 URL、时间、身份、签字或外部成功。
