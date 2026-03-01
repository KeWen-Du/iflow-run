#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// 解析命令行参数
const args = process.argv.slice(2);

// PID 文件路径
const homeDir = os.homedir();
const iflowRunDir = path.join(homeDir, '.iflow-run');
const pidFile = path.join(iflowRunDir, 'iflow-run.pid');

// 确保 .iflow-run 目录存在
if (!fs.existsSync(iflowRunDir)) {
  fs.mkdirSync(iflowRunDir, { recursive: true });
}

// 显示帮助信息
function showHelp() {
  console.log(`
iflow-run - iFlow CLI 会话轨迹查看器

用法:
  iflow-run [选项]

选项:
  --port=<端口>       指定服务器端口 (默认: 3000)
  --dir=<目录>        指定 iflow 数据目录 (默认: ~/.iflow)
  -d, --daemon        后台运行
  --stop              停止后台运行的服务
  -h, --help          显示帮助信息
  -v, --version       显示版本号

环境变量:
  IFLOW_RUN_PORT      指定服务器端口
  IFLOW_RUN_DIR       指定 iflow 数据目录

示例:
  iflow-run                          # 使用默认配置启动（前台）
  iflow-run --daemon                 # 后台运行
  iflow-run --stop                   # 停止后台服务
  iflow-run --port=8080              # 指定端口 8080
  iflow-run --dir=/path/to/iflow     # 指定 iflow 目录
  IFLOW_RUN_PORT=8080 iflow-run      # 使用环境变量指定端口

访问:
  启动后访问 http://localhost:<端口> 查看会话轨迹
`);
}

// 显示版本信息
function showVersion() {
  const packagePath = path.join(__dirname, '..', 'package.json');
  const pkg = require(packagePath);
  console.log(`iflow-run v${pkg.version}`);
}

// 获取后台进程 PID
function getDaemonPid() {
  try {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      return pid;
    }
  } catch (err) {
    console.error('读取 PID 文件失败:', err.message);
  }
  return null;
}

// 检查进程是否运行
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0); // 发送信号 0 检查进程是否存在
    return true;
  } catch (err) {
    return false;
  }
}

// 停止后台服务
function stopDaemon() {
  const pid = getDaemonPid();
  
  if (!pid) {
    console.log('没有找到后台运行的服务');
    process.exit(0);
  }

  if (isProcessRunning(pid)) {
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /F /PID ${pid}`, (error) => {
          if (error) {
            console.error('停止服务失败:', error.message);
            process.exit(1);
          }
          console.log('后台服务已停止');
          fs.unlinkSync(pidFile);
          process.exit(0);
        });
      } else {
        process.kill(pid, 'SIGTERM');
        console.log('后台服务已停止');
        fs.unlinkSync(pidFile);
        process.exit(0);
      }
    } catch (err) {
      console.error('停止服务失败:', err.message);
      process.exit(1);
    }
  } else {
    console.log('后台服务未运行');
    // 清理过期的 PID 文件
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    process.exit(0);
  }
}

// 后台运行
function startDaemon(port, dir) {
  const pid = getDaemonPid();
  
  if (pid && isProcessRunning(pid)) {
    console.log('服务已经在后台运行');
    console.log('如需重启，请先使用: iflow-run --stop');
    process.exit(1);
  }

  console.log('正在启动后台服务...');

  if (process.platform === 'win32') {
    // Windows 使用 start 命令启动新窗口
    const nodePath = process.execPath;
    const serverPath = path.join(__dirname, '..', 'server.js');
    const portArg = port ? `IFLOW_RUN_PORT=${port} ` : '';
    const dirArg = dir ? `IFLOW_RUN_DIR=${dir} ` : '';
    
    const command = `start /B cmd /C "${portArg}${dirArg}"${nodePath}" "${serverPath}"`;
    
    exec(command, (error) => {
      if (error) {
        console.error('启动失败:', error.message);
        process.exit(1);
      }
      
      // 等待一段时间，然后查找新启动的进程
      setTimeout(() => {
        // 使用 tasklist 查找 iflow-run 相关的 node 进程
        exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (err, stdout) => {
          if (err) {
            console.error('无法获取进程信息');
            process.exit(1);
          }
          
          // 解析输出，找到最新的 node 进程
          const lines = stdout.split('\n').slice(1);
          const pids = lines
            .filter(line => line.includes('node.exe'))
            .map(line => {
              const parts = line.split(',');
              return parseInt(parts[1].replace(/"/g, '').trim());
            });
          
          if (pids.length > 0) {
            // 取最大的 PID（最新启动的）
            const newPid = Math.max(...pids);
            fs.writeFileSync(pidFile, newPid.toString());
            console.log('后台服务启动成功');
            console.log('使用 "iflow-run --stop" 停止服务');
          } else {
            console.error('无法获取进程 PID');
            process.exit(1);
          }
        });
      }, 1000);
    });
  } else {
    // Linux/Mac 使用 detached 模式
    const nodePath = process.execPath;
    const serverPath = path.join(__dirname, '..', 'server.js');
    
    const env = { ...process.env };
    if (port) env.IFLOW_RUN_PORT = port;
    if (dir) env.IFLOW_RUN_DIR = dir;
    
    const child = spawn(nodePath, [serverPath], {
      detached: true,
      stdio: 'ignore',
      env
    });
    
    child.unref();
    fs.writeFileSync(pidFile, child.pid.toString());
    console.log('后台服务启动成功');
    console.log('使用 "iflow-run --stop" 停止服务');
    process.exit(0);
  }
}

// 处理参数
let port = null;
let dir = null;
let daemonMode = false;
let stopCommand = false;

for (const arg of args) {
  if (arg === '-h' || arg === '--help') {
    showHelp();
    process.exit(0);
  }
  if (arg === '-v' || arg === '--version') {
    showVersion();
    process.exit(0);
  }
  if (arg === '-d' || arg === '--daemon') {
    daemonMode = true;
  }
  if (arg === '--stop') {
    stopCommand = true;
  }
  if (arg.startsWith('--port=')) {
    port = arg.split('=')[1];
  }
  if (arg.startsWith('--dir=')) {
    dir = arg.split('=')[1];
  }
}

// 执行命令
if (stopCommand) {
  stopDaemon();
} else if (daemonMode) {
  startDaemon(port, dir);
} else {
  // 前台运行
  if (port) process.env.IFLOW_RUN_PORT = port;
  if (dir) process.env.IFLOW_RUN_DIR = dir;
  require('../dist/server.js');
}