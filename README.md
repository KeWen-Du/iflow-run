# iFlow-run

一个用于查看 iFlow CLI 会话轨迹和历史会话的 Web 应用程序。

[![npm version](https://badge.fury.io/js/iflow-run.svg)](https://www.npmjs.com/package/iflow-run)
[![GitHub stars](https://img.shields.io/github/stars/KeWen-Du/iflow-run?style=social)](https://github.com/KeWen-Du/iflow-run)

## 功能特性

- 📁 **项目管理** - 浏览和查看 iFlow CLI 创建的所有项目
- 💬 **会话浏览** - 查看每个项目下的所有会话历史
- 🔍 **消息详情** - 查看完整的对话消息，包括用户消息、助手响应、工具调用和工具结果
- 👁️ **预览功能** - 快速预览会话的第一条消息内容
- 📊 **会话上下文** - 显示工作目录、Git 分支、版本信息等环境上下文
- 🔎 **消息筛选** - 支持按类型筛选消息（用户/助手/工具调用）和内容搜索
- 💰 **Token 统计** - 显示模型名称、Token 消耗、执行时间和预估成本
- 🔄 **环境追踪** - 检测并显示工作目录和 Git 分支的变更
- 📥 **导出功能** - 支持导出会话为 Markdown 或 JSON 格式
- 📋 **消息目录** - 快速导航到用户消息
- 📄 **分页加载** - 支持项目列表分页加载，提升大量项目时的性能
- 🎨 **Markdown 渲染** - 支持 Markdown 格式消息的渲染和代码高亮
- ⌨️ **键盘快捷键** - 支持键盘快捷键操作，提升使用效率
- 🔄 **实时更新** - 通过 WebSocket 实时监听会话文件变更
- 🎨 **现代 UI** - 采用暗色主题和玻璃拟态设计，提供优雅的用户体验
- 📱 **响应式设计** - 支持桌面端和移动端访问

## 技术栈

- **后端**: Node.js + Express + TypeScript
- **前端**: 纯 HTML5 + CSS3 + JavaScript (无框架)
- **样式**: 自定义 CSS，使用现代暗色主题
- **主要依赖**:
  - express (^4.18.2) - Web 服务器框架
  - cors (^2.8.5) - 跨域资源共享
  - marked (^17.0.3) - Markdown 解析
  - highlight.js (^11.9.0) - 代码语法高亮
  - ws (^8.16.0) - WebSocket 支持
- **开发工具**:
  - TypeScript - 类型安全
  - Vite - 现代化构建工具
  - ESLint - 代码检查
  - Prettier - 代码格式化

## 快速开始

### 环境要求

- Node.js (v14 或更高版本)
- npm (随 Node.js 一起安装)

### 方式一：通过 npm 全局安装（推荐）

```bash
# 全局安装
npm install -g iflow-run

# 启动服务
iflow-run

# 访问应用
# 打开浏览器访问 http://localhost:3000
```

#### 命令行参数

```bash
# 指定端口
iflow-run --port=8080

# 指定 iflow 数据目录
iflow-run --dir=/path/to/.iflow

# 使用环境变量
IFLOW_RUN_PORT=8080 iflow-run
IFLOW_RUN_DIR=/path/to/.iflow iflow-run

# 查看帮助
iflow-run --help

# 查看版本
iflow-run --version
```

### 方式二：本地运行

```bash
# 克隆或下载项目
cd iflow-run

# 安装依赖
npm install

# 启动服务器
npm start

# 或使用 npx 运行（如果已全局安装）
npx iflow-run

# 访问应用
# 打开浏览器访问 http://localhost:3000
```

应用会自动读取您系统中的 iFlow CLI 会话数据（默认路径为 `~/.iflow/projects`）。

## 项目结构

```
iflow-run/
├── server.js              # Express 服务器
├── package.json           # 项目配置
├── bin/                   # 全局可执行文件
│   └── iflow-run.js      # CLI 入口文件
├── public/                # 前端静态文件
│   ├── index.html         # 主页面
│   ├── app.js             # 前端逻辑
│   ├── styles.css         # 样式文件
│   └── test.html          # 测试页面
└── test_screenshot.py     # 自动化测试脚本
```

## API 接口

### 获取所有项目

```http
GET /api/projects
```

返回所有项目和它们的会话列表。

### 获取会话详情

```http
GET /api/sessions/:projectId/:sessionId
```

返回指定会话的完整消息记录。

### 搜索会话

```http
GET /api/search?q=关键词&page=1&limit=20&type=all
```

查询参数：
- `q` (string): 搜索关键词
- `page` (number): 页码，默认 1
- `limit` (number): 每页结果数，默认 20
- `type` (string): 消息类型筛选，可选值：`all`、`user`、`assistant`，默认 `all`
- `startDate` (number): 开始时间戳（可选）
- `endDate` (number): 结束时间戳（可选）

响应示例：
```json
{
  "results": [
    {
      "projectId": "project-id",
      "projectName": "项目名称",
      "sessionId": "session-1234567890",
      "content": "消息内容预览...",
      "type": "user",
      "timestamp": 1704110400000,
      "uuid": "message-uuid"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

## 配置

### 通过命令行参数配置

```bash
# 修改端口
iflow-run --port=8080

# 修改 iflow 数据目录
iflow-run --dir=/path/to/.iflow
```

### 通过环境变量配置

```bash
# Linux/Mac
export IFLOW_RUN_PORT=8080
export IFLOW_RUN_DIR=/path/to/.iflow
iflow-run

# Windows
set IFLOW_RUN_PORT=8080
set IFLOW_RUN_DIR=C:\path\to\.iflow
iflow-run
```

### 默认配置

- **端口**: 3000
- **数据目录**: `~/.iflow` (用户主目录下的 .iflow 文件夹)
  - Windows: `C:\Users\{用户名}\.iflow`
  - Linux/Mac: `/home/{用户名}/.iflow`

## 测试

项目包含一个基于 Selenium 的自动化测试脚本：

```bash
# 安装 Python 依赖
pip install selenium webdriver-manager

# 运行测试
python test_screenshot.py
```

测试会自动执行以下操作：
1. 加载首页并截图
2. 点击第一个项目并截图会话列表
3. 点击第一个会话并截图会话详情
4. 测试返回按钮功能



## 开发

### 环境要求

- Node.js (v14 或更高版本)
- npm (随 Node.js 一起安装)

### 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start

# 编译 TypeScript
npm run build

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 代码格式化
npm run format
```

### 代码规范

- **前端**: 使用模块化函数组织代码，采用事件委托处理动态元素
- **后端**: RESTful API 风格，包含完善的错误处理
- **样式**: 使用 CSS 变量定义设计令牌，支持主题定制
- **TypeScript**: 严格模式，完整的类型定义

### 自定义主题

编辑 `public/styles.css` 文件中的 CSS 变量：

```css
:root {
  --bg-primary: #0a0a0f;
  --accent-primary: #6366f1;
  /* 更多颜色变量... */
}
```

### 键盘快捷键

- `Ctrl+K` - 聚焦搜索框
- `Ctrl+N` - 创建新会话
- `Ctrl+L` - 刷新列表
- `Esc` - 关闭当前会话

## API 文档

### 主要端点

- `GET /api/projects` - 获取项目列表（支持分页和搜索）
- `GET /api/sessions/:projectId/:sessionId` - 获取会话详情
- `GET /api/search` - 搜索会话消息
- `WS /ws` - WebSocket 实时更新

详细的 API 文档请参考 [AGENTS.md](./AGENTS.md)

## 更新日志

### v1.1.5 (2026-03-02)

**新功能**
- 项目列表新增"打开 iflow"按钮，可直接从项目列表打开 iflow（悬停显示）

**优化**
- 侧边栏收起功能优化，改进收起后的布局对齐

**修复**
- 修复白色主题下切换按钮图标未变色的问题
- 修复控制台语法错误 `Illegal return statement`

### v1.1.4

- WebSocket 实时更新功能
- 键盘快捷键支持

### v1.1.3

- 消息目录快速导航功能
- 分页加载优化

## 常见问题

### 无法读取项目数据？

请确认：
1. `.iflow` 目录路径是否正确
2. 目录下是否有 `projects` 子目录
3. 项目目录中是否有 `session-*.jsonl` 文件
4. 尝试使用 `--dir` 参数指定正确的 iflow 目录

### 消息显示为空？

可能原因：
- 会话文件格式不正确
- 消息内容不包含可显示的文本
- 消息格式不符合预期
- 使用了消息筛选功能，当前筛选条件下没有匹配的消息

### 工具结果显示不完整？

工具结果默认折叠显示，点击工具结果的标题栏可以展开查看完整内容。长结果会自动截断，可以通过复制按钮获取完整内容。

### Token 统计不准确？

Token 统计依赖于会话消息中的 `usage` 字段。如果模型未返回该信息，则无法显示 Token 统计。

### 环境变更提示没有显示？

环境变更提示需要消息中包含 `cwd` 或 `gitBranch` 字段。只有当这些字段发生变化时才会显示提示。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 致谢

- [Express](https://expressjs.com/) - Web 框架
- [Inter Font](https://rsms.me/inter/) - 字体
- [Selenium](https://www.selenium.dev/) - 自动化测试

## 发布到 npm

如果您是项目维护者，需要将包发布到 npm，请按照以下步骤操作：

### 1. 登录 npm

```bash
npm login
```

### 2. 检查包名是否可用

```bash
npm view iflow-run
```

如果返回错误，说明包名可用。

### 3. 更新版本号

在 `package.json` 中更新版本号（遵循语义化版本规范）：

```bash
# 小版本更新（新功能，向后兼容）
npm version minor

# 补丁更新（bug 修复）
npm version patch

# 主版本更新（破坏性更改）
npm version major
```

### 4. 发布包

```bash
npm publish
```

### 5. 验证发布

```bash
npm view iflow-run
npm install -g iflow-run
```

### 注意事项

- 确保在发布前已经通过测试
- 检查 `.npmignore` 文件，排除不需要发布的文件
- 发布后无法删除，只能弃用或更新
- 建议先发布到 `npm publish --dry-run` 进行预检查