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
const statusFile = path.join(iflowRunDir, 'iflow-run.status');

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
          if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
          process.exit(0);
        });
      } else {
        process.kill(pid, 'SIGTERM');
        console.log('后台服务已停止');
        fs.unlinkSync(pidFile);
        if (fs.existsSync(statusFile)) fs.unlinkSync(statusFile);
        process.exit(0);
      }
    } catch (err) {
      console.error('停止服务失败:', err.message);
      process.exit(1);
    }
  } else {
    console.log('后台服务未运行');
    // 清理过期的 PID 文件和状态文件
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    if (fs.existsSync(statusFile)) {
      fs.unlinkSync(statusFile);
    }
    process.exit(0);
  }
}

// 后台运行
function startDaemon(port, dir) {
  const pid = getDaemonPid();
  
  if (pid && isProcessRunning(pid)) {
    console.log('服务已经在后台运行');
    // 尝试从状态文件读取端口信息
    if (fs.existsSync(statusFile)) {
      try {
        const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        console.log(`服务地址: http://localhost:${status.port}`);
      } catch (err) {
        console.log('默认地址: http://localhost:3000');
      }
    } else {
      console.log('默认地址: http://localhost:3000');
    }
    console.log('如需重启，请先使用: iflow-run --stop');
    process.exit(1);
  }

  console.log('正在启动后台服务...');

  if (process.platform === 'win32') {
    // Windows 使用 PowerShell 启动后台进程
    const nodePath = process.execPath;
    const serverPath = path.join(__dirname, '..', 'dist', 'server.js');
    
    // 构建环境变量设置
    const envVars = [];
    if (port) envVars.push(`$env:IFLOW_RUN_PORT='${port}'`);
    if (dir) envVars.push(`$env:IFLOW_RUN_DIR='${dir}'`);
    
    const envSetup = envVars.length > 0 ? envVars.join(';') + ';' : '';
    const command = `powershell -WindowStyle Hidden -Command "${envSetup} Start-Process -FilePath '${nodePath}' -ArgumentList '${serverPath}' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id"`;
    
    exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.error('启动失败:', error.message);
        process.exit(1);
      }
      
      const newPid = parseInt(stdout.trim());
      if (newPid > 0) {
        fs.writeFileSync(pidFile, newPid.toString());
        
        // 等待状态文件生成，然后显示端口信息
        waitForStatusAndShow(5000, port);
      } else {
        console.error('无法获取进程 PID');
        process.exit(1);
      }
    });
  } else {
    // Linux/Mac 使用 detached 模式
    const nodePath = process.execPath;
    const serverPath = path.join(__dirname, '..', 'dist', 'server.js');
    
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
    
    // 等待状态文件生成，然后显示端口信息
    waitForStatusAndShow(5000, port);
  }
}

// 等待状态文件并显示端口信息
function waitForStatusAndShow(timeout, requestedPort) {
  const startTime = Date.now();
  const checkInterval = 200;
  
  function checkStatus() {
    if (fs.existsSync(statusFile)) {
      try {
        const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        console.log('后台服务启动成功');
        console.log(`服务地址: http://localhost:${status.port}`);
        console.log('使用 "iflow-run --stop" 停止服务');
        process.exit(0);
      } catch (err) {
        // 文件可能还在写入中，继续等待
      }
    }
    
    if (Date.now() - startTime < timeout) {
      setTimeout(checkStatus, checkInterval);
    } else {
      console.log('后台服务启动成功');
      console.log(`默认地址: http://localhost:${requestedPort || 3000}`);
      console.log('使用 "iflow-run --stop" 停止服务');
      process.exit(0);
    }
  }
  
  checkStatus();
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