# 参与开发

## 开发环境

- Node.js 22.5+
- npm
- 构建 Android 时需要 JDK 21 与 Android SDK 35

```powershell
npm install
npm test
npm run build
```

启动 Web 与服务端开发环境：

```powershell
Copy-Item .env.example .env
npm run dev
```

## 提交要求

1. 功能变更应补充或更新测试。
2. 涉及界面时至少检查窄屏、普通手机、横屏/折叠屏展开和深色模式。
3. 涉及 AI 时必须覆盖无模型、主模型失败、备用模型成功、全部失败和不合格输出。
4. 涉及抓取时必须把 Feed、HTML、重定向和远程地址视为恶意输入。
5. 不要把规则回退结果标记成 AI 已完成。

## 禁止提交

- `.env`、API Key、访问 Token、SMTP 或 Firebase 凭据
- SQLite 数据库、个人 OPML、订阅列表或阅读记录
- APK/AAB、调试或发布签名、Keystore 文件
- 含个人通知、账号、密钥或设备标识的截图和日志
- `node_modules`、构建目录、Android SDK 路径和本地测试工具

## 提交前检查

```powershell
npm test
npm run build
npm audit
```

Android 相关变更还应执行：

```powershell
npm run cap:sync
Set-Location android
.\gradlew.bat assembleDebug
```

## 安全问题

不要在公开 Issue 中粘贴可用密钥、私人 Feed 或攻击所需的敏感细节。先撤销已暴露凭据，再以最小可复现信息联系仓库所有者。
