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
  model?: string;
  status?: 'success' | 'error' | 'unknown';
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  tags?: string[];
}

interface SessionMetadata {
  model: string | null;
  status: 'success' | 'error' | 'unknown';
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  hasError: boolean;
}

interface TagData {
  color: string;
  count: number;
}

interface TagsStore {
  tags: Record<string, TagData>;
  sessionTags: Record<string, string[]>;
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

// ==================== 安全验证函数 ====================

/**
 * 验证路径组件，防止路径遍历攻击
 * @param input 用户输入的路径组件
 * @returns 安全的路径组件
 * @throws Error 如果路径包含非法字符
 */
function sanitizePathComponent(input: string | string[] | undefined): string {
  // 处理数组类型（取第一个元素）
  const strValue = Array.isArray(input) ? input[0] : input;
  
  if (!strValue || typeof strValue !== 'string') {
    throw new Error('Invalid path component: empty or not a string');
  }
  
  // 移除首尾空白
  const trimmed = strValue.trim();
  
  // 检查路径遍历攻击
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Invalid path component: path traversal detected');
  }
  
  // 检查绝对路径
  if (path.isAbsolute(trimmed)) {
    throw new Error('Invalid path component: absolute path not allowed');
  }
  
  // 检查空字节注入
  if (trimmed.includes('\0')) {
    throw new Error('Invalid path component: null byte detected');
  }
  
  // 限制长度
  if (trimmed.length > 255) {
    throw new Error('Invalid path component: too long');
  }
  
  return trimmed;
}

/**
 * 验证并构建安全的会话文件路径
 * @param projectId 项目ID
 * @param sessionId 会话ID
 * @returns 安全的文件路径
 */
function buildSecureSessionPath(projectId: string | string[] | undefined, sessionId: string | string[] | undefined): string {
  const safeProjectId = sanitizePathComponent(projectId);
  const safeSessionId = sanitizePathComponent(sessionId);
  
  // 确保 sessionId 以 session- 开头且以 .jsonl 结尾
  if (!safeSessionId.startsWith('session-')) {
    throw new Error('Invalid session ID: must start with "session-"');
  }
  
  const sessionFile = path.join(PROJECTS_DIR, safeProjectId, `${safeSessionId}.jsonl`);
  
  // 最终验证：确保路径在 PROJECTS_DIR 内
  const resolvedPath = path.resolve(sessionFile);
  const resolvedBase = path.resolve(PROJECTS_DIR);
  
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error('Invalid path: attempted to access outside projects directory');
  }
  
  return sessionFile;
}

/**
 * 验证并构建安全的项目目录路径
 * @param projectId 项目ID
 * @returns 安全的目录路径
 */
function buildSecureProjectPath(projectId: string | string[] | undefined): string {
  const safeProjectId = sanitizePathComponent(projectId);
  const projectPath = path.join(PROJECTS_DIR, safeProjectId);
  
  // 最终验证：确保路径在 PROJECTS_DIR 内
  const resolvedPath = path.resolve(projectPath);
  const resolvedBase = path.resolve(PROJECTS_DIR);
  
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error('Invalid path: attempted to access outside projects directory');
  }
  
  return projectPath;
}

// ==================== 速率限制中间件 ====================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * 简单的内存速率限制中间件
 * @param windowMs 时间窗口（毫秒）
 * @param max 最大请求数
 */
