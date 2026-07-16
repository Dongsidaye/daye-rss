# Android 手机本地模式

## 使用方式

1. 在仓库中执行 `npm run cap:sync` 后运行 `android\\gradlew.bat assembleDebug`。生成文件位于 `android/app/build/outputs/apk/debug/app-debug.apk`。也可以把 `docs/examples/android-workflow.yml` 复制到 `.github/workflows/android.yml`，由 GitHub Actions 生成 `daye-rss-debug-apk` 构建产物。
2. 打开 App，无需注册或填写服务地址。
3. 进入“我的”，粘贴 HTTPS RSS/Atom 地址，或导入 OPML。
4. 回到“今日”手动刷新；之后每次打开 App，超过 15 分钟未刷新时会自动抓取。
5. AI 是可选能力。进入“我的 → AI 模型”，选择供应商，填写模型 ID 与 API Key。

## 本地数据边界

- 文章、订阅、监控、收藏和偏好保存在 Android WebView 的 IndexedDB，最多保留最近 600 篇。
- 模型 API Key 不写入 IndexedDB，而是由 Android Keystore 生成的不可导出 AES-256-GCM 密钥加密后保存。
- `allowBackup=false`，Android 系统备份不会复制 App 私有数据。
- 手机直接访问 RSS 与模型供应商；没有“大爷的 RSS”中转服务器。
- 卸载 App 会删除所有本地数据。升级同一签名的 APK 会保留数据。

## 限制

- 仅允许 HTTPS RSS、正文和模型接口。
- 打开 App 或手动操作时才能可靠抓取。Android 可能限制熄屏后台网络，手机本地版不保证准点简报和即时推送。
- AI 调用产生的费用由模型供应商直接计入你的账号；请在供应商控制台设置预算上限。
- 当前本地版支持 OPML 导入，但文章库没有跨设备同步。
