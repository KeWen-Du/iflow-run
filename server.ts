import express, { Request, Response } from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import cors from 'cors';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import type { ParsedQs } from 'qs';

// 类型定义
interface Message {
  uuid?: string;
  type: 'user' | 'assistant';
  timestamp: number;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  message: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    content?: string | MessageContent[];
  };
}

interface MessageContent {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
}

interface Session {
  id: string;
  file: string;
  mtime: Date;
  preview: string;
}

interface Project {
  id: string;
  name: string;
  sessionCount: number;
  sessions: Session[];
}

interface SearchResult {
  projectId: string;
  projectName: string;
  sessionId: string;
  content: string;
  type: string;
  timestamp: number;
  uuid: string;
}

// 全局变量
const app = express();
// 修正：从当前目录（项目根目录）而不是 dist 目录查找 public 文件夹
const currentDir = path.join(__dirname, '..');

// 配置
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='))?.split('=')[1];
const PORT = parseInt(getQueryParam(process.env.PORT || process.env.IFLOW_RUN_PORT || portArg, '3000'));

let IFLOW_DIR = getQueryParam(process.env.IFLOW_DIR || process.env.IFLOW_RUN_DIR || args.find(arg => arg.startsWith('--dir='))?.split('=')[1]);
if (!IFLOW_DIR) {
  const homeDir = os.homedir();
  IFLOW_DIR = path.join(homeDir, '.iflow');
}
const PROJECTS_DIR = path.join(IFLOW_DIR, 'projects');

// 缓存配置
const CACHE_TTL = 5 * 60 * 1000;
let projectsCache: Project[] | null = null;
let projectsCacheTime = 0;

// WebSocket 客户端集合
const wsClients = new Set<WebSocket>();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(currentDir, 'public')));

// 创建 HTTP 服务器用于 WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// WebSocket 连接处理
wss.on('connection', (ws: WebSocket) => {
  console.log('WebSocket 客户端已连接');
  wsClients.add(ws);

  ws.on('close', () => {
    console.log('WebSocket 客户端已断开');
    wsClients.delete(ws);
  });

  ws.on('error', (error: Error) => {
    console.error('WebSocket 错误:', error);
  });
});

// 广播消息到所有客户端
function broadcast(message: any) {
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// 监听会话文件变化
async function watchSessions() {
  try {
    const dirExists = await fs.access(PROJECTS_DIR).then(() => true).catch(() => false);
    if (!dirExists) return;

    fsSync.watch(PROJECTS_DIR, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.startsWith('session-') || eventType === 'rename')) {
        console.log(`检测到会话文件变化: ${filename}`);
        // 清除缓存
        projectsCache = null;
        projectsCacheTime = 0;
        // 通知客户端
        broadcast({
          type: 'session_update',
          timestamp: Date.now()
        });
      }
    });
  } catch (error) {
    console.error('监听会话文件变化失败:', error);
  }
}

// 辅助函数：安全获取字符串查询参数
function getQueryParam(value: string | ParsedQs | (string | ParsedQs)[] | undefined, defaultValue: string = ''): string {
  if (Array.isArray(value)) {
    return String(value[0] || defaultValue);
  }
  return String(value || defaultValue);
}

