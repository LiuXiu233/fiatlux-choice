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
5. 银行付款、税务申报、发票红冲、合同签署、人事处分、关键权限变更和对外法律承诺始终由人工批准；来源条目不得被用来绕过该控制。

## 数据字段

每条来源使用稳定语义 ID，并保存标题、分类、法域、机关、文号、层级、官方 URL、公布/施行/失效日期、效力状态、摘要、适用条件、排除条件、复核状态、核验和下次复核日期、正文哈希状态及依据类型。

`contentHash=null` 与 `contentHashStatus=pending_fetch` 表示只完成了官方页面与元数据核验，尚未把正文快照纳入证据库。该状态不得被解释为内容已完整归档。
