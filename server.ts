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

// 打开会话的工作目录
app.get('/api/open-workdir/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);

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

    // 检查工作目录是否存在
    const dirExists = await fs.access(workingDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Working directory does not exist', path: workingDir });
    }

    const { exec, spawn } = require('child_process');

    if (process.platform === 'win32') {
      spawn('explorer.exe', [workingDir], { detached: true });
      res.json({ success: true, path: workingDir });
    } else if (process.platform === 'darwin') {
      exec(`open "${workingDir}"`, (error: Error | null) => {
        if (error) {
          console.error('Failed to open working directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: workingDir });
      });
    } else {
      exec(`xdg-open "${workingDir}"`, (error: Error | null) => {
        if (error) {
          console.error('Failed to open working directory:', error);
          return res.status(500).json({ error: 'Failed to open directory', message: error.message });
        }
        res.json({ success: true, path: workingDir });
      });
    }
  } catch (error) {
    console.error('Error opening working directory:', error);
    res.status(500).json({ error: 'Failed to open directory', message: (error as Error).message });
  }
});

// 在项目的工作目录打开终端并执行 iflow（从最新会话获取工作目录）
app.get('/api/open-iflow-project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const projectDir = path.join(PROJECTS_DIR, String(projectId));

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
      const sessionFile = path.join(projectDir, file);
      const content = await fs.readFile(sessionFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const msg: Message = JSON.parse(line);
        if (msg.type === 'user' && msg.cwd) {
          workingDir = msg.cwd;
          break;
        }
      }
      if (workingDir) break;
    }

    if (!workingDir) {
      return res.status(400).json({ error: 'No working directory found in project sessions' });
    }

    // 检查工作目录是否存在
    const workDirExists = await fs.access(workingDir).then(() => true).catch(() => false);
    if (!workDirExists) {
      return res.status(404).json({ error: 'Working directory does not exist', path: workingDir });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      const psScript = `Set-Location -Path '${workingDir}'; Write-Host 'Working directory: ${workingDir}'; Write-Host 'Starting iflow...'; iflow`;
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
      
      console.log(`Opening iflow in project: ${workingDir}`);
      res.json({ success: true, path: workingDir });
    } else if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd '${workingDir}' && iflow"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: workingDir });
    } else {
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
        { cmd: 'konsole', args: ['-e', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
        { cmd: 'xterm', args: ['-e', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
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
        res.json({ success: true, path: workingDir });
      } else {
        res.status(500).json({ error: 'No suitable terminal emulator found' });
      }
    }
  } catch (error) {
    console.error('Error opening iflow for project:', error);
    res.status(500).json({ error: 'Failed to open iflow', message: (error as Error).message });
  }
});

