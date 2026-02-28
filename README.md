# iFlow-run

一个用于查看 iFlow CLI 会话轨迹和历史会话的 Web 应用程序。

## 功能特性

- 📁 **项目管理** - 浏览和查看 iFlow CLI 创建的所有项目
- 💬 **会话浏览** - 查看每个项目下的所有会话历史
- 🔍 **消息详情** - 查看完整的对话消息，包括用户消息、助手响应、工具调用和工具结果
- 👁️ **预览功能** - 快速预览会话的第一条消息内容
- 🎨 **现代 UI** - 采用暗色主题和玻璃拟态设计，提供优雅的用户体验
- 📱 **响应式设计** - 支持桌面端和移动端访问

## 技术栈

- **后端**: Node.js + Express
- **前端**: 纯 HTML5 + CSS3 + JavaScript (无框架)
- **样式**: 自定义 CSS，使用现代暗色主题
- **依赖**:
  - express (^4.18.2)
  - cors (^2.8.5)

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
├── server.js           # Express 服务器
├── package.json        # 项目配置
├── public/             # 前端静态文件
│   ├── index.html      # 主页面
│   ├── app.js          # 前端逻辑
│   ├── styles.css      # 样式文件
│   └── test.html       # 测试页面
└── test_screenshot.py  # 自动化测试脚本
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

## 截图

![项目列表](https://via.placeholder.com/400x300/1a1a24/ffffff?text=Projects+List)
![会话列表](https://via.placeholder.com/400x300/1a1a24/ffffff?text=Sessions+List)
![会话详情](https://via.placeholder.com/400x300/1a1a24/ffffff?text=Session+Detail)

## 开发

### 代码规范

- **前端**: 使用模块化函数组织代码，采用事件委托处理动态元素
- **后端**: RESTful API 风格，包含完善的错误处理
- **样式**: 使用 CSS 变量定义设计令牌，支持主题定制

### 自定义主题

编辑 `public/styles.css` 文件中的 CSS 变量：

```css
:root {
  --bg-primary: #0a0a0f;
  --accent-primary: #6366f1;
  /* 更多颜色变量... */
}
```

## 常见问题

### 无法读取项目数据？

请确认：
1. `.iflow` 目录路径是否正确
2. 目录下是否有 `projects` 子目录
3. 项目目录中是否有 `session-*.jsonl` 文件

### 消息显示为空？

可能原因：
- 会话文件格式不正确
- 消息内容不包含可显示的文本
- 消息格式不符合预期

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