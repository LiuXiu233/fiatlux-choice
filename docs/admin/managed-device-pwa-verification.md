# 真实受管手机 PWA 验收

本流程用于 `managed_device_pwa` V1 门禁。自动化 Chromium、iPhone 视口模拟、桌面安装性检查和本地 Compose 都只能作为前置工程证据；最终会话必须由真实公司受管手机在耀光目标内网完成。

`verify-managed-device-pwa-evidence.ts` 是离线证据校验器，不会连接、安装、更新、清理或控制手机。它只能校验会话结构、候选身份、固定步骤、附件实际字节/SHA-256、时间顺序和原子报告权限；设备确实为真机、确实受管、截图语义和批准真实性仍须由另一名有权责任人从独立渠道复核。

## 1. 前置条件

- 目标内网部署已绑定不可变版本、完整 Git SHA 和七类镜像清单，HTTPS 使用已批准 CA 且浏览器没有忽略证书错误。
- 准备两个不同的已批准候选：旧版和待验收新版。旧版/新版必须有不同版本号和不同 Git SHA。
- Web 镜像使用 `FIATLUX_RELEASE_VERSION` 与 `FIATLUX_RELEASE_GIT_SHA` 成对构建；`development/local` 只能搭配 `development`，`ci/vX.Y.Z[-预发布]` 必须搭配完整 40 位 SHA。登录页、离线壳、登录后侧栏和移动端个人菜单必须显示同一 `构建 版本 · 7位SHA`；这只是当前静态 Web 构建身份，不替代镜像 digest 或后端身份。
- 手机是物理设备并在公司 MDM/受控资产台账中；会话只记录伪名资产 ID，不记录序列号、IMEI、电话号码或个人 Apple/Google 账号。
- 操作者使用单独的 QA 身份和无个人信息、无真实合同/财务/合规正文的测试记录。密码、Cookie、令牌和真实公司数据不得进入截图、视频或 JSON。
- 变更审批已经存在，但本工具不会核验；最终还需要终端与业务验收负责人的独立批准。

## 2. 固定真机步骤

必须按下列顺序完成，任一失败就停止，不得把会话写成 `passed`：

1. `managed_status_confirmed`：从 MDM/资产台账确认当前物理设备仍为公司受管，只保留受控引用和已脱敏画面。
2. `trusted_https_install`：在手机浏览器直接打开旧版目标 HTTPS origin，确认完整证书链受信任；iOS 使用 Safari“添加到主屏幕”，Android 使用受支持 Chrome“安装应用”。不得使用开发者证书绕过、ADB sideload 或浏览器“继续访问不安全站点”。
3. `standalone_launch_before_update`：从主屏幕图标启动，确认无浏览器地址栏的 standalone 模式，并记录旧版可见构建身份。
4. `update_to_candidate`：按批准的部署流程把目标环境切换到新版，保持手机联网并打开已安装 PWA，等待 `autoUpdate` service worker 完成。完全退出并重新打开，直到显示新版身份；不要通过直接删除后重装冒充升级。
5. `standalone_launch_after_update`：再次从主屏幕启动并记录新版版本号与 7 位 Git SHA。
6. `authenticated_core_flow`：用 QA 身份登录，完成一个明确标为测试的核心读写场景，并退出含敏感数据的详情页后再采集脱敏证据。
7. `offline_shell_no_company_data`：关闭 Wi-Fi 与蜂窝数据，重新进入 PWA；必须显示受控离线/会话不可确认壳，不得显示工作区、登录表单或陈旧公司数据为当前事实。
8. `online_session_revalidated`：恢复网络后必须先出现会话重新验证状态；执行“重试”并由服务端确认当前会话后才能恢复工作区。
9. `logout_and_site_data_cleared`：正常退出，删除主屏幕 PWA，并通过系统/浏览器站点设置清理该 origin 的站点数据与缓存。只关闭窗口不算清理。
10. `post_clear_auth_required`：重新打开目标 origin，确认必须重新认证，旧工作区内容、离线页面和登录状态均不可恢复。

iOS 与 Android 的系统菜单会随版本变化，设备负责人应记录实际 OS、浏览器版本和操作路径，不应把本文菜单名称硬编码为长期政策。

## 3. 附件与隐私

至少提供四组实际文件：受管状态、安装/升级、离线/恢复、退出/清理。允许 PNG、JPEG、MP4、纯文本或 JSON；单文件上限 250 MB。每个固定步骤至少引用一个附件，每个附件也必须支持至少一个步骤。

- 原始凭据、Cookie、token、序列号、IMEI 和未脱敏公司数据出现时，本次会话失败；先在受控区删除或重新采集，不得只在 JSON 中把布尔值改为 `false`。
- 截图/视频需要脱敏时，保留受控原件处置记录，仅把复核后的脱敏副本放入 `evidence-root`；报告不复制文件名或操作者备注，只保存 ID、字节数、类型、时间和 SHA-256。
- `managementEvidenceReference`、`operatorIdentity`、环境 ID 和审批编号仍可能是内部敏感标识。原始会话与报告存入受控证据库，进入 Git 前必须再次脱敏并保留原件哈希。

## 4. 填写和校验

复制[会话模板](../delivery/templates/managed-device-pwa-session.template.json)，替换所有 `REPLACE_` 值。模板故意不能直接通过 Schema，避免被误当真实验收。附件路径必须相对 `evidence-root`、不能含 `..`、反斜线或符号链接。

先从受控终端取得每个附件的实际大小和哈希：

```sh
sha256sum /controlled/device-pwa/captures/install-update.mp4
stat -c '%s' /controlled/device-pwa/captures/install-update.mp4
```

macOS 的字节数命令使用 `stat -f '%z'`。完成 JSON 后，以独立批准值运行：

```sh
pnpm delivery:managed-device-pwa:verify -- \
  --session /controlled/device-pwa/session.json \
  --evidence-root /controlled/device-pwa \
  --report-dir /controlled/device-pwa/reports \
  --expected-version v1.0.0-rc.2 \
  --expected-git-sha <40位已批准Git SHA> \
  --expected-url https://choice.internal.example:8443 \
  --expected-environment-id fiatlux-guangzhou-office-prod \
  --json
```

命令行的版本、Git SHA、URL 和环境 ID 必须来自会话之外的发布批准记录，不能复制会话自报值后不核对。校验器拒绝：缺失/乱序步骤、模拟器或非受管声明、同版本“升级”、构建身份不匹配、时间倒序、隐私布尔值不安全、未知/孤立附件、路径穿越、符号链接、字节数或 SHA 不一致、候选身份不一致和报告覆盖。成功报告保留 `sessionId`，供机器清单、原始附件和批准链引用同一会话。

只有全部通过时，报告目录才被收敛为 mode `0700`，并以不可覆盖的原子发布方式生成 mode `0600` JSON。保存终端输出的报告 SHA-256。

## 5. 报告边界与门禁更新

成功报告仍固定包含：

- `physicalDeviceIndependentlyVerified=false`
- `managementStatusIndependentlyVerified=false`
- `approvalIndependentlyVerified=false`

因此机器报告不能单独把 `managed_device_pwa` 改成 passed。终端/业务验收负责人必须从 MDM、原始附件、发布记录和公司审批渠道交叉核对，并形成可识别批准记录；机器清单中的 target-environment 证据、approval 证据和 `approval` 元数据必须引用同一真实会话/批准链。任何附件缺失、真实性存疑、设备非受管、升级身份不一致或隐私泄露都保持 blocked。
