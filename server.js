const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();

// 获取当前文件所在目录（用于 npm 全局安装后正确找到静态文件）
// 使用 __filename 获取 server.js 所在的目录，而不是 require.main.filename
const currentDir = path.dirname(__filename);

// 支持通过环境变量或命令行参数配置
const args = process.argv.slice(2);
const PORT = process.env.PORT || process.env.IFLOW_RUN_PORT || args.find(arg => arg.startsWith('--port='))?.split('=')[1] || 3000;

// 自动检测 iflow 目录
let IFLOW_DIR = process.env.IFLOW_DIR || process.env.IFLOW_RUN_DIR || args.find(arg => arg.startsWith('--dir='))?.split('=')[1];
if (!IFLOW_DIR) {
  const homeDir = os.homedir();
  IFLOW_DIR = path.join(homeDir, '.iflow');
}
const PROJECTS_DIR = path.join(IFLOW_DIR, 'projects');

// 缓存配置
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
let projectsCache = null;
let projectsCacheTime = 0;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(currentDir, 'public')));

// 读取所有项目
app.get('/api/projects', async (req, res) => {
  try {
    // 检查缓存
    const now = Date.now();
    if (projectsCache && (now - projectsCacheTime) < CACHE_TTL) {
      return res.json(projectsCache);
    }

    // 检查目录是否存在
    const dirExists = await fs.access(PROJECTS_DIR).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.json([]);
    }

    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const projects = [];

    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;

      const projectPath = path.join(PROJECTS_DIR, dirent.name);
      const files = await fs.readdir(projectPath);
      const sessionFiles = files
        .filter(file => file.startsWith('session-') && file.endsWith('.jsonl'))
        .sort((a, b) => {
          const statA = fsSync.statSync(path.join(projectPath, a));
          const statB = fsSync.statSync(path.join(projectPath, b));
          return statB.mtimeMs - statA.mtimeMs;
        });

      if (sessionFiles.length === 0) continue;

      const sessions = [];
      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '');
        const sessionFile = path.join(projectPath, file);
        const stats = fsSync.statSync(sessionFile);
        const mtime = stats.mtime;

        // 优化：只读取文件的前几行来获取预览
        let preview = '暂无预览';
        try {
          const content = await fs.readFile(sessionFile, 'utf8');
          const lines = content.split('\n').filter(line => line.trim()).slice(0, 2); // 只读前2行
          if (lines.length > 0) {
            const firstMessage = JSON.parse(lines[0]);
            if (firstMessage.message && firstMessage.message.content) {
              const msgContent = firstMessage.message.content;
              if (typeof msgContent === 'string') {
                preview = msgContent;
              } else if (Array.isArray(msgContent)) {
                const textParts = msgContent.filter(c => c.type === 'text').map(c => c.text);
                if (textParts.length > 0) {
                  preview = textParts.join(' ');
                }
              }
              // 限制预览文本长度
              if (preview.length > 100) {
                preview = preview.substring(0, 100) + '...';
              }
            }
          }
        } catch (err) {
          console.error(`Error reading session preview for ${file}:`, err);
        }

        sessions.push({
          id: sessionId,
          file: file,
          mtime: mtime,
          preview: preview
        });
      }

      projects.push({
        id: dirent.name,
        name: dirent.name.replace(/^-/g, ''),
        sessionCount: sessionFiles.length,
        sessions: sessions
      });
    }

    // 更新缓存
    projectsCache = projects;
    projectsCacheTime = now;

    res.json(projects);
  } catch (error) {
    console.error('Error reading projects:', error);
    res.status(500).json({ error: 'Failed to read projects', message: error.message });
  }
});

