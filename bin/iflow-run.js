#!/usr/bin/env node

const path = require('path');
const os = require('os');

// 解析命令行参数
const args = process.argv.slice(2);

// 显示帮助信息
function showHelp() {
  console.log(`
iflow-run - iFlow CLI 会话轨迹查看器

用法:
  iflow-run [选项]

选项:
  --port=<端口>       指定服务器端口 (默认: 3000)
  --dir=<目录>        指定 iflow 数据目录 (默认: ~/.iflow)
  -h, --help          显示帮助信息
  -v, --version       显示版本号

环境变量:
  IFLOW_RUN_PORT      指定服务器端口
  IFLOW_RUN_DIR       指定 iflow 数据目录

示例:
  iflow-run                          # 使用默认配置启动
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

// 处理参数
for (const arg of args) {
  if (arg === '-h' || arg === '--help') {
    showHelp();
    process.exit(0);
  }
  if (arg === '-v' || arg === '--version') {
    showVersion();
    process.exit(0);
  }
}

// 启动服务器
require('../server.js');