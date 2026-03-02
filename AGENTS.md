# iFlow-run 项目说明

## 项目信息

- **GitHub**: https://github.com/KeWen-Du/iflow-run
- **npm**: https://www.npmjs.com/package/iflow-run
- **版本**: 1.1.4
- **作者**: dukewen <dukewen666@gmail.com>
- **许可证**: MIT

## 项目概述

iflow-run 是一个用于查看 iFlow CLI 会话轨迹和历史会话的 Web 应用程序。它提供了一个可视化的界面来浏览、搜索和分析 iFlow CLI 的交互历史。

### 主要功能

- **项目管理**: 浏览和查看 iFlow CLI 创建的所有项目
- **会话浏览**: 查看每个项目下的所有会话历史
- **消息详情**: 查看完整的对话消息，包括用户消息、助手响应、工具调用和工具结果
- **预览功能**: 快速预览会话的第一条消息内容
- **会话上下文**: 显示工作目录、Git 分支、版本信息等环境上下文
- **消息筛选**: 支持按类型筛选消息（用户/助手/工具调用）和内容搜索
- **消息内搜索**: 在会话详情中搜索消息内容
- **Token 统计**: 显示模型名称、Token 消耗、执行时间和预估成本
- **使用统计**: 统计面板显示项目、会话、消息、工具调用和 Token 消耗总量
- **环境追踪**: 检测并显示工作目录和 Git 分支的变更
- **导出功能**: 支持导出会话为 Markdown 或 JSON 格式
- **消息目录**: 快速导航到用户消息
- **打开 iflow**: 在会话工作目录打开终端并执行 iflow 命令
- **打开目录**: 在系统文件管理器中打开项目目录
- **跳转底部**: 快速跳转到最后一条消息
- **后台运行**: 支持后台运行服务，方便长期使用
- **端口自动检测**: 自动检测端口占用并使用下一个可用端口
- **分页加载**: 支持项目列表分页加载，提升大量项目时的性能
- **Markdown 渲染**: 支持 Markdown 格式消息的渲染和代码高亮
- **键盘快捷键**: 支持键盘快捷键操作，提升使用效率
- **实时更新**: 通过 WebSocket 实时监听会话文件变更

### 技术栈

- **后端**: Node.js + Express + TypeScript
- **前端**: 纯 HTML5 + CSS3 + JavaScript (无框架)
- **样式**: 自定义 CSS，使用现代暗色主题设计
- **模块系统**: CommonJS
- **开发工具**:
  - TypeScript - 类型安全的 JavaScript 超集
  - Vite - 现代化的前端构建工具
  - ESLint - JavaScript 代码检查工具
  - Prettier - 代码格式化工具
  - tsx - TypeScript 执行和监视工具
- **运行时依赖**:
  - express (^4.18.2) - Web 服务器框架
  - cors (^2.8.5) - 跨域资源共享支持
  - marked (^17.0.3) - Markdown 解析器
  - highlight.js (^11.11.1) - 代码语法高亮
  - ws (^8.19.0) - WebSocket 服务器

### 模块系统配置

项目使用 CommonJS 模块系统，通过 `package.json` 中的 `"type": "commonjs"` 明确指定。

**关键实现细节**：
- `server.ts` 使用 TypeScript 编写，编译后生成 `dist/server.js`
- 为避免与 CommonJS 内置变量 `__dirname` 冲突，使用 `currentDir` 变量存储当前目录路径
- 代码示例：
  ```typescript
  const currentDir = path.join(__dirname, '..');
  app.use(express.static(path.join(currentDir, 'public')));
  ```

### 开发和构建

**构建命令**：
```bash
# 完整构建（服务器 + 前端）
npm run build

# 仅构建服务器
npm run build:server

# 仅构建前端
npm run build:frontend

# 开发模式（热重载）
npm run dev:watch

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 代码检查并修复
npm run lint:fix

# 代码格式化
npm run format
```

**配置说明**：
- `"type": "commonjs"` 确保所有 `.js` 文件被当作 CommonJS 模块处理
- 避免了 Node.js 将文件误认为 ES Module 导致的 `require is not defined` 错误

## 项目结构

```
iflow-run/
├── server.js              # Express 服务器主文件（保留兼容）
├── server.ts              # TypeScript 源文件
├── package.json           # 项目配置和依赖
├── tsconfig.json          # TypeScript 配置
├── vite.config.ts         # Vite 配置
├── .eslintrc.json         # ESLint 配置
├── .prettierrc            # Prettier 配置
├── bin/                   # 全局可执行文件
│   └── iflow-run.js      # CLI 入口文件
├── dist/                  # TypeScript 编译输出目录
│   └── server.js         # 编译后的服务器文件
├── public/                # 前端静态文件目录
│   ├── index.html         # 主页面
│   ├── app.js             # 前端应用逻辑
│   ├── enhancements.js    # 扩展功能模块
│   ├── styles.css         # 主样式文件
│   ├── enhancements.css   # 扩展功能样式
│   ├── test.html          # 测试页面
│   └── test-features.html # 功能测试页面
└── test_screenshot.py     # 自动化测试脚本（Selenium）
```

