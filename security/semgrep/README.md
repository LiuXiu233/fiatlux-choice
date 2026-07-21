# FIAT LUX CHOICE Semgrep 规则集

`fiatlux-nodejs-v1.yml` 是仓库内版本化的 TypeScript/Node.js 高信号 SAST 规则集。规则覆盖
SQL/HTML 注入、shell 与动态代码执行、SSRF、TLS 验证关闭、弱密码学、硬编码秘密和敏感日志。
CI 固定使用 Semgrep OSS 1.170.0 及镜像 digest，并关闭遥测和远程规则下载。

主扫描显式排除测试、构建产物和 `canary/`。Semgrep OSS 1.170.0 尚不能解析 TypeScript
`export type *`，因此还排除了只包含三个 re-export、没有可执行逻辑的 `apps/api/src/index.ts`；
其实际导出模块仍全部扫描，升级引擎时必须复核并移除此例外。`verify-canary.sh` 只扫描故意脆弱的 fixture，
要求每条规则至少命中一次且 Semgrep 以 finding 状态退出，从而证明规则没有被空配置或排除参数架空。
`.github/codeql-config.yml` 同样只把该故意脆弱 canary 从 CodeQL 排除；启用 CodeQL 后，其余源码与测试仍按
CodeQL 默认范围分析，不能把 canary finding 或路径排除误写成生产源码已通过。
本地验证命令与 workflow 相同：

```sh
SEMGREP_IMAGE='semgrep/semgrep:1.170.0@sha256:c98f8829eea377274ee4b10656458b078b88232469b2ff913f091c2317347c9d'
docker run --rm -v "$PWD:/src" -w /src "$SEMGREP_IMAGE" \
  sh security/semgrep/verify-canary.sh
```

任何抑制都必须限定到最小代码行，写明误报依据、补偿控制、负责人和到期复核日期，并由安全负责人
审批。该规则集是 Semgrep SAST；在安全负责人书面批准其等效性前，它不等于 CodeQL，也不改变
“CodeQL 未运行”的事实。
