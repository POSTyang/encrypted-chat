# 🔐 端到端加密聊天系统

基于 Node.js + Socket.IO + Web Crypto API 构建的安全聊天应用。

## ✨ 特性

- ✅ 端到端加密（AES-GCM）
- ✅ 房间管理（房主退出自动销毁）
- ✅ 图片粘贴发送
- ✅ 消息提示音（iOS 风格“叮咚”）
- ✅ 管理员后台（独立路径）
- ✅ 随机优美昵称

## 🚀 快速部署

### 1. 克隆代码
\`\`\`bash
git clone https://github.com/POSTyang/encrypted-chat.git
cd encrypted-chat
\`\`\`

### 2. 配置数据库
修改 \`server.js\` 中的数据库连接信息（用户名、密码、数据库名）。

### 3. 安装依赖
\`\`\`bash
npm install
\`\`\`

### 4. 初始化数据库
\`\`\`bash
mysql -u root -p < sql/init.sql
\`\`\`

### 5. 启动服务
\`\`\`bash
npm start
# 或使用 PM2 守护运行
pm2 start server.js --name chat-app
\`\`\`

## 👑 管理员后台

默认路径在启动日志中显示（如 `/admin-xxxxx`），默认账号 `admin`，密码 `123456`。

## 🔒 安全提醒

- 生产环境务必配置 HTTPS
- 修改默认管理员密码
- 限制 CORS 来源

## 📄 许可证

MIT
