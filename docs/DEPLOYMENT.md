# 部署指南

## 必填配置

- `ALLOWED_EMAIL`：唯一允许登录的邮箱。
- `TOKEN_SECRET`：至少 32 位随机字符，用于签发会话。
- `KEY_ENCRYPTION_SECRET`：独立的至少 32 位随机字符，用于加密 AI Key。
- `APP_ORIGIN`：浏览器端地址；Android 访问时可追加 `https://localhost`，用逗号分隔。
- SMTP：用于发送一次性验证码和登录链接。
- `BRAVE_SEARCH_API_KEY`：可选；配置后首页搜索会在资料库结果之外单独展示互联网补充结果。

不要把两个 Secret 设置成相同值，不要提交 `.env`。

## 可选配置

- FCM 三项配置启用 Android 即时推送。
- 未配置 FCM 时，资讯仍正常抓取，简报仍会保存在 App 内。
- 未配置 AI 模型时，RSS、筛选、收藏、离线阅读仍可使用；摘要回退为 Feed 自带摘要。

## 更新

```bash
git pull
docker compose up -d --build
```

更新前备份数据卷。数据库初始化采用幂等建表语句；未来涉及迁移的版本会在发布说明中明确标记。

## 故障排查

- `/api/health`：服务存活检查。
- App“我的 → 订阅源”：查看每个来源的最近抓取时间和错误。
- `docker compose logs -f daye-rss`：查看后台任务；认证头、Token 和 API Key 会被日志脱敏。
- RSS 抓取失败时，先确认地址是公开 HTTP(S)、使用 80/443 端口且未重定向到内网。
