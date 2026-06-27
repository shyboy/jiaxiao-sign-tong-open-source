# 家校签收通

`家校签收通` 是一个面向学校自托管部署的家长通知签收系统。它把纸质告知书、安全承诺书等流程，从“学生带回家签字、老师手工统计”改成“学校发布、家长在线确认、系统自动统计、班主任处理异常”。

## 功能

- 学校管理员：维护学校资料、年级班级、教师账号，发布通知并导出归档材料。
- 班主任：导入本班学生名单，转发签收链接，查看进度，处理未签和异常记录。
- 家长：通过通知链接绑定学生，阅读通知，手写签名并提交确认。
- 平台运维：开通学校空间和首个学校管理员账号，必要时重置账号。
- 归档导出：支持 Excel 明细、单份 PDF、班级 PDF zip。

## 技术栈

- 前端：Next.js / React / Tailwind CSS
- 后端：Node.js / Express / SQLite
- 文件生成：PDFKit / archiver

## 快速启动

启动后端：

```bash
cd server
npm install
npm run start
```

启动前端：

```bash
cd web
corepack pnpm install
corepack pnpm dev
```

默认地址：

- 前端：http://localhost:3000
- 运维后台：http://localhost:3000/ops
- 后端：http://localhost:8088
- 健康检查：http://localhost:8088/api/health

新数据库首次启动会创建平台运维账号。建议显式设置 `OPS_ADMIN_USERNAME` 和 `OPS_ADMIN_PASSWORD`；如果没有设置密码，后端会生成一次性随机密码并输出到首次启动日志。

## 环境变量

后端参考：[`server/.env.example`](server/.env.example)

前端参考：[`web/.env.example`](web/.env.example)

生产部署前至少配置：

- `PUBLIC_APP_BASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `CORS_ORIGIN`
- `OPS_ADMIN_PASSWORD`
- `PDF_FONT_PATH`

真实数据部署必须使用 HTTPS，并确保上传、签名、导出文件只能通过鉴权接口访问。

## 数据与安全边界

- 不要提交 `server/data/`、数据库、上传附件、签名图片、导出 PDF/zip 或日志。
- 不要把密码、Token、Cookie、SSH 私钥、数据库密钥写进代码或文档。
- `OPS_ADMIN_PASSWORD` 应在生产环境中设置为强密码。
- `server/data` 不应作为公网静态目录暴露。
- 公开仓库前请确认 Git 历史中没有真实服务配置、试点数据或固定默认密码。

更多安全说明见 [`SECURITY.md`](SECURITY.md)。

## 文档

- [`02-实施配置与部署约定.md`](02-实施配置与部署约定.md)：部署、目录、端口和备份约定。
- [`03-前端开发说明.md`](03-前端开发说明.md)：前端入口、本地开发和构建说明。
- [`OPEN_SOURCE_CHECKLIST.md`](OPEN_SOURCE_CHECKLIST.md)：发布前检查清单。

## 贡献

欢迎通过 Issue 反馈问题或建议。提交 PR 前请确认：

- 没有提交运行数据、日志、密钥或本地环境文件。
- 前端改动能通过 `corepack pnpm build`。
- 后端改动至少能通过 `node --check server/server.js`。

## License

MIT