// 读取会话消息
app.get('/api/sessions/:projectId/:sessionId', async (req, res) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionFile = path.join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`);

    const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
    if (!fileExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const content = await fs.readFile(sessionFile, 'utf8');
    const messages = content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    res.json(messages);
  } catch (error) {
    console.error('Error reading session:', error);
    res.status(500).json({ error: 'Failed to read session', message: error.message });
  }
});

// 搜索会话（支持高级搜索和分页）
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type || 'all'; // all, user, assistant
    const startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
    const endDate = req.query.endDate ? parseInt(req.query.endDate) : null;

    if (!query.trim()) {
      return res.json({ results: [], total: 0, page, limit });
    }

    const dirExists = await fs.access(PROJECTS_DIR).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.json({ results: [], total: 0, page, limit });
    }

    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const project of entries) {
      if (!project.isDirectory()) continue;

      const projectPath = path.join(PROJECTS_DIR, project.name);
      const files = await fs.readdir(projectPath);
      const sessionFiles = files.filter(file => file.startsWith('session-') && file.endsWith('.jsonl'));

      for (const file of sessionFiles) {
        const sessionFile = path.join(projectPath, file);
        const sessionId = file.replace('.jsonl', '');

        try {
          const content = await fs.readFile(sessionFile, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());

          // 搜索每条消息（不再限制每个会话只返回一个结果）
          for (const line of lines) {
            const msg = JSON.parse(line);
            const messageContent = extractContent(msg);

            // 类型过滤
            if (type !== 'all' && msg.type !== type) continue;

            // 时间范围过滤
            if (startDate && msg.timestamp < startDate) continue;
            if (endDate && msg.timestamp > endDate) continue;

            if (messageContent.toLowerCase().includes(lowerQuery)) {
              results.push({
                projectId: project.name,
                projectName: project.name,
                sessionId: sessionId,
                content: messageContent.substring(0, 200) + (messageContent.length > 200 ? '...' : ''),
                type: msg.type,
                timestamp: msg.timestamp,
                uuid: msg.uuid
              });
            }
          }
        } catch (err) {
          console.error(`Error searching session ${file}:`, err);
        }
      }
    }

    // 按时间排序（最新的在前）
    results.sort((a, b) => b.timestamp - a.timestamp);

    // 分页
    const total = results.length;
    const startIndex = (page - 1) * limit;
    const paginatedResults = results.slice(startIndex, startIndex + limit);

    res.json({
      results: paginatedResults,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error searching sessions:', error);
    res.status(500).json({ error: 'Failed to search sessions', message: error.message });
  }
});

// 打开项目目录
app.get('/api/open-directory/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    // 检查目录是否存在
    const dirExists = await fs.access(projectPath).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Project directory not found' });
    }

    // 根据操作系统打开目录
    const { exec, spawn } = require('child_process');

    if (process.platform === 'win32') {
      // Windows - 使用 spawn 避免命令行参数问题
      spawn('explorer.exe', [projectPath], { detached: true });
      res.json({ success: true, path: projectPath });
    } else if (process.platform === 'darwin') {
      // macOS
      exec(`open "${projectPath}"`, (error) => {
        if (error) {
          console.error('Failed to open directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: projectPath });
      });
    } else {
      // Linux
      exec(`xdg-open "${projectPath}"`, (error) => {
        if (error) {
          console.error('Failed to open directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: projectPath });
      });
    }
  } catch (error) {
    console.error('Error opening directory:', error);
    res.status(500).json({ error: 'Failed to open directory', message: error.message });
  }
});

// 提取消息内容
function extractContent(msg) {
  if (!msg.message || !msg.message.content) return '';

  const content = msg.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textParts = content.filter(c => c.type === 'text').map(c => c.text);
    return textParts.join(' ');
  }
  return JSON.stringify(content);
}

// 检测端口是否可用
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

// 自动查找可用端口
async function findAvailablePort(startPort) {
  let port = startPort;
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    port++;
    attempts++;
  }

  throw new Error(`Unable to find available port after ${maxAttempts} attempts`);
}

// 启动服务器
(async () => {
  try {
    const availablePort = await findAvailablePort(PORT);
    
    if (availablePort !== PORT) {
      console.log(`Port ${PORT} is occupied, using port ${availablePort} instead`);
    }
    
    app.listen(availablePort, () => {
      console.log(`iflow-run server running at http://localhost:${availablePort}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
})();