function createRateLimiter(windowMs: number = 15 * 60 * 1000, max: number = 100) {
  return (req: Request, res: Response, next: Function) => {
    // 获取客户端 IP
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    
    const entry = rateLimitStore.get(key);
    
    if (!entry || now > entry.resetTime) {
      // 创建新条目
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    if (entry.count >= max) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      return res.status(429).json({ 
        error: 'Too many requests', 
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.` 
      });
    }
    
    entry.count++;
    next();
  };
}

// 定期清理过期的速率限制条目
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // 每分钟清理一次

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
const TAGS_FILE = path.join(IFLOW_DIR, 'iflow-run-tags.json');

// 缓存配置
const CACHE_TTL = 5 * 60 * 1000;
let projectsCache: Project[] | null = null;
let projectsCacheTime = 0;

// WebSocket 客户端集合
const wsClients = new Set<WebSocket>();

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(currentDir, 'public')));

// API 速率限制（每 15 分钟最多 200 次请求）
const apiRateLimiter = createRateLimiter(15 * 60 * 1000, 200);
app.use('/api/', apiRateLimiter);

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

      // 加载标签数据
      const tagsData = await readTagsData();

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

        // 提取会话元数据
        const metadata = await extractSessionMetadata(sessionFile);

        // 获取会话标签
        const sessionKey = `${dirent.name}/${sessionId}`;
        const sessionTags = tagsData.sessionTags[sessionKey] || [];

        sessions.push({
          id: sessionId,
          file: file,
          mtime: mtime,
          preview: preview,
          model: metadata.model || undefined,
          status: metadata.status,
          tokenUsage: metadata.tokenUsage.total > 0 ? metadata.tokenUsage : undefined,
          tags: sessionTags
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
    
    // 使用安全验证函数构建路径
    let sessionFile: string;
    try {
      sessionFile = buildSecureSessionPath(projectId, sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }

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
    res.status(500).json({ error: 'Failed to read session' });
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
    
    // 使用安全验证函数构建路径
    let projectPath: string;
    try {
      projectPath = buildSecureProjectPath(projectId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project ID', message: (securityError as Error).message });
    }

    const dirExists = await fs.access(projectPath).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Project directory not found' });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      spawn('explorer.exe', [projectPath], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: projectPath });
    } else if (process.platform === 'darwin') {
      // 使用 spawn 替代 exec，避免命令注入
      spawn('open', [projectPath], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: projectPath });
    } else {
      // Linux 使用 spawn 替代 exec
      spawn('xdg-open', [projectPath], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: projectPath });
    }
  } catch (error) {
    console.error('Error opening directory:', error);
    res.status(500).json({ error: 'Failed to open directory' });
  }
});

// 打开会话的工作目录
app.get('/api/open-workdir/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    
    // 使用安全验证函数构建路径
    let sessionFile: string;
    try {
      sessionFile = buildSecureSessionPath(projectId, sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }

    const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
    if (!fileExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 读取会话文件获取工作目录
    const content = await fs.readFile(sessionFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // 从第一条用户消息中获取 cwd
    let workingDir: string | null = null;
    for (const line of lines) {
      const msg: Message = JSON.parse(line);
      if (msg.type === 'user' && msg.cwd) {
        workingDir = msg.cwd;
        break;
      }
    }

    if (!workingDir) {
      return res.status(400).json({ error: 'No working directory found in session' });
    }

    // 验证工作目录路径安全性
    const resolvedWorkingDir = path.resolve(workingDir);
    
    // 检查工作目录是否存在
    const dirExists = await fs.access(resolvedWorkingDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Working directory does not exist' });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      spawn('explorer.exe', [resolvedWorkingDir], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: resolvedWorkingDir });
    } else if (process.platform === 'darwin') {
      spawn('open', [resolvedWorkingDir], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: resolvedWorkingDir });
    } else {
      spawn('xdg-open', [resolvedWorkingDir], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: resolvedWorkingDir });
    }
  } catch (error) {
    console.error('Error opening working directory:', error);
    res.status(500).json({ error: 'Failed to open directory' });
  }
});

// 在项目的工作目录打开终端并执行 iflow（从最新会话获取工作目录）
app.get('/api/open-iflow-project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // 使用安全验证函数构建路径
    let projectDir: string;
    try {
      projectDir = buildSecureProjectPath(projectId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project ID', message: (securityError as Error).message });
    }

    // 检查项目目录是否存在
    const dirExists = await fs.access(projectDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // 获取所有会话文件并按修改时间排序
    const files = await fs.readdir(projectDir);
    const sessionFiles = files.filter(f => f.startsWith('session-') && f.endsWith('.jsonl'));
    
    if (sessionFiles.length === 0) {
      return res.status(404).json({ error: 'No sessions found in project' });
    }

    // 获取文件状态并按修改时间排序
    const fileStats = await Promise.all(
      sessionFiles.map(async (f) => {
        const filePath = path.join(projectDir, f);
        const stat = await fs.stat(filePath);
        return { file: f, mtime: stat.mtime };
      })
    );
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // 从最新的会话中获取工作目录
    let workingDir: string | null = null;
    for (const { file } of fileStats) {
      try {
        const sessionFile = path.join(projectDir, file);
        const content = await fs.readFile(sessionFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const msg: Message = JSON.parse(line);
            if (msg.type === 'user' && msg.cwd) {
              workingDir = msg.cwd;
              break;
            }
          } catch {
            // 跳过解析失败的行
            continue;
          }
        }
        if (workingDir) break;
      } catch {
        // 文件可能已被删除或正在写入，跳过此文件继续尝试下一个
        continue;
      }
    }

    if (!workingDir) {
      return res.status(400).json({ error: 'No working directory found in project sessions' });
    }

    // 验证并规范化工作目录路径
    const resolvedWorkingDir = path.resolve(workingDir);
    
    // 检查工作目录是否存在
    const workDirExists = await fs.access(resolvedWorkingDir).then(() => true).catch(() => false);
    if (!workDirExists) {
      return res.status(404).json({ error: 'Working directory does not exist' });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      // 使用 Base64 编码避免路径中的特殊字符问题
      const psScript = `Set-Location -LiteralPath '${resolvedWorkingDir.replace(/'/g, "''")}'; Write-Host 'Working directory: ${resolvedWorkingDir}'; Write-Host 'Starting iflow...'; iflow`;
      const base64Command = Buffer.from(psScript, 'utf16le').toString('base64');
      
      const child = spawn('cmd.exe', [
        '/c',
        'start',
        'powershell.exe',
        '-NoExit',
        '-EncodedCommand',
        base64Command
      ], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      
      console.log(`Opening iflow in project: ${resolvedWorkingDir}`);
      res.json({ success: true, path: resolvedWorkingDir });
    } else if (process.platform === 'darwin') {
      // 使用 sed 转义路径中的单引号
      const escapedPath = resolvedWorkingDir.replace(/'/g, "'\\''");
      const script = `tell application "Terminal" to do script "cd '${escapedPath}' && iflow"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: resolvedWorkingDir });
    } else {
      // Linux 终端，使用参数数组避免命令注入
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', `cd '${resolvedWorkingDir.replace(/'/g, "'\\''")}' && iflow; exec bash`] },
        { cmd: 'konsole', args: ['-e', 'bash', '-c', `cd '${resolvedWorkingDir.replace(/'/g, "'\\''")}' && iflow; exec bash`] },
        { cmd: 'xterm', args: ['-e', 'bash', '-c', `cd '${resolvedWorkingDir.replace(/'/g, "'\\''")}' && iflow; exec bash`] },
      ];

      let launched = false;
      for (const terminal of terminals) {
        try {
          spawn(terminal.cmd, terminal.args, { detached: true, stdio: 'ignore' });
          launched = true;
          break;
        } catch {
          continue;
        }
      }

      if (launched) {
        res.json({ success: true, path: resolvedWorkingDir });
      } else {
        res.status(500).json({ error: 'No suitable terminal emulator found' });
      }
    }
  } catch (error) {
    console.error('Error opening iflow for project:', error);
    res.status(500).json({ error: 'Failed to open iflow' });
  }
});

// 在工作目录打开终端并执行 iflow
app.get('/api/open-iflow/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    
    // 使用安全验证函数构建路径
    let sessionFile: string;
    try {
      sessionFile = buildSecureSessionPath(projectId, sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }

    const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
    if (!fileExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 读取会话文件获取工作目录
    const content = await fs.readFile(sessionFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // 从第一条用户消息中获取 cwd
    let workingDir: string | null = null;
    for (const line of lines) {
      const msg: Message = JSON.parse(line);
      if (msg.type === 'user' && msg.cwd) {
        workingDir = msg.cwd;
        break;
      }
    }

    if (!workingDir) {
      return res.status(400).json({ error: 'No working directory found in session' });
    }

    // 验证并规范化工作目录路径
    const resolvedWorkingDir = path.resolve(workingDir);
    
    // 检查工作目录是否存在
    const dirExists = await fs.access(resolvedWorkingDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Working directory does not exist' });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      // Windows: 使用 Base64 编码避免路径中的特殊字符问题
      const psScript = `Set-Location -LiteralPath '${resolvedWorkingDir.replace(/'/g, "''")}'; Write-Host 'Working directory: ${resolvedWorkingDir}'; Write-Host 'Starting iflow...'; iflow`;
      const base64Command = Buffer.from(psScript, 'utf16le').toString('base64');
      
      const child = spawn('cmd.exe', [
        '/c',
        'start',
        'powershell.exe',
        '-NoExit',
        '-EncodedCommand',
        base64Command
      ], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      
      console.log(`Opening iflow in: ${resolvedWorkingDir}`);
      res.json({ success: true, path: resolvedWorkingDir });
    } else if (process.platform === 'darwin') {
      // macOS: 转义路径中的单引号
      const escapedPath = resolvedWorkingDir.replace(/'/g, "'\\''");
      const script = `tell application "Terminal" to do script "cd '${escapedPath}' && iflow"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: resolvedWorkingDir });
    } else {
      // Linux: 尝试使用常见的终端模拟器
      const escapedPath = resolvedWorkingDir.replace(/'/g, "'\\''");
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', `cd '${escapedPath}' && iflow; exec bash`] },
        { cmd: 'konsole', args: ['-e', 'bash', '-c', `cd '${escapedPath}' && iflow; exec bash`] },
        { cmd: 'xterm', args: ['-e', 'bash', '-c', `cd '${escapedPath}' && iflow; exec bash`] },
      ];

      let launched = false;
      for (const terminal of terminals) {
        try {
          spawn(terminal.cmd, terminal.args, { detached: true, stdio: 'ignore' });
          launched = true;
          break;
        } catch {
          continue;
        }
      }

      if (launched) {
        res.json({ success: true, path: resolvedWorkingDir });
      } else {
        res.status(500).json({ error: 'No suitable terminal emulator found' });
      }
    }
  } catch (error) {
    console.error('Error opening iflow:', error);
    res.status(500).json({ error: 'Failed to open iflow' });
  }
});

// 删除会话 API
app.delete('/api/sessions/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    
    // 使用安全验证函数构建路径
    let sessionFile: string;
    try {
      sessionFile = buildSecureSessionPath(projectId, sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }

    // 检查文件是否存在
    const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
    if (!fileExists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 删除文件
    await fs.unlink(sessionFile);

    // 清除缓存
    projectsCache = null;
    projectsCacheTime = 0;

    // 通知客户端
    broadcast({
      type: 'session_deleted',
      projectId,
      sessionId,
      timestamp: Date.now()
    });

    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ==================== v1.2.0 批量操作 API ====================

// 批量删除会话
app.post('/api/sessions/batch-delete', async (req: Request, res: Response) => {
  try {
    const { sessions } = req.body;
    
    // 输入验证
    if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ error: 'No sessions provided' });
    }
    
    // 限制批量操作数量
    if (sessions.length > 100) {
      return res.status(400).json({ error: 'Too many sessions in batch (max 100)' });
    }
    
    // 验证每个会话对象的结构
    for (const s of sessions) {
      if (!s || typeof s.projectId !== 'string' || typeof s.sessionId !== 'string') {
        return res.status(400).json({ error: 'Invalid session format: each session must have projectId and sessionId as strings' });
      }
    }

    const results: Array<{ projectId: string; sessionId: string; success: boolean; error?: string }> = [];
    let deletedCount = 0;

    for (const { projectId, sessionId } of sessions) {
      try {
        // 使用安全验证函数构建路径
        let sessionFile: string;
        try {
          sessionFile = buildSecureSessionPath(projectId, sessionId);
        } catch (securityError) {
          results.push({ projectId, sessionId, success: false, error: 'Invalid project or session ID' });
          continue;
        }
        
        const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
        
        if (fileExists) {
          await fs.unlink(sessionFile);
          deletedCount++;
          results.push({ projectId, sessionId, success: true });
        } else {
          results.push({ projectId, sessionId, success: false, error: 'Session not found' });
        }
      } catch (err) {
        results.push({ projectId, sessionId, success: false, error: 'Failed to delete' });
      }
    }

    // 清除缓存
    projectsCache = null;
    projectsCacheTime = 0;

    // 通知客户端
    broadcast({
      type: 'sessions_batch_deleted',
      count: deletedCount,
      timestamp: Date.now()
    });

    res.json({ 
      success: true, 
      deletedCount, 
      results 
    });
  } catch (error) {
    console.error('Error batch deleting sessions:', error);
    res.status(500).json({ error: 'Failed to batch delete sessions' });
  }
});

// ==================== v1.2.0 标签系统 API ====================

// 获取所有标签
app.get('/api/tags', async (req: Request, res: Response) => {
  try {
    const tagsData = await readTagsData();
    
    // 计算每个标签的使用次数
    const tagCounts: Record<string, number> = {};
    for (const sessionTags of Object.values(tagsData.sessionTags)) {
      for (const tag of sessionTags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // 更新标签计数
    for (const tagName of Object.keys(tagsData.tags)) {
      tagsData.tags[tagName].count = tagCounts[tagName] || 0;
    }

    res.json({
      tags: tagsData.tags,
      sessionTags: tagsData.sessionTags
    });
  } catch (error) {
    console.error('Error getting tags:', error);
    res.status(500).json({ error: 'Failed to get tags', message: (error as Error).message });
  }
});

// 添加新标签
app.post('/api/tags', async (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    
    // 输入验证
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const tagName = name.toLowerCase().trim();
    
    // 限制标签名称长度
    if (tagName.length === 0 || tagName.length > 50) {
      return res.status(400).json({ error: 'Tag name must be between 1 and 50 characters' });
    }
    
    // 验证标签名称格式（只允许字母、数字、中文、连字符和下划线）
    if (!/^[\w\u4e00-\u9fa5-]+$/.test(tagName)) {
      return res.status(400).json({ error: 'Tag name can only contain letters, numbers, Chinese characters, hyphens and underscores' });
    }
    
    // 验证颜色格式
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Invalid color format (must be #RRGGBB)' });
    }

    const tagsData = await readTagsData();

    if (tagsData.tags[tagName]) {
      return res.status(400).json({ error: 'Tag already exists' });
    }

    tagsData.tags[tagName] = {
      color: color || generateTagColor(),
      count: 0
    };

    await saveTagsData(tagsData);

    res.json({
      success: true,
      tag: { name: tagName, ...tagsData.tags[tagName] }
    });
  } catch (error) {
    console.error('Error adding tag:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

// 删除标签
app.delete('/api/tags/:name', async (req: Request, res: Response) => {
  try {
    const name = req.params.name;
    const tagName = String(name).toLowerCase();

    const tagsData = await readTagsData();

    if (!tagsData.tags[tagName]) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // 删除标签定义
    delete tagsData.tags[tagName];

    // 从所有会话中移除该标签
    for (const sessionKey of Object.keys(tagsData.sessionTags)) {
      tagsData.sessionTags[sessionKey] = tagsData.sessionTags[sessionKey].filter(t => t !== tagName);
    }

    await saveTagsData(tagsData);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag', message: (error as Error).message });
  }
});

// 获取会话标签
app.get('/api/sessions/:projectId/:sessionId/tags', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionKey = `${projectId}/${sessionId}`;

    const tagsData = await readTagsData();
    const tags = tagsData.sessionTags[sessionKey] || [];

    res.json({ tags });
  } catch (error) {
    console.error('Error getting session tags:', error);
    res.status(500).json({ error: 'Failed to get session tags', message: (error as Error).message });
  }
});

// 设置会话标签
app.post('/api/sessions/:projectId/:sessionId/tags', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const { tags } = req.body;
    
    // 验证路径参数
    try {
      sanitizePathComponent(projectId);
      sanitizePathComponent(sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }

    // 输入验证
    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }
    
    // 限制标签数量
    if (tags.length > 20) {
      return res.status(400).json({ error: 'Too many tags (max 20)' });
    }

    const sessionKey = `${projectId}/${sessionId}`;

    const tagsData = await readTagsData();

    // 标准化并验证标签名称
    const normalizedTags: string[] = [];
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const tagName = t.toLowerCase().trim();
      
      // 跳过无效标签
      if (tagName.length === 0 || tagName.length > 50) continue;
      if (!/^[\w\u4e00-\u9fa5-]+$/.test(tagName)) continue;
      
      normalizedTags.push(tagName);
    }

    // 确保所有标签都存在
    for (const tagName of normalizedTags) {
      if (!tagsData.tags[tagName]) {
        tagsData.tags[tagName] = {
          color: generateTagColor(),
          count: 0
        };
      }
    }

    // 设置会话标签
    tagsData.sessionTags[sessionKey] = normalizedTags;

    await saveTagsData(tagsData);

    // 清除缓存以更新标签计数
    projectsCache = null;
    projectsCacheTime = 0;

    res.json({ success: true, tags: normalizedTags });
  } catch (error) {
    console.error('Error setting session tags:', error);
    res.status(500).json({ error: 'Failed to set session tags' });
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

// ==================== v1.2.0 标签系统功能 ====================

// 读取标签数据
async function readTagsData(): Promise<TagsStore> {
  try {
    const fileExists = await fs.access(TAGS_FILE).then(() => true).catch(() => false);
    if (!fileExists) {
      return { tags: {}, sessionTags: {} };
    }
    const content = await fs.readFile(TAGS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading tags data:', error);
    return { tags: {}, sessionTags: {} };
  }
}

// 保存标签数据
async function saveTagsData(data: TagsStore): Promise<void> {
  try {
    await fs.writeFile(TAGS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving tags data:', error);
    throw error;
  }
}

// 生成随机颜色
function generateTagColor(): string {
  const colors = [
    '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16',
    '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
    '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
    '#EC4899', '#F43F5E'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// 提取会话元数据（模型、状态、Token 消耗）
async function extractSessionMetadata(sessionFile: string): Promise<SessionMetadata> {
  const defaultMetadata: SessionMetadata = {
    model: null,
    status: 'unknown',
    tokenUsage: { input: 0, output: 0, total: 0 },
    hasError: false
  };

  try {
    const content = await fs.readFile(sessionFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let hasError = false;
    let model: string | null = null;

    for (const line of lines) {
      try {
        const msg: Message = JSON.parse(line);

        // 提取模型名称
        if (msg.message?.model && !model) {
          model = msg.message.model;
        }

        // 计算 Token 消耗
        if (msg.message?.usage) {
          totalInputTokens += msg.message.usage.input_tokens || 0;
          totalOutputTokens += msg.message.usage.output_tokens || 0;
        }

        // 检测是否有错误
        if (msg.message?.content && Array.isArray(msg.message.content)) {
          const toolResults = msg.message.content.filter(c => c.type === 'tool_result');
          for (const tr of toolResults) {
            if (tr.is_error === true) {
              hasError = true;
            }
          }
        }
      } catch {
        // 跳过解析错误的消息
      }
    }

    return {
      model,
      status: hasError ? 'error' : 'success',
      tokenUsage: {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalInputTokens + totalOutputTokens
      },
      hasError
    };
  } catch (error) {
    console.error('Error extracting session metadata:', error);
    return defaultMetadata;
  }
}

// ==================== v1.3.0 P1 AI 功能 API ====================

// 带超时的 fetch 辅助函数
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 30000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// AI 配置存储路径
const AI_CONFIG_FILE = path.join(IFLOW_DIR, 'iflow-run-ai-config.json');

interface AIConfig {
  provider: 'iflow' | 'openai';
  apiKeySource: 'env' | 'custom';
  apiKey: string;
  model: string;
}

// 从环境变量获取 API Key
function getApiKeyFromEnv(provider: 'iflow' | 'openai'): string | undefined {
  if (provider === 'iflow') {
    return process.env.IFLOW_API_KEY;
  }
  return process.env.OPENAI_API_KEY;
}

// 读取 AI 配置（支持环境变量 API Key）
async function readAIConfig(): Promise<AIConfig> {
  let config: AIConfig = {
    provider: 'iflow',
    apiKeySource: 'env',
    apiKey: '',
    model: 'iflow-rome-30ba3b'
  };

  try {
    const fileExists = await fs.access(AI_CONFIG_FILE).then(() => true).catch(() => false);
    if (fileExists) {
      const content = await fs.readFile(AI_CONFIG_FILE, 'utf8');
      const savedConfig = JSON.parse(content);
      config = {
        provider: savedConfig.provider || 'iflow',
        apiKeySource: savedConfig.apiKeySource || 'env',
        apiKey: savedConfig.apiKey || '',
        model: savedConfig.model || 'iflow-rome-30ba3b'
      };
    }
  } catch (error) {
    console.error('Error reading AI config:', error);
  }

  // 如果选择环境变量来源，从环境变量获取 API Key
  if (config.apiKeySource === 'env' || !config.apiKey) {
    const envKey = getApiKeyFromEnv(config.provider);
    if (envKey) {
      config.apiKey = envKey;
      config.apiKeySource = 'env';
    }
  }

  return config;
}

// 保存 AI 配置
async function saveAIConfig(config: AIConfig): Promise<void> {
  try {
    const configToSave = {
      provider: config.provider,
      apiKeySource: config.apiKeySource,
      apiKey: config.apiKey,
      model: config.model
    };
    await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving AI config:', error);
    throw error;
  }
}

// 获取 AI 配置 API
app.get('/api/ai/config', async (req: Request, res: Response) => {
  try {
    const config = await readAIConfig();
    
    res.json({
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      apiKeyPreview: config.apiKey ? `${config.apiKey.substring(0, 8)}...` : '',
      apiKeySource: config.apiKeySource,
      model: config.model
    });
  } catch (error) {
    console.error('Error getting AI config:', error);
    res.status(500).json({ error: 'Failed to get AI config', message: (error as Error).message });
  }
});

// 保存 AI 配置 API
app.post('/api/ai/config', async (req: Request, res: Response) => {
  try {
    const { provider, apiKeySource, apiKey, model } = req.body;

    const newConfig: AIConfig = {
      provider: provider || 'iflow',
      apiKeySource: apiKeySource || 'env',
      apiKey: apiKey || '',
      model: model || 'iflow-rome-30ba3b'
    };

    await saveAIConfig(newConfig);

    res.json({
      success: true,
      config: {
        provider: newConfig.provider,
        hasApiKey: !!newConfig.apiKey,
        model: newConfig.model
      }
    });
  } catch (error) {
    console.error('Error saving AI config:', error);
    res.status(500).json({ error: 'Failed to save AI config', message: (error as Error).message });
  }
});

// 测试 AI 连接 API
app.post('/api/ai/test', async (req: Request, res: Response) => {
  try {
    const config = await readAIConfig();

    if (!config.apiKey) {
      return res.status(400).json({ 
        error: '未配置 API Key', 
        message: '请在设置中输入 API Key 或设置环境变量 IFLOW_API_KEY / OPENAI_API_KEY' 
      });
    }

    const baseUrl = config.provider === 'iflow'
      ? 'https://apis.iflow.cn/v1'
      : 'https://api.openai.com/v1';

    // 发送测试请求（10秒超时）
    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'Say "test ok"' }],
          max_tokens: 20
        })
      }, 10000);
    } catch (fetchError) {
      const errorMsg = (fetchError as Error).name === 'AbortError'
        ? 'Request timeout (10s)'
        : (fetchError as Error).message;
      return res.status(504).json({ error: 'API connection timeout', message: errorMsg });
    }

    // 解析响应内容
    let responseData: any;
    try {
      responseData = await response.json();
    } catch {
      return res.status(400).json({ error: 'API 返回格式错误', message: '无法解析响应内容' });
    }

    if (response.ok) {
      // 检查响应是否包含有效的 choices
      if (responseData.choices && Array.isArray(responseData.choices) && responseData.choices.length > 0) {
        res.json({ success: true, message: 'API 连接成功' });
      } else if (responseData.error) {
        // HTTP 200 但响应体包含错误信息
        res.status(400).json({
          error: 'API Key 无效',
          message: responseData.error.message || JSON.stringify(responseData.error)
        });
      } else {
        res.status(400).json({
          error: 'API 响应异常',
          message: '未返回有效内容，请检查 API Key 或模型配置'
        });
      }
    } else {
      // 解析错误信息
      const errorMsg = responseData.error?.message
        || responseData.message
        || responseData.error
        || `HTTP ${response.status}`;
      res.status(400).json({ error: 'API 连接失败', message: errorMsg });
    }
  } catch (error) {
    console.error('Error testing AI connection:', error);
    res.status(500).json({ error: 'Failed to test AI connection' });
  }
});

// AI 聊天 API（非流式）
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages, context } = req.body;
    const config = await readAIConfig();

    if (!config.apiKey) {
      return res.status(400).json({ error: 'API Key not configured' });
    }
    
    const baseUrl = config.provider === 'iflow' 
      ? 'https://apis.iflow.cn/v1'
      : 'https://api.openai.com/v1';
    
    // 构建系统消息
    const systemMessage = {
      role: 'system',
      content: `你是 iFlow CLI 会话查看器的 AI 助手。你的任务是帮助用户理解和分析他们的 AI 会话记录。

你可以：
1. 分析当前会话的内容，提供摘要和关键决策
2. 解释代码片段和工具调用
3. 回答技术问题
4. 提供优化建议

${context ? `当前会话上下文：
项目: ${context.projectName || '未知'}
会话 ID: ${context.sessionId || '未知'}
${context.sessionSummary ? `会话摘要: ${context.sessionSummary}` : ''}` : ''}

请用中文回答，保持简洁专业。`
    };
    
    // 发送请求（60秒超时）
    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [systemMessage, ...messages],
          temperature: 0.7,
          max_tokens: 2000
        })
      }, 60000);
    } catch (fetchError) {
      const errorMsg = (fetchError as Error).name === 'AbortError' 
        ? 'Request timeout (60s)' 
        : (fetchError as Error).message;
      return res.status(504).json({ error: 'AI API timeout', message: errorMsg });
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }; status?: string; msg?: string };
      // 支持 OpenAI 和 iflow 两种错误格式
      const errorMsg = errorData.error?.message || errorData.msg || `HTTP ${response.status}`;
      return res.status(response.status).json({ 
        error: 'AI API error', 
        message: errorMsg
      });
    }
    
    const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; error?: any; status?: string; msg?: string };
    
    console.log('AI Chat API Response:', JSON.stringify(data, null, 2).substring(0, 500));
    
    if (!data.choices || data.choices.length === 0) {
      // 支持 OpenAI 和 iflow 两种错误格式
      const errorMsg = data.error?.message || data.msg || 'No choices in response';
      console.error('AI Chat API empty choices. Full response:', JSON.stringify(data, null, 2));
      return res.status(500).json({ error: 'AI API returned empty response', message: errorMsg });
    }
    
    res.json({
      success: true,
      message: data.choices[0].message.content,
      usage: data.usage
    });
  } catch (error) {
    console.error('Error in AI chat:', error);
    res.status(500).json({ error: 'Failed to chat with AI', message: (error as Error).message });
  }
});

// 会话分析 API
app.post('/api/ai/analyze', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.body;
    const config = await readAIConfig();

    if (!config.apiKey) {
      return res.status(400).json({ error: 'API Key not configured' });
    }
    
    // 使用安全验证函数构建路径
    let sessionFile: string;
    try {
      sessionFile = buildSecureSessionPath(projectId, sessionId);
    } catch (securityError) {
      return res.status(400).json({ error: 'Invalid project or session ID', message: (securityError as Error).message });
    }
    
    const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
    
    if (!fileExists) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const content = await fs.readFile(sessionFile, 'utf8');
    const messages = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    
    // 提取会话摘要信息
    let summary = '';
    let totalTokens = 0;
    let toolCalls: string[] = [];
    let errors = 0;
    const userMessages: Array<{ index: number; content: string }> = [];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type === 'user') {
        const msgContent = extractContent(msg);
        if (msgContent) {
          if (!summary) {
            summary = msgContent.substring(0, 500);
          }
          // 提取用户消息用于提问改进建议（最多5条，每条截取前200字）
          if (userMessages.length < 5) {
            userMessages.push({ index: i + 1, content: msgContent.substring(0, 200) });
          }
        }
      }
      if (msg.message?.usage) {
        totalTokens += (msg.message.usage.input_tokens || 0) + (msg.message.usage.output_tokens || 0);
      }
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        const tools = msg.message.content.filter((c: any) => c.type === 'tool_use').map((c: any) => c.name);
        toolCalls.push(...tools);
        const hasError = msg.message.content.some((c: any) => c.type === 'tool_result' && c.is_error);
        if (hasError) errors++;
      }
    }
    
    // 构建分析提示
    const analysisPrompt = `请分析以下 AI 会话记录，提供结构化的分析报告。

会话基本信息：
- 会话 ID: ${sessionId}
- 消息数量: ${messages.length}
- Token 消耗: ${totalTokens}
- 工具调用次数: ${toolCalls.length}
- 错误次数: ${errors}

工具使用情况：
${toolCalls.length > 0 ? [...new Set(toolCalls)].map(t => `- ${t}: ${toolCalls.filter(x => x === t).length} 次`).join('\n') : '- 无工具调用'}

用户提问列表：
${userMessages.length > 0 ? userMessages.map((m, i) => `${i + 1}. ${m.content}`).join('\n') : '无用户提问'}

会话内容摘要：
${summary || '（无摘要）'}

请以 JSON 格式返回分析结果，包含以下字段：
{
  "summary": "会话摘要（2-3句话）",
  "decisions": ["关键决策1", "关键决策2"],
  "problems": ["解决的问题1", "解决的问题2"],
  "stats": {
    "efficiency": "效率评估（高/中/低）",
    "complexity": "复杂度评估（高/中/低）",
    "quality": "代码质量评估（高/中/低）"
  },
  "suggestions": ["改进建议1", "改进建议2"],
  "promptImprovements": [
    {
      "original": "用户原始提问",
      "improved": "改进后的提问示例",
      "reason": "改进理由（简短说明为什么这样改更好）"
    }
  ]
}

注意：promptImprovements 只针对可以明显改进的提问，如果提问已经很清晰则不需要改进。最多返回 3 条改进建议。

只返回 JSON，不要包含其他内容。`;

    const baseUrl = config.provider === 'iflow' 
      ? 'https://apis.iflow.cn/v1'
      : 'https://api.openai.com/v1';
    
    // 发送请求（60秒超时）
    let response: globalThis.Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: analysisPrompt }],
          temperature: 0.3,
          max_tokens: 2000
        })
      }, 60000);
    } catch (fetchError) {
      const errorMsg = (fetchError as Error).name === 'AbortError' 
        ? 'Request timeout (60s)' 
        : (fetchError as Error).message;
      return res.status(504).json({ error: 'AI API timeout', message: errorMsg });
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string }; status?: string; msg?: string };
      // 支持 OpenAI 和 iflow 两种错误格式
      const errorMsg = errorData.error?.message || errorData.msg || `HTTP ${response.status}`;
      return res.status(response.status).json({ 
        error: 'AI API error', 
        message: errorMsg
      });
    }
    
    const data = await response.json() as { choices: Array<{ message: { content: string } }>; error?: any; status?: string; msg?: string };
    
    // 调试日志
    console.log('AI API Response:', JSON.stringify(data, null, 2).substring(0, 500));
    
    if (!data.choices || data.choices.length === 0) {
      // 支持 OpenAI 和 iflow 两种错误格式
      const errorMsg = data.error?.message || data.msg || 'No choices in response';
      console.error('AI API empty choices. Full response:', JSON.stringify(data, null, 2));
      return res.status(500).json({ error: 'AI API returned empty response', message: errorMsg });
    }
    
    const analysisText = data.choices[0].message.content;
    
    // 解析 JSON 结果
    let analysis;
    try {
      // 尝试提取 JSON 内容
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = { summary: analysisText, decisions: [], problems: [], stats: {}, suggestions: [] };
      }
    } catch {
      analysis = { summary: analysisText, decisions: [], problems: [], stats: {}, suggestions: [] };
    }
    
    res.json({
      success: true,
      analysis: {
        ...analysis,
        metadata: {
          sessionId,
          projectId,
          messageCount: messages.length,
          totalTokens,
          toolCallCount: toolCalls.length,
          errorCount: errors,
          topTools: [...new Set(toolCalls)].slice(0, 5).map(t => ({
            name: t,
            count: toolCalls.filter(x => x === t).length
          }))
        }
      }
    });
  } catch (error) {
    console.error('Error analyzing session:', error);
    res.status(500).json({ error: 'Failed to analyze session', message: (error as Error).message });
  }
});

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

// PID 文件和状态文件路径（用于后台运行模式）
const homeDir = os.homedir();
const iflowRunDir = path.join(homeDir, '.iflow-run');
const statusFile = path.join(iflowRunDir, 'iflow-run.status');

// 写入状态文件（用于后台运行模式显示端口）
function writeStatusFile(port: number): void {
  try {
    // 确保目录存在
    if (!fsSync.existsSync(iflowRunDir)) {
      fsSync.mkdirSync(iflowRunDir, { recursive: true });
    }
    fsSync.writeFileSync(statusFile, JSON.stringify({
      port,
      pid: process.pid,
      startTime: Date.now()
    }), 'utf8');
  } catch (error) {
    console.error('Failed to write status file:', (error as Error).message);
  }
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
      
      // 写入状态文件，供后台运行模式读取实际端口
      writeStatusFile(availablePort);
    });
  } catch (error) {
    console.error('Failed to start server:', (error as Error).message);
    process.exit(1);
  }
})();