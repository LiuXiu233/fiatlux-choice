# FIAT LUX CHOICE 合规资料索引

本目录说明如何使用和维护 FIAT LUX CHOICE 的中国、广东及广州合规知识库。结构化来源数据位于 [`content/compliance/official-sources.json`](../../content/compliance/official-sources.json)。

## 文档

- [适用边界](./applicability-boundaries.md)：区分法域、业务角色和触发条件。
- [电竞教育九项事实问卷](./esports-education-facts-questionnaire.md)：任何课程或教育产品上线前必须完成。
- [人工复核流程](./manual-review-workflow.md)：来源、适用性和控制措施的审批流程。
- [来源监控策略](./source-monitoring-strategy.md)：抓取、哈希、变更检测和复核频次。
- [免责声明](./disclaimer.md)：资料用途和专业复核边界。
- [研究方法](../research/compliance-research-methodology.md)：本轮资料的来源层级和核验方法。

## 使用原则

1. `status=effective` 只表示已从官方来源核验其效力状态，不表示该文件自动适用于耀光电竞。
2. 所有条目初始均为 `reviewStatus=pending`。只有完成来源复核和公司事实适用性复核后，才能用于生成确定性义务或截止日。
3. 税率、最低工资、社保和公积金基数、申报日历、行政许可材料等易变数据不得写入永久常量。
4. 法律、行政法规、部门规章、政策指导、地方办事指南和公司内部控制必须保留不同的 `normativeBasisType`。
5. 银行付款、税务申报、发票红冲、合同正式签署、合同终止、人事处分、关键权限修改和对外法律承诺始终由人工批准；来源条目不得被用来绕过该控制。

## 专业复核入口

复核人必须先上传证据，再在合规来源的“登记专业复核”专用表单中记录实名、角色、机构/内部组织、胜任依据、适用条件、摘要、缺失信息、结论、来源生命周期、下次复核日和登记理由。系统锁定来源版本、当时的内容/元数据哈希、证据文件和站内登记人，并把每次意见追加为 `professional_review` 审计历史。

通用创建/编辑和 seed 不能直接生成 `reviewed` 或确定生命周期（`active|superseded|repealed`）。旧复核证据即使已被新意见替换，仍因历史审计引用而禁止归档。来源发生实质变化、复核过期或监测连续失败时会重新降级，不会沿用旧结论。完整操作和结论映射见[人工复核流程](./manual-review-workflow.md)。

## 数据字段

每条来源使用稳定语义 ID，并保存标题、分类、法域、机关、文号、层级、官方 URL、公布/施行/失效日期、效力状态、摘要、适用条件、排除条件、复核状态、核验和下次复核日期、正文哈希状态及依据类型。seed 会把 `contentHashStatus` 与 `nextReviewAt` 持久化，并给来源设置可维护的自动检查周期；不会把 pending 条目自动提升为已复核。

`contentHash=null` 与 `contentHashStatus=pending_fetch` 表示只完成了官方页面与元数据核验，尚未把正文快照纳入证据库。该状态不得被解释为内容已完整归档。

机器状态含义：`current` 表示最近一次受控抓取与当前基线一致，`changed` 表示哈希改变并等待人工复核，`failed` 表示最近一次抓取失败。它们均不等价于 `reviewStatus=reviewed`。完整抓取安全边界、定时任务、失败降级和人工触发方式见[来源监控策略](./source-monitoring-strategy.md)。

合规知识库顶部的“官方来源监控状态”用于日常运营：它按本组织汇总当前待领取、有效租约、首次未抓取、失败、变化和复核关注，并展示最近一次可解析的定时派发审计。各指标可能重叠，最近批次的“当时有积压”也不等于当前仍有积压。刷新面板不会触发抓取或专业复核；任何数字都不能替代打开官方原文、核对公司事实和登记有证据的人工意见。