// 在工作目录打开终端并执行 iflow
app.get('/api/open-iflow/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);

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

    // 检查工作目录是否存在
    const dirExists = await fs.access(workingDir).then(() => true).catch(() => false);
    if (!dirExists) {
      return res.status(404).json({ error: 'Working directory does not exist', path: workingDir });
    }

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      // Windows: 使用 cmd.exe 的 start 命令启动新的 PowerShell 窗口
      const psScript = `Set-Location -Path '${workingDir}'; Write-Host 'Working directory: ${workingDir}'; Write-Host 'Starting iflow...'; iflow`;
      const base64Command = Buffer.from(psScript, 'utf16le').toString('base64');
      
      // 使用 cmd.exe start 命令启动新窗口
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
      
      console.log(`Opening iflow in: ${workingDir}`);
      res.json({ success: true, path: workingDir });
    } else if (process.platform === 'darwin') {
      // macOS: 打开 Terminal 并执行 iflow
      const script = `tell application "Terminal" to do script "cd '${workingDir}' && iflow"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      res.json({ success: true, path: workingDir });
    } else {
      // Linux: 尝试使用常见的终端模拟器
      const terminals = [
        { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
        { cmd: 'konsole', args: ['-e', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
        { cmd: 'xterm', args: ['-e', 'bash', '-c', `cd "${workingDir}" && iflow; exec bash`] },
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
        res.json({ success: true, path: workingDir });
      } else {
        res.status(500).json({ error: 'No suitable terminal emulator found' });
      }
    }
  } catch (error) {
    console.error('Error opening iflow:', error);
    res.status(500).json({ error: 'Failed to open iflow', message: (error as Error).message });
  }
});

// 删除会话 API
app.delete('/api/sessions/:projectId/:sessionId', async (req: Request, res: Response) => {
  try {
    const { projectId, sessionId } = req.params;
    const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);

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
    res.status(500).json({ error: 'Failed to delete session', message: (error as Error).message });
  }
});

// ==================== v1.2.0 批量操作 API ====================

// 批量删除会话
app.post('/api/sessions/batch-delete', async (req: Request, res: Response) => {
  try {
    const { sessions } = req.body;
    
    if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ error: 'No sessions provided' });
    }

    const results: Array<{ projectId: string; sessionId: string; success: boolean; error?: string }> = [];
    let deletedCount = 0;

    for (const { projectId, sessionId } of sessions) {
      try {
        const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);
        const fileExists = await fs.access(sessionFile).then(() => true).catch(() => false);
        
        if (fileExists) {
          await fs.unlink(sessionFile);
          deletedCount++;
          results.push({ projectId, sessionId, success: true });
        } else {
          results.push({ projectId, sessionId, success: false, error: 'Session not found' });
        }
      } catch (err) {
        results.push({ projectId, sessionId, success: false, error: (err as Error).message });
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
    res.status(500).json({ error: 'Failed to batch delete sessions', message: (error as Error).message });
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
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const tagName = name.toLowerCase().trim();
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
    res.status(500).json({ error: 'Failed to add tag', message: (error as Error).message });
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
    const sessionKey = `${projectId}/${sessionId}`;

    if (!Array.isArray(tags)) {
      return res.status(400).json({ error: 'Tags must be an array' });
    }

    const tagsData = await readTagsData();

    // 标准化标签名称（小写）
    const normalizedTags = tags.map(t => t.toLowerCase().trim()).filter(t => t);

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
    res.status(500).json({ error: 'Failed to set session tags', message: (error as Error).message });
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

// AI 配置存储路径
const AI_CONFIG_FILE = path.join(IFLOW_DIR, 'iflow-run-ai-config.json');

interface AIConfig {
  provider: 'iflow' | 'openai';
  apiKey: string;
  model: string;
  enabled: boolean;
}

// 读取 AI 配置
async function readAIConfig(): Promise<AIConfig> {
  try {
    const fileExists = await fs.access(AI_CONFIG_FILE).then(() => true).catch(() => false);
    if (!fileExists) {
      return {
        provider: 'iflow',
        apiKey: '',
        model: 'iflow-rome-30ba3b',
        enabled: false
      };
    }
    const content = await fs.readFile(AI_CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading AI config:', error);
    return {
      provider: 'iflow',
      apiKey: '',
      model: 'iflow-rome-30ba3b',
      enabled: false
    };
  }
}

// 保存 AI 配置
async function saveAIConfig(config: AIConfig): Promise<void> {
  try {
    await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving AI config:', error);
    throw error;
  }
}

// 获取 AI 配置 API
app.get('/api/ai/config', async (req: Request, res: Response) => {
  try {
    const config = await readAIConfig();
    // 不返回完整的 API Key，只返回是否存在
    res.json({
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      apiKeyPreview: config.apiKey ? `${config.apiKey.substring(0, 8)}...` : '',
      model: config.model,
      enabled: config.enabled
    });
  } catch (error) {
    console.error('Error getting AI config:', error);
    res.status(500).json({ error: 'Failed to get AI config', message: (error as Error).message });
  }
});

// 保存 AI 配置 API
app.post('/api/ai/config', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, enabled } = req.body;
    
    const currentConfig = await readAIConfig();
    
    const newConfig: AIConfig = {
      provider: provider || currentConfig.provider,
      apiKey: apiKey !== undefined ? apiKey : currentConfig.apiKey,
      model: model || currentConfig.model,
      enabled: enabled !== undefined ? enabled : currentConfig.enabled
    };
    
    await saveAIConfig(newConfig);
    
    res.json({
      success: true,
      config: {
        provider: newConfig.provider,
        hasApiKey: !!newConfig.apiKey,
        model: newConfig.model,
        enabled: newConfig.enabled
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
      return res.status(400).json({ error: 'API Key not configured' });
    }
    
    const baseUrl = config.provider === 'iflow' 
      ? 'https://apis.iflow.cn/v1'
      : 'https://api.openai.com/v1';
    
    // 发送测试请求
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      })
    });
    
    if (response.ok) {
      res.json({ success: true, message: 'API 连接成功' });
    } else {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
      res.status(400).json({ 
        error: 'API 连接失败', 
        message: errorData.error?.message || `HTTP ${response.status}`
      });
    }
  } catch (error) {
    console.error('Error testing AI connection:', error);
    res.status(500).json({ error: 'Failed to test AI connection', message: (error as Error).message });
  }
});

// AI 聊天 API（非流式）
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages, context } = req.body;
    const config = await readAIConfig();
    
    if (!config.apiKey || !config.enabled) {
      return res.status(400).json({ error: 'AI service not configured or disabled' });
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
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    });
    
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
    
    if (!config.apiKey || !config.enabled) {
      return res.status(400).json({ error: 'AI service not configured or disabled' });
    }
    
    // 读取会话内容
    const sessionFile = path.join(PROJECTS_DIR, String(projectId), `${String(sessionId)}.jsonl`);
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
    
    for (const msg of messages) {
      if (msg.type === 'user') {
        const msgContent = extractContent(msg);
        if (msgContent && !summary) {
          summary = msgContent.substring(0, 500);
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
  "suggestions": ["改进建议1", "改进建议2"]
}

只返回 JSON，不要包含其他内容。`;

    const baseUrl = config.provider === 'iflow' 
      ? 'https://apis.iflow.cn/v1'
      : 'https://api.openai.com/v1';
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    });
    
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