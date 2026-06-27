# Open Source Checklist

开源前最小检查：

- [ ] 当前工作区不包含 `server/data/`、`node_modules/`、`.next/`、`web/out/`、日志或本地数据库。
- [ ] 文档中的域名、IP、SSH 用户和端口均为占位示例。
- [ ] 没有固定默认运维密码；生产环境通过 `OPS_ADMIN_PASSWORD` 设置。
- [ ] 运行敏感词扫描，至少覆盖私钥、Token、API Key、真实域名、服务器 IP 和默认密码。
- [ ] 不直接公开带内测部署历史的旧仓库；优先用当前干净树创建新的公开仓库，或在确认可接受后再处理历史。
- [ ] 发布后在仓库设置里开启 Secret scanning / Dependabot alerts。