## 构建和运行

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

# 后台运行
iflow-run --daemon
# 或
iflow-run -d

# 停止后台服务
iflow-run --stop

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
# 安装依赖
npm install

# 构建项目
npm run build

# 启动服务器
npm start

# 开发模式（热重载）
npm run dev:watch

# 或直接使用 Node.js 运行
node server.js

# 指定端口
node server.js --port=8080

# 指定数据目录
node server.js --dir=/path/to/.iflow
```

应用启动后，访问 http://localhost:3000 即可使用。

### 数据目录

应用默认从以下路径读取 iFlow CLI 项目数据：

- **Windows**: `C:\Users\{用户名}\.iflow\projects`
- **Linux/Mac**: `~/.iflow/projects`

通过以下方式修改数据目录：
- 命令行参数：`--dir=/path/to/.iflow`
- 环境变量：`IFLOW_RUN_DIR=/path/to/.iflow`
- 修改 `server.js` 中的 `IFLOW_DIR` 常量

## API 接口

### 获取所有项目

**端点**: `GET /api/projects`

**特性**: 支持 5 分钟缓存，提升加载速度

**查询参数**:
- `page` (number): 页码，默认 1
- `limit` (number): 每页结果数，默认 20
- `search` (string): 搜索关键词（可选）

**响应示例**:
```json
{
  "projects": [
    {
      "id": "project-id",
      "name": "项目名称",
      "sessionCount": 5,
      "sessions": [
        {
          "id": "session-1234567890",
          "file": "session-1234567890.jsonl",
          "mtime": "2024-01-01T12:00:00.000Z",
          "preview": "会话预览文本..."
        }
      ]
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

### 获取会话详情

**端点**: `GET /api/sessions/:projectId/:sessionId`

**响应示例**:
```json
[
  {
    "uuid": "message-uuid",
    "type": "user",
    "timestamp": 1704110400000,
    "cwd": "/path/to/project",
    "gitBranch": "main",
    "version": "1.0.0",
    "message": {
      "content": "用户消息内容"
    }
  },
  {
    "uuid": "message-uuid",
    "type": "assistant",
    "timestamp": 1704110401000,
    "message": {
      "model": "glm-4.7",
      "usage": {
        "input_tokens": 1000,
        "output_tokens": 500
      },
      "content": [
        {
          "type": "text",
          "text": "助手响应文本"
        },
        {
          "type": "tool_use",
          "name": "tool_name",
          "input": { /* 工具输入参数 */ }
        }
      ]
    }
  }
]
```

### 搜索会话

**端点**: `GET /api/search`

**查询参数**:
- `q` (string): 搜索关键词
- `page` (number): 页码，默认 1
- `limit` (number): 每页结果数，默认 20
- `type` (string): 消息类型筛选，可选值：`all`、`user`、`assistant`，默认 `all`
- `startDate` (number): 开始时间戳（可选）
- `endDate` (number): 结束时间戳（可选）

**响应示例**:
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

### 打开项目目录

**端点**: `GET /api/open-directory/:projectId`

**描述**: 在系统文件管理器中打开项目目录

**响应示例**:
```json
{
  "success": true,
  "path": "/path/to/project"
}
```

### 打开 iflow

**端点**: `GET /api/open-iflow/:projectId/:sessionId`

**描述**: 在会话的工作目录中打开终端并执行 iflow 命令

**平台支持**:
- **Windows**: 使用 PowerShell 打开新窗口
- **macOS**: 使用 Terminal.app 打开新窗口
- **Linux**: 支持 gnome-terminal、konsole、xterm

**响应示例**:
```json
{
  "success": true,
  "path": "/path/to/working/directory"
}
```

**错误响应**:
```json
{
  "error": "No working directory found in session"
}
```

## WebSocket 实时更新

**端点**: `ws://localhost:3000/ws`

应用通过 WebSocket 实时监听会话文件变更，当检测到新会话或会话更新时自动刷新列表。

**消息格式**:
```json
{
  "type": "session_update",
  "timestamp": 1704110400000
}
```

## 架构与性能优化

### 后端优化

1. **异步文件操作**: 使用 `fs.promises` 替代同步文件操作，提升并发处理能力
2. **缓存机制**: 项目列表数据缓存 5 分钟，减少磁盘 I/O
3. **预览优化**: 只读取会话文件前 2 行生成预览，大幅提升加载速度
4. **高级搜索**: 支持关键词搜索、类型筛选、时间范围过滤和分页
5. **分页加载**: 支持项目列表分页，减少大数据量时的内存占用
6. **实时更新**: 使用 WebSocket 监听文件系统变更，实时推送更新
7. **端口检测**: 自动检测端口占用并切换到可用端口

### 前端优化

1. **O(1) 查找**: 使用 `Map` 数据结构存储工具结果，将工具结果查找从 O(n²) 优化到 O(1)
2. **事件委托**: 使用事件委托处理动态元素的点击事件，减少内存占用
3. **分页加载**: 消息采用分页加载机制（初始 50 条，滚动加载更多），避免大量数据一次性渲染
4. **虚拟目录**: 建立用户消息索引，提供快速导航功能
5. **Markdown 渲染**: 使用 marked 库实现高效的 Markdown 解析
6. **代码高亮**: 使用 highlight.js 实现语法高亮，提升代码可读性
7. **WebSocket 重连**: 自动重连机制，最多尝试 5 次

## 开发约定

### 前端代码规范

- **模块化**: 使用模块化函数组织代码（如 `loadProjects()`, `renderMessages()` 等）
- **事件处理**: 使用事件委托处理动态元素的点击事件
- **异步操作**: 所有 API 调用使用 `async/await` 模式
- **错误处理**: 所有可能失败的异步操作都包含 `try-catch` 块
- **DOM 操作**: 优先使用 `innerHTML` 批量更新，避免频繁的 DOM 操作
- **性能优化**: 使用 Map、Set 等数据结构优化查找性能
- **日志规范**: 仅保留初始化日志和错误/警告日志，移除调试日志

### 后端代码规范

- **路由设计**: RESTful API 风格
- **错误处理**: 所有路由都包含错误处理，返回适当的 HTTP 状态码
- **文件操作**: 使用异步方法读取文件，提升性能
- **数据验证**: 检查文件和目录是否存在再进行操作
- **缓存策略**: 合理使用缓存减少磁盘 I/O
- **类型安全**: 使用 TypeScript 类型定义确保类型安全

### 样式规范

- **CSS 变量**: 使用 CSS 变量定义颜色、间距等设计令牌
- **响应式设计**: 支持桌面端和移动端布局
- **动画**: 使用 CSS 动画提供流畅的用户体验
- **主题**: 采用现代暗色主题，使用玻璃拟态效果
- **组件化**: 样式按组件组织，便于维护和复用

### 消息格式处理

应用支持以下消息内容格式：

1. **字符串**: 直接显示文本内容
2. **数组**: 提取 `type: "text"` 的内容项
3. **工具调用**: 渲染 `type: "tool_use"` 的内容
4. **工具结果**: 渲染 `type: "tool_result"` 的内容
5. **模型信息**: 提取 `message.model` 和 `message.usage` 显示模型和 Token 统计
6. **环境上下文**: 提取 `cwd`、`gitBranch`、`version` 显示环境信息

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 快速搜索 |
| `Esc` | 关闭模态框/返回 |
| `Ctrl/Cmd + R` | 刷新项目列表 |

## 配置说明

### 命令行参数

```bash
iflow-run [选项]
```

- `--port=<端口>`: 指定服务器端口（默认：3000，如被占用会自动使用下一个可用端口）
- `--dir=<目录>`: 指定 iflow 数据目录（默认：~/.iflow）
- `-d, --daemon`: 后台运行服务器
- `--stop`: 停止后台运行的服务
- `-h, --help`: 显示帮助信息
- `-v, --version`: 显示版本号

### 环境变量

- `IFLOW_RUN_PORT`: 指定服务器端口
- `IFLOW_RUN_DIR`: 指定 iflow 数据目录
- `PORT`: 服务器端口（备选）
- `IFLOW_DIR`: iflow 数据目录（备选）

### 配置优先级

1. 命令行参数（最高优先级）
2. IFLOW_RUN_* 环境变量
3. PORT/IFLOW_DIR 环境变量
4. 默认值（最低优先级）

## 测试

项目包含一个基于 Selenium 的自动化测试脚本 `test_screenshot.py`，用于测试应用的主要功能：

### 运行测试

```bash
# 安装 Python 依赖
pip install selenium webdriver-manager

# 运行测试脚本
python test_screenshot.py
```

### 测试功能

1. 加载首页并截图项目列表
2. 点击第一个项目并截图会话列表
3. 点击第一个会话并截图会话详情
4. 测试返回按钮功能

## 发布到 npm

### 1. 登录 npm

```bash
npm login
```

### 2. 更新版本号

```bash
# 小版本更新（新功能，向后兼容）
npm version minor

# 补丁更新（bug 修复）
npm version patch

# 主版本更新（破坏性更改）
npm version major
```

### 3. 发布包

```bash
npm publish
```

### 4. 验证发布

```bash
npm view iflow-run
npm install -g iflow-run
```

## 注意事项

- **数据路径**: 应用默认读取用户 `.iflow` 目录，如需修改请使用命令行参数或环境变量
- **端口自动检测**: 默认端口为 3000，如果端口被占用会自动使用下一个可用端口（3001、3002 等），启动时会显示实际使用的端口
- **端口配置**: 如需修改请使用 `--port` 参数或 `IFLOW_RUN_PORT` 环境变量
- **后台运行**: 使用 `iflow-run --daemon` 可以在后台启动服务，使用 `iflow-run --stop` 停止后台服务
- **PID 文件**: 后台运行时会在 `~/.iflow-run/iflow-run.pid` 存储进程 ID
- **CORS**: 应用已启用 CORS 支持，允许跨域访问
- **静态文件**: `public` 目录作为静态文件根目录，提供前端资源
- **缓存**: 项目列表数据缓存 5 分钟，如需刷新可点击刷新按钮
- **实时连接**: WebSocket 连接状态通过右上角指示器显示，断开时自动重连

## 常见问题

### Q: 应用启动后无法读取项目数据？

A: 请检查以下几点：
1. 确认 `.iflow` 目录路径是否正确
2. 确认目录下是否有 `projects` 子目录
3. 确认项目目录中是否有 `session-*.jsonl` 文件
4. 尝试使用 `--dir` 参数指定正确的 iflow 目录

### Q: 消息显示为空？

A: 可能的原因：
1. 会话文件格式不正确
2. 消息内容不包含可显示的文本（只有工具结果等）
3. 消息格式不符合预期（缺少 `message.content` 字段）
4. 使用了消息筛选功能，当前筛选条件下没有匹配的消息

### Q: 如何修改界面主题？

A: 编辑 `public/styles.css` 文件中的 CSS 变量（`:root` 选择器内）即可自定义颜色方案。

### Q: 工具结果显示不完整？

A: 工具结果默认折叠显示，点击工具结果的标题栏可以展开查看完整内容。长结果会自动截断，可以通过复制按钮获取完整内容。

### Q: Token 统计不准确？

A: Token 统计依赖于会话消息中的 `usage` 字段。如果模型未返回该信息，则无法显示 Token 统计。

### Q: 环境变更提示没有显示？

A: 环境变更提示需要消息中包含 `cwd` 或 `gitBranch` 字段。只有当这些字段发生变化时才会显示提示。

### Q: 启动时提示端口被占用怎么办？

A: 从 v1.0.1 版本开始，应用会自动检测端口占用情况。如果 3000 端口被占用，会自动使用下一个可用端口（3001、3002 等），并在启动时显示实际使用的端口号。你也可以使用 `--port` 参数指定其他端口。

### Q: 如何在后台运行 iflow-run？

A: 使用 `iflow-run --daemon` 或 `iflow-run -d` 可以在后台启动服务。停止后台服务使用 `iflow-run --stop`。

### Q: 后台服务无法停止怎么办？

A: 如果 `iflow-run --stop` 无法停止服务，可以手动删除 PID 文件：
- Windows: `del %USERPROFILE%\.iflow-run\iflow-run.pid`
- Linux/Mac: `rm ~/.iflow-run/iflow-run.pid`
然后使用系统命令查找并终止 node 进程。

### Q: "打开 iflow" 功能不工作？

A: 请检查：
1. 会话中是否包含有效的工作目录（`cwd` 字段）
2. 工作目录是否仍然存在
3. 是否已安装 iflow CLI 并添加到系统 PATH

## 未来改进方向

- [x] 添加实时查看正在进行的会话功能（WebSocket）
- [x] 优化大量会话的性能（服务端分页加载）
- [x] 添加键盘快捷键支持
- [x] 在工作目录打开 iflow 功能
- [x] 消息内搜索和筛选功能
- [ ] 添加用户配置功能（自定义数据目录、主题、缓存时间等）
- [ ] 添加更多筛选条件（按模型、按状态等）
- [ ] 支持批量操作（删除、导出多个会话）
- [ ] 添加数据可视化图表（Token 使用趋势、工具使用统计等）
- [ ] 支持多语言界面
- [ ] 支持会话比较功能
- [ ] 添加单元测试和 E2E 测试