// 获取所有项目（支持分页）
app.get('/api/projects', async (req: Request, res: Response) => {
  try {
    const page = parseInt(getQueryParam(req.query.page, '1')) || 1;
    const limit = parseInt(getQueryParam(req.query.limit, '20')) || 20;
    const search = getQueryParam(req.query.search, '').toLowerCase();

    // 检查缓存
    const now = Date.now();
    if (projectsCache && (now - projectsCacheTime) < CACHE_TTL && !search) {
      // 分页
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedProjects = projectsCache.slice(startIndex, endIndex);
      
      return res.json({
        projects: paginatedProjects,
        total: projectsCache.length,
        page,
        limit,
        totalPages: Math.ceil(projectsCache.length / limit)
      });
    }

    // 检查目录是否存在
    const dirExists = await fs.access(PROJECTS_DIR).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.json({ projects: [], total: 0, page, limit, totalPages: 0 });
    }

    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const projects: Project[] = [];

    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      
      // 搜索过滤
      if (search && !dirent.name.toLowerCase().includes(search)) continue;

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

      const sessions: Session[] = [];
      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '');
        const sessionFile = path.join(projectPath, file);
        const stats = fsSync.statSync(sessionFile);
        const mtime = stats.mtime;

        // 优化：只读取文件的前几行来获取预览
        let preview = '暂无预览';
        try {
          const content = await fs.readFile(sessionFile, 'utf8');
          const lines = content.split('\n').filter(line => line.trim()).slice(0, 2);
          if (lines.length > 0) {
            const firstMessage: Message = JSON.parse(lines[0]);
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

    // 分页
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedProjects = projects.slice(startIndex, endIndex);

    res.json({
      projects: paginatedProjects,
      total: projects.length,
      page,
      limit,
      totalPages: Math.ceil(projects.length / limit)
    });
  } catch (error) {
    console.error('Error reading projects:', error);
    res.status(500).json({ error: 'Failed to read projects', message: (error as Error).message });
  }
});

// 读取会话消息
app.get('/api/sessions/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);

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
    res.status(500).json({ error: 'Failed to read session', message: (error as Error).message });
  }
});

// 搜索会话
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const query = getQueryParam(req.query.q, '');
    const page = parseInt(getQueryParam(req.query.page, '1')) || 1;
    const limit = parseInt(getQueryParam(req.query.limit, '20')) || 20;
    const type = getQueryParam(req.query.type, 'all');
    const startDate = req.query.startDate ? parseInt(getQueryParam(req.query.startDate)) : null;
    const endDate = req.query.endDate ? parseInt(getQueryParam(req.query.endDate)) : null;

    if (!query.trim()) {
      return res.json({ results: [], total: 0, page, limit });
    }

    const dirExists = await fs.access(PROJECTS_DIR).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.json({ results: [], total: 0, page, limit });
    }

    const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
    const results: SearchResult[] = [];
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

          for (const line of lines) {
            const msg: Message = JSON.parse(line);
            const messageContent = extractContent(msg);

            if (type !== 'all' && msg.type !== type) continue;
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
                uuid: msg.uuid || ''
              });
            }
          }
        } catch (err) {
          console.error(`Error searching session ${file}:`, err);
        }
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

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
    res.status(500).json({ error: 'Failed to search sessions', message: (error as Error).message });
  }
});

// 打开项目目录
app.get('/api/open-directory/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, String(projectId));

    const dirExists = await fs.access(projectPath).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Project directory not found' });
    }

    const { exec, spawn } = require('child_process');

    if (process.platform === 'win32') {
      spawn('explorer.exe', [projectPath], { detached: true });
      res.json({ success: true, path: projectPath });
    } else if (process.platform === 'darwin') {
      exec(`open "${projectPath}"`, (error: Error | null) => {
        if (error) {
          console.error('Failed to open directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: projectPath });
      });
    } else {
      exec(`xdg-open "${projectPath}"`, (error: Error | null) => {
        if (error) {
          console.error('Failed to open directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: projectPath });
      });
    }
  } catch (error) {
    console.error('Error opening directory:', error);
    res.status(500).json({ error: 'Failed to open directory', message: (error as Error).message });
  }
});

// 提取消息内容
function extractContent(msg: Message): string {
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
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();

    server.once('error', (err: any) => {
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
async function findAvailablePort(startPort: number): Promise<number> {
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
    
    // 启动文件监听
    watchSessions();

    server.listen(availablePort, () => {
      console.log(`iflow-run server running at http://localhost:${availablePort}`);
      console.log(`WebSocket server running at ws://localhost:${availablePort}/ws`);
    });
  } catch (error) {
    console.error('Failed to start server:', (error as Error).message);
    process.exit(1);
  }
})();