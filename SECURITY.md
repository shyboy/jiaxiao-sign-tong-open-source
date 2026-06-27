# Security

## Reporting

如发现安全问题，请通过仓库 Issue 说明可复现步骤。不要在 Issue 中贴真实学生、家长、签名图片、数据库文件、服务器地址、Cookie、Token 或任何凭据。

## Data Boundary

- 不要提交 `server/data/`、数据库、上传附件、签名图片、导出 PDF/zip 或日志。
- 生产环境必须使用 HTTPS，上传目录不能作为公网静态目录暴露。
- 新数据库首次启动会创建平台运维账号；请用 `OPS_ADMIN_USERNAME` 和 `OPS_ADMIN_PASSWORD` 指定强密码，或从首次启动日志中取一次性随机密码后立即更换。
- 公开仓库前请确认 Git 历史中没有私钥、真实服务配置、试点数据或固定默认密码。
