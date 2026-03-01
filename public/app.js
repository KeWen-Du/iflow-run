let projects = [];
let currentProject = null;
let currentSession = null;
let searchQuery = '';
let allMessages = [];
let loadedMessageCount = 0;
let userMessagesIndex = []; // 存储用户消息索引
let toolCallsMap = new Map(); // 存储工具调用数据，用于详情展示
let toolResultsMap = new Map(); // 预先建立工具调用ID到结果的映射，优化查找性能
const INITIAL_LOAD_COUNT = 50;
const LOAD_MORE_COUNT = 50;
let isLoadingMore = false;
let messageFilter = 'all'; // 消息类型筛选：all, user, assistant, tools
let currentSearchQuery = ''; // 当前搜索查询

// DOM 元素
const projectsList = document.getElementById('projectsList');
const sessionsContainer = document.getElementById('sessionsContainer');
const sessionDetail = document.getElementById('sessionDetail');
const messagesContainer = document.getElementById('messagesContainer');
const currentProjectTitle = document.getElementById('currentProjectTitle');
const backBtn = document.getElementById('backBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const statsBtn = document.getElementById('statsBtn');
const themeBtn = document.getElementById('themeBtn');
const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const openDirectoryBtn = document.getElementById('openDirectoryBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
const toggleMessageIndexBtn = document.getElementById('toggleMessageIndexBtn');
const messageIndexPanel = document.getElementById('messageIndexPanel');
const closeMessageIndexBtn = document.getElementById('closeMessageIndexBtn');
const messageIndexList = document.getElementById('messageIndexList');
const statsModal = document.getElementById('statsModal');
const closeStatsBtn = document.getElementById('closeStatsBtn');

// 工具配置
const TOOL_CONFIG = {
  read_file: { icon: '📄', color: '#3b82f6', name: '读取文件' },
  write_file: { icon: '✏️', color: '#f59e0b', name: '写入文件' },
  list_directory: { icon: '📁', color: '#10b981', name: '列出目录' },
  search_file_content: { icon: '🔍', color: '#8b5cf6', name: '搜索文件' },
  glob: { icon: '🔎', color: '#8b5cf6', name: '文件匹配' },
  replace: { icon: '🔄', color: '#ef4444', name: '替换内容' },
  run_shell_command: { icon: '💻', color: '#06b6d4', name: '执行命令' },
  image_read: { icon: '🖼️', color: '#ec4899', name: '读取图片' },
  web_search: { icon: '🌐', color: '#14b8a6', name: '网络搜索' },
  web_fetch: { icon: '📥', color: '#14b8a6', name: '获取网页' },
  ask_user_question: { icon: '❓', color: '#f97316', name: '询问用户' },
  todo_write: { icon: '📋', color: '#6366f1', name: '写入任务' },
  default: { icon: '🔧', color: '#6b7280', name: '工具' }
};

// 获取工具图标
function getToolIcon(toolName) {
  return TOOL_CONFIG[toolName]?.icon || TOOL_CONFIG.default.icon;
}

// 获取工具颜色
function getToolColor(toolName) {
  return TOOL_CONFIG[toolName]?.color || TOOL_CONFIG.default.color;
}

// 获取工具中文名称
function getToolDisplayName(toolName) {
  return TOOL_CONFIG[toolName]?.name || toolName;
}

// 格式化工具参数为键值对HTML
function formatToolParams(params) {
  if (!params || typeof params !== 'object') {
    return escapeHtml(String(params || ''));
  }

  const entries = Object.entries(params);
  if (entries.length === 0) {
    return '<span style="color: var(--text-muted)">无参数</span>';
  }

  let html = '<div class="tool-params">';
  
  entries.forEach(([key, value]) => {
    const displayKey = escapeHtml(key);
    let displayValue = '';
    
    if (value === null || value === undefined) {
      displayValue = '<span style="color: var(--text-muted)">null</span>';
    } else if (typeof value === 'string') {
      displayValue = `<span class="param-string">"${escapeHtml(value)}"</span>`;
    } else if (typeof value === 'number') {
      displayValue = `<span class="param-number">${value}</span>`;
    } else if (typeof value === 'boolean') {
      displayValue = `<span class="param-boolean">${value}</span>`;
    } else if (Array.isArray(value)) {
      displayValue = `<span class="param-array">[${value.length} 项]</span>`;
    } else if (typeof value === 'object') {
      const keys = Object.keys(value);
      displayValue = `<span class="param-object">{${keys.length} 个键}</span>`;
    } else {
      displayValue = escapeHtml(String(value));
    }
    
    html += `
      <div class="tool-param-row">
        <span class="param-key">${displayKey}:</span>
        <span class="param-value">${displayValue}</span>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// 格式化工具结果
function formatToolResult(content) {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return '<span style="color: var(--text-muted)">（空结果）</span>';
    }
    // 检测是否是JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return formatToolResult(parsed);
      } catch {
        return escapeHtml(content);
      }
    }
    return escapeHtml(content);
  } else if (typeof content === 'object' && content !== null) {
    // 处理 iflow 的工具结果数据结构
    // 优先显示 resultDisplay 字段
    if (content.resultDisplay && typeof content.resultDisplay === 'string') {
      const trimmed = content.resultDisplay.trim();
      if (trimmed.length > 0) {
        return escapeHtml(trimmed);
      }
    }

    // 其次显示 responseParts.functionResponse.response.output 字段
    if (content.responseParts?.functionResponse?.response?.output) {
      const output = content.responseParts.functionResponse.response.output;
      if (typeof output === 'string' && output.trim().length > 0) {
        return escapeHtml(output.trim());
      } else if (typeof output === 'object') {
        return formatToolParams(output);
      }
    }

    // 如果以上都没有，则显示整个 content 对象
    return formatToolParams(content);
  }
  return escapeHtml(String(content));
}

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch (err) {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('已复制到剪贴板');
    } catch (e) {
      showToast('复制失败', 'error');
    }
    document.body.removeChild(textarea);
  }
}

// 显示提示消息
function showToast(message, type = 'success') {
  // 创建外层包裹器，用于定位
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
  `;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.3s ease;
  `;
  
  wrapper.appendChild(toast);
  document.body.appendChild(wrapper);
  
  setTimeout(() => {
    toast.style.animation = 'slideDown 0.3s ease';
    setTimeout(() => wrapper.remove(), 300);
  }, 2000);
}

// 初始化
async function init() {
  // 加载主题设置
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }

  await loadProjects();
  setupEventListeners();
}

// 设置事件监听
function setupEventListeners() {
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      sessionDetail.classList.add('hidden');
      sessionsContainer.classList.remove('hidden');
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadProjects();
    });
  }

  // 搜索功能
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderSessionsList();
    });
  }

  // 统计面板
  if (statsBtn) {
    statsBtn.addEventListener('click', () => {
      showStatsModal();
    });
  }

  if (closeStatsBtn) {
    closeStatsBtn.addEventListener('click', () => {
      const statsModalEl = document.getElementById('statsModal');
      if (statsModalEl) {
        statsModalEl.classList.remove('active');
      }
    });
  }

  if (statsModal) {
    statsModal.addEventListener('click', (e) => {
      if (e.target === statsModal) {
        statsModal.classList.remove('active');
      }
    });
  } else {
    // 如果全局变量为 null，尝试动态绑定
    const statsModalEl = document.getElementById('statsModal');
    if (statsModalEl) {
      statsModalEl.addEventListener('click', (e) => {
        if (e.target === statsModalEl) {
          statsModalEl.classList.remove('active');
        }
      });
    }
  }

  // 主题切换
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
    });
  }

  // 导出功能
  if (exportMarkdownBtn) {
    exportMarkdownBtn.addEventListener('click', () => {
      exportAsMarkdown();
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      exportAsJson();
    });
  }

  // 打开目录功能
  if (openDirectoryBtn) {
    openDirectoryBtn.addEventListener('click', () => {
      openProjectDirectory();
    });
  }

  // 跳到底部功能
  if (scrollToBottomBtn) {
    scrollToBottomBtn.addEventListener('click', () => {
      scrollToBottom();
    });
  }

  // 消息目录功能
  if (toggleMessageIndexBtn) {
    toggleMessageIndexBtn.addEventListener('click', () => {
      toggleMessageIndex();
    });
  }

  if (closeMessageIndexBtn) {
    closeMessageIndexBtn.addEventListener('click', () => {
      messageIndexPanel.classList.add('hidden');
    });
  }

  // 消息搜索功能
  const messageSearchInput = document.getElementById('messageSearchInput');
  const clearMessageSearch = document.getElementById('clearMessageSearch');
  if (messageSearchInput) {
    messageSearchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      if (clearMessageSearch) {
        clearMessageSearch.style.display = currentSearchQuery ? 'block' : 'none';
      }
      filterAndRenderMessages();
    });
  }

  if (clearMessageSearch) {
    clearMessageSearch.addEventListener('click', () => {
      if (messageSearchInput) {
        messageSearchInput.value = '';
        currentSearchQuery = '';
        clearMessageSearch.style.display = 'none';
        filterAndRenderMessages();
      }
    });
  }

  // 消息类型筛选功能
  const messageFilterSelect = document.getElementById('messageFilter');
  if (messageFilterSelect) {
    messageFilterSelect.addEventListener('change', (e) => {
      messageFilter = e.target.value;
      filterAndRenderMessages();
    });
  }

  // 使用事件委托处理会话卡片点击
  if (sessionsContainer) {
    sessionsContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.session-card');
      if (card) {
        const sessionId = card.dataset.sessionId;
        console.log('Session card clicked via delegation:', sessionId);
        loadSession(sessionId);
      }
    });
  }

  // 使用事件委托处理复制按钮点击
  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        e.stopPropagation();
        const content = copyBtn.dataset.copyContent;
        if (content) {
          try {
            // Base64 解码
            const decodedContent = decodeURIComponent(escape(atob(content)));
            copyToClipboard(decodedContent);
          } catch (error) {
            console.error('解码失败:', error);
            showToast('复制失败', 'error');
          }
        }
      }
    });
  }
}

// 加载项目列表
async function loadProjects() {
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    // 兼容新旧 API 格式
    // 新格式: { projects: [], total, page, limit, totalPages }
    // 旧格式: []
    projects = data.projects || data;
    
    renderProjectsList();
  } catch (error) {
    console.error('Failed to load projects:', error);
    projectsList.innerHTML = '<div class="loading">加载失败</div>';
  }
}

// 渲染项目列表
function renderProjectsList() {
  if (projects.length === 0) {
    projectsList.innerHTML = '<div class="loading">暂无项目</div>';
    return;
  }

  projectsList.innerHTML = projects.map(project => `
    <div class="project-item ${currentProject?.id === project.id ? 'active' : ''}" 
         data-project-id="${project.id}">
      <div class="project-name">${project.name}</div>
      <div class="project-meta">
        <span class="session-count">${project.sessionCount} 个会话</span>
      </div>
    </div>
  `).join('');

  // 添加点击事件
  document.querySelectorAll('.project-item').forEach(item => {
    item.addEventListener('click', () => {
      const projectId = item.dataset.projectId;
      selectProject(projectId);
    });
  });
}

// 选择项目
function selectProject(projectId) {
  currentProject = projects.find(p => p.id === projectId);
  if (!currentProject) return;

  // 更新 UI
  document.querySelectorAll('.project-item').forEach(item => {
    item.classList.toggle('active', item.dataset.projectId === projectId);
  });

  currentProjectTitle.textContent = currentProject.name;
  sessionDetail.classList.add('hidden');
  sessionsContainer.classList.remove('hidden');

  renderSessionsList();
}

// 渲染会话列表
function renderSessionsList() {
  console.log('renderSessionsList called, currentProject:', currentProject?.id);

  if (!currentProject || currentProject.sessions.length === 0) {
    sessionsContainer.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>暂无会话</p>
      </div>
    `;
    return;
  }

  // 根据搜索查询过滤会话
  const filteredSessions = currentProject.sessions.filter(session => {
    if (!searchQuery) return true;

    const searchText = searchQuery.toLowerCase();
    const matchId = session.id.toLowerCase().includes(searchText);
    const matchPreview = session.preview.toLowerCase().includes(searchText);

    return matchId || matchPreview;
  });

  if (filteredSessions.length === 0) {
    sessionsContainer.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>未找到匹配的会话</p>
      </div>
    `;
    return;
  }

  sessionsContainer.innerHTML = `
    <div class="sessions-grid">
      ${filteredSessions.map(session => `
        <div class="session-card" data-session-id="${session.id}">
          <div class="session-card-header">
            <div class="session-id">${session.id}</div>
            <div class="session-time">${formatTime(session.mtime)}</div>
          </div>
          <div class="session-preview">${escapeHtml(session.preview)}</div>
        </div>
      `).join('')}
    </div>
  `;

  console.log('Rendered', filteredSessions.length, 'session cards');
}

// 加载会话详情
async function loadSession(sessionId) {
  console.log('loadSession called with sessionId:', sessionId);
  console.log('currentProject:', currentProject);

  if (!currentProject) {
    console.error('currentProject is null!');
    return;
  }

  try {
    const url = `/api/sessions/${currentProject.id}/${sessionId}`;
    console.log('Fetching:', url);
    const response = await fetch(url);
    const messages = await response.json();
    console.log('Messages loaded:', messages.length);

    currentSession = {
      id: sessionId,
      messages
    };

    // 更新会话时间
    const session = currentProject.sessions.find(s => s.id === sessionId);
    document.getElementById('sessionTime').textContent = formatTime(session?.mtime);

    // 更新会话上下文信息
    updateSessionContext(messages);

    // 清除之前的滚动监听器
    messagesContainer.removeEventListener('scroll', handleScroll);

    renderMessages(messages);

    // 切换到详情视图
    sessionsContainer.classList.add('hidden');
    sessionDetail.classList.remove('hidden');
  } catch (error) {
    console.error('Failed to load session:', error);
  }
}

// 更新会话上下文信息
function updateSessionContext(messages) {
  if (!messages || messages.length === 0) return;

  // 从第一条用户消息中提取上下文信息
  const firstUserMessage = messages.find(msg => msg.type === 'user');
  if (!firstUserMessage) return;

  // 提取工作目录
  const cwd = firstUserMessage.cwd;
  const cwdValue = document.getElementById('contextCwdValue');
  if (cwdValue) {
    cwdValue.textContent = cwd || '未知目录';
    cwdValue.title = cwd || '未知目录';
  }

  // 提取 Git 分支
  const gitBranch = firstUserMessage.gitBranch;
  const gitBranchEl = document.getElementById('contextGitBranch');
  const gitBranchValue = document.getElementById('contextGitBranchValue');
  if (gitBranch) {
    if (gitBranchEl) gitBranchEl.style.display = 'flex';
    if (gitBranchValue) gitBranchValue.textContent = gitBranch;
  } else {
    if (gitBranchEl) gitBranchEl.style.display = 'none';
  }

  // 提取版本信息
  const version = firstUserMessage.version;
  const versionValue = document.getElementById('contextVersionValue');
  if (versionValue) {
    versionValue.textContent = version || '--';
  }
}

// 过滤并渲染消息
function filterAndRenderMessages() {
  if (!currentSession || !currentSession.messages) return;

  // 原始消息
  const originalMessages = currentSession.messages;

  // 应用类型筛选
  let filteredMessages = originalMessages;
  if (messageFilter !== 'all') {
    filteredMessages = originalMessages.filter(msg => {
      if (messageFilter === 'user') return msg.type === 'user';
      if (messageFilter === 'assistant') return msg.type === 'assistant';
      if (messageFilter === 'tools') {
        return msg.message?.content && Array.isArray(msg.message.content) &&
               msg.message.content.some(c => c.type === 'tool_use' || c.type === 'tool_result');
      }
      return true;
    });
  }

  // 应用搜索筛选
  if (currentSearchQuery.trim()) {
    const searchLower = currentSearchQuery.toLowerCase();
    filteredMessages = filteredMessages.filter(msg => {
      const content = extractMessageContent(msg);
      if (content && content.toLowerCase().includes(searchLower)) return true;

      // 搜索工具调用
      if (msg.message?.content && Array.isArray(msg.message.content)) {
        const toolUses = msg.message.content.filter(c => c.type === 'tool_use');
        for (const tc of toolUses) {
          if (tc.name.toLowerCase().includes(searchLower)) return true;
          const paramsStr = JSON.stringify(tc.input);
          if (paramsStr.toLowerCase().includes(searchLower)) return true;
        }
      }

      return false;
    });
  }

  // 使用原始的 renderMessages 函数，但传入过滤后的消息
  renderMessages(filteredMessages);
}

// 渲染消息（支持分页）
function renderMessages(messages) {
  if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = '<div class="loading">暂无消息</div>';
    return;
  }

  // 过滤消息
  allMessages = messages.filter(msg => {
    const content = extractMessageContent(msg);
    const hasToolCalls = msg.message?.content && Array.isArray(msg.message.content) &&
                        msg.message.content.some(c => c.type === 'tool_use');
    const hasToolResults = msg.message?.content && Array.isArray(msg.message.content) &&
                         msg.message.content.some(c => c.type === 'tool_result');
    const hasContent = content && content.trim().length > 0;
    return hasContent || hasToolCalls || hasToolResults;
  });

  // 清空用户消息索引
  userMessagesIndex = [];

  // 清空工具调用映射
  toolCallsMap.clear();

  // 预先建立工具调用ID到结果的映射，优化查找性能
  toolResultsMap.clear();
  allMessages.forEach(msg => {
    if (msg.message?.content && Array.isArray(msg.message.content)) {
      const toolResults = msg.message.content.filter(c => c.type === 'tool_result');
      toolResults.forEach(tr => {
        if (tr.tool_use_id) {
          toolResultsMap.set(tr.tool_use_id, {
            result: tr,
            message: msg
          });
        }
      });
    }
  });

  // 建立所有用户消息的索引（包括未加载的）
  allMessages.forEach((msg, index) => {
    if (msg.type === 'user') {
      const content = extractMessageContent(msg);
      if (content && content.trim().length > 0) {
        const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
        const messageId = `message-${msg.uuid || index}`;
        const time = formatTime(new Date(msg.timestamp));
        userMessagesIndex.push({
          id: messageId,
          content: content,
          preview: preview,
          time: time,
          messageIndex: index
        });
      }
    }
  });

  loadedMessageCount = 0;
  messagesContainer.innerHTML = '';
  loadMoreMessages(INITIAL_LOAD_COUNT);

  // 添加滚动加载事件
  messagesContainer.removeEventListener('scroll', handleScroll);
  messagesContainer.addEventListener('scroll', handleScroll);
}

// 加载更多消息
function loadMoreMessages(count) {
  if (isLoadingMore) return;
  if (loadedMessageCount >= allMessages.length) {
    removeLoadMoreButton();
    return;
  }

  isLoadingMore = true;
  const startIndex = loadedMessageCount;
  const endIndex = Math.min(loadedMessageCount + count, allMessages.length);
  const messagesToLoad = allMessages.slice(startIndex, endIndex);

  const fragment = document.createDocumentFragment();
  let lastCwd = null;
  let lastGitBranch = null;

  // 获取之前的环境状态（如果已有消息）
  if (startIndex > 0 && messagesContainer.lastElementChild) {
    // 从已渲染的消息中获取最后一个 cwd
    const previousMsg = allMessages[startIndex - 1];
    if (previousMsg && previousMsg.cwd) {
      lastCwd = previousMsg.cwd;
    }
  }

  messagesToLoad.forEach(msg => {
    // 检测环境变更
    if (msg.cwd && msg.cwd !== lastCwd) {
      const changeElement = createEnvironmentChangeElement('cwd', lastCwd, msg.cwd);
      fragment.appendChild(changeElement);
      lastCwd = msg.cwd;
    }

    const messageElement = createMessageElement(msg);
    if (messageElement) {
      fragment.appendChild(messageElement);
    }
  });

  messagesContainer.appendChild(fragment);

  loadedMessageCount = endIndex;
  isLoadingMore = false;

  // 更新消息目录的加载状态
  updateMessageIndexLoadingStatus();

  // 更新或移除加载更多按钮
  if (loadedMessageCount < allMessages.length) {
    addLoadMoreButton();
  } else {
    removeLoadMoreButton();
  }

  // 如果是首次加载，滚动到底部
  if (startIndex === 0) {
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  }
}

// 创建环境变更提示元素
function createEnvironmentChangeElement(type, oldValue, newValue) {
  const div = document.createElement('div');
  div.className = 'environment-change';

  let icon, title, content;
  if (type === 'cwd') {
    icon = '📁';
    title = '工作目录变更';
    content = `
      <span class="change-from">${escapeHtml(oldValue || '未知')}</span>
      <span class="change-arrow">→</span>
      <span class="change-to">${escapeHtml(newValue)}</span>
    `;
  } else if (type === 'gitBranch') {
    icon = '🌿';
    title = 'Git 分支变更';
    content = `
      <span class="change-from">${escapeHtml(oldValue || '无')}</span>
      <span class="change-arrow">→</span>
      <span class="change-to">${escapeHtml(newValue)}</span>
    `;
  }

  div.innerHTML = `
    <div class="environment-change-content">
      <span class="change-icon">${icon}</span>
      <span class="change-title">${title}:</span>
      ${content}
    </div>
  `;

  return div;
}

// 创建单个消息元素
function createMessageElement(msg) {
  const type = msg.type === 'user' ? 'user' : 'assistant';
  const content = extractMessageContent(msg);
  const time = formatTime(new Date(msg.timestamp));
  // 使用消息在 allMessages 中的索引作为 ID 的一部分，确保与索引中的 ID 一致
  const messageIndex = allMessages.indexOf(msg);
  const messageId = `message-${msg.uuid || messageIndex}`;

  // 提取助手消息的模型和 Token 信息
  let modelInfoHTML = '';
  if (type === 'assistant' && msg.message) {
    const model = msg.message.model || 'Unknown';
    const usage = msg.message.usage || {};
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;

    if (totalTokens > 0) {
      modelInfoHTML = `
        <span class="message-model-info" title="模型: ${model}, 输入: ${inputTokens}, 输出: ${outputTokens}">
          <span class="model-badge">🤖 ${model}</span>
          <span class="token-badge">📊 ${totalTokens}</span>
        </span>
      `;
    } else if (model && model !== 'Unknown') {
      modelInfoHTML = `
        <span class="message-model-info" title="模型: ${model}">
          <span class="model-badge">🤖 ${model}</span>
        </span>
      `;
    }
  }

  let toolCallHTML = '';

  if (msg.message?.content && Array.isArray(msg.message.content)) {
    const toolCalls = msg.message.content.filter(c => c.type === 'tool_use');
    if (toolCalls.length > 0) {
      toolCallHTML = toolCalls.map((tc, index) => {
        const icon = getToolIcon(tc.name);
        const color = getToolColor(tc.name);
        const displayName = getToolDisplayName(tc.name);
        const callId = `tool-call-${Date.now()}-${loadedMessageCount}-${index}`;
        const paramCount = tc.input ? Object.keys(tc.input).length : 0;
        const jsonStr = JSON.stringify(tc.input, null, 2);
        // 使用 Base64 编码避免转义问题
        const encodedJson = btoa(unescape(encodeURIComponent(jsonStr)));

        // 存储工具调用数据，用于详情展示
        toolCallsMap.set(tc.id, {
          toolCall: tc,
          message: msg,
          icon,
          color,
          displayName
        });

        // 查找对应的工具结果（使用预先建立的映射，提高性能）
        let toolResultHTML = '';
        let toolResult = null;
        let resultMessage = null;

        const toolResultData = toolResultsMap.get(tc.id);
        if (toolResultData) {
          toolResult = toolResultData.result;
          resultMessage = toolResultData.message;
        }
        
        if (toolResult) {
          const isError = toolResult.is_error === true;
          const statusIcon = isError ? '❌' : '✓';
          const statusText = isError ? '执行失败' : '执行结果';
          const resultTime = formatTime(new Date(resultMessage.timestamp));

          // 计算执行时间
          const executionTime = resultMessage.timestamp - msg.timestamp;
          const executionTimeStr = executionTime >= 1000
            ? `${(executionTime / 1000).toFixed(2)}s`
            : `${executionTime}ms`;

          // 格式化内容
          const formattedContent = formatToolResult(toolResult.content);
          const contentStr = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content, null, 2);
          const contentSize = contentStr.length;
          const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));

          toolResultHTML = `
          <div class="tool-result" style="border-color: ${color}40; background: ${color}08; margin-top: 8px;">
            <div class="tool-result-header" onclick="toggleToolResult('${callId}-result')" style="color: ${isError ? '#ef4444' : color}">
              <div class="tool-result-header-left">
                <span class="status-badge ${isError ? 'status-error' : 'status-success'}">${statusIcon} ${statusText}</span>
                <span class="execution-time">⏱️ ${executionTimeStr}</span>
                <span class="content-size">${contentSize} 字符</span>
              </div>
              <div class="tool-result-header-right">
                <button class="copy-btn" data-copy-content="${encodedContent}" title="复制结果">
                  📋
                </button>
                <span class="toggle-icon">▼</span>
              </div>
            </div>
            <div class="tool-result-content" id="${callId}-result">${formattedContent}</div>
          </div>
          `;
        }
        
        return `
        <div class="tool-call" style="border-color: ${color}40; background: ${color}10">
          <div class="tool-call-header" onclick="toggleToolCall('${callId}')" style="color: ${color}">
            <div class="tool-call-header-left">
              <span class="tool-icon">${icon}</span>
              <span class="tool-name">${escapeHtml(displayName)}</span>
              <span class="tool-english-name" style="color: var(--text-muted); font-weight: normal; font-size: 12px;">${escapeHtml(tc.name)}</span>
            </div>
            <div class="tool-call-header-right">
              <span class="param-count">${paramCount} 参数</span>
              <button class="copy-btn" data-copy-content="${encodedJson}" title="复制参数">
                📋
              </button>
              <button class="detail-btn" onclick="event.stopPropagation(); showToolDetail('${tc.id}')" title="查看详情">
                📖
              </button>
              <span class="toggle-icon">▼</span>
            </div>
          </div>
          <div class="tool-call-content" id="${callId}">${formatToolParams(tc.input)}</div>
          ${toolResultHTML}
        </div>
      `;
      }).join('');
    }
  }

  const hasContent = content && content.trim().length > 0;
  const hasToolCalls = toolCallHTML.length > 0;

  if (!hasContent && !hasToolCalls) {
    return null;
  }

  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.id = messageId;
  div.innerHTML = `
    <div class="message-avatar">
      ${type === 'user' ? 'U' : 'A'}
    </div>
    <div class="message-content">
      <div class="message-bubble">
        ${hasContent ? escapeHtmlWithLineBreaks(content) : ''}
        ${toolCallHTML}
      </div>
      <div class="message-meta">
        <span class="message-time">${time}</span>
        ${modelInfoHTML}
      </div>
    </div>
  `;

  return div;
}

// 添加工具结果
function addToolResults(msg) {
  if (!msg.message?.content || !Array.isArray(msg.message.content)) return;

  const toolResults = msg.message.content.filter(c => c.type === 'tool_result');
  if (toolResults.length === 0) return;

  toolResults.forEach((tr, index) => {
    let toolName = '未知工具';

    if (tr.tool_use_id) {
      // 从当前消息中查找
      const toolUse = msg.message.content.find(c => c.type === 'tool_use' && c.id === tr.tool_use_id);
      if (toolUse) {
        toolName = toolUse.name;
      } else {
        // 从整个消息历史中查找（可能在之前的消息中）
        for (const m of allMessages) {
          if (m.message?.content && Array.isArray(m.message.content)) {
            const foundToolUse = m.message.content.find(c => c.type === 'tool_use' && c.id === tr.tool_use_id);
            if (foundToolUse) {
              toolName = foundToolUse.name;
              break;
            }
          }
        }
      }
    }

    const icon = getToolIcon(toolName);
    const color = getToolColor(toolName);
    const displayName = getToolDisplayName(toolName);
    const isError = tr.is_error === true;
    const statusIcon = isError ? '❌' : '✓';
    const statusText = isError ? '执行失败' : '执行结果';
    const time = formatTime(new Date(msg.timestamp));
    const resultId = `tool-result-${Date.now()}-${loadedMessageCount}-${index}`;
    
    // 格式化内容
    const formattedContent = formatToolResult(tr.content);
    const contentStr = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content, null, 2);
    const contentSize = contentStr.length;
    // 使用 Base64 编码避免转义问题
    const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));

    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
      <div class="message-avatar">A</div>
      <div class="message-content">
        <div class="message-bubble">
          <div class="tool-result" style="border-color: ${color}40; background: ${color}10">
            <div class="tool-result-header" onclick="toggleToolResult('${resultId}')" style="color: ${isError ? '#ef4444' : color}">
              <div class="tool-result-header-left">
                <span class="tool-icon">${icon}</span>
                <span class="tool-name">${escapeHtml(displayName)}</span>
                <span class="tool-english-name" style="color: var(--text-muted); font-weight: normal; font-size: 12px;">${escapeHtml(toolName)}</span>
                <span class="status-badge ${isError ? 'status-error' : 'status-success'}">${statusIcon} ${statusText}</span>
              </div>
              <div class="tool-result-header-right">
                <span class="content-size">${contentSize} 字符</span>
                <button class="copy-btn" data-copy-content="${encodedContent}" title="复制结果">
                  📋
                </button>
                <span class="toggle-icon">▼</span>
              </div>
            </div>
            <div class="tool-result-content" id="${resultId}">${formattedContent}</div>
          </div>
        </div>
        <div class="message-meta">
          <span class="message-time">${time}</span>
        </div>
      </div>
    `;

    messagesContainer.appendChild(div);
  });
}

// 添加加载更多按钮
function addLoadMoreButton() {
  let loadMoreBtn = document.getElementById('loadMoreBtn');
  if (!loadMoreBtn) {
    loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreBtn';
    loadMoreBtn.className = 'btn btn-secondary';
    loadMoreBtn.style.margin = '20px auto';
    loadMoreBtn.style.display = 'block';
    loadMoreBtn.textContent = `加载更多 (${allMessages.length - loadedMessageCount} 条消息)`;
    loadMoreBtn.onclick = () => loadMoreMessages(LOAD_MORE_COUNT);
    messagesContainer.appendChild(loadMoreBtn);
  } else {
    loadMoreBtn.textContent = `加载更多 (${allMessages.length - loadedMessageCount} 条消息)`;
  }
}

// 移除加载更多按钮
function removeLoadMoreButton() {
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.remove();
  }
}

// 处理滚动事件
function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (!loadMoreBtn) return;

  // 当滚动到接近底部时自动加载更多
  if (scrollTop + clientHeight >= scrollHeight - 100) {
    loadMoreMessages(LOAD_MORE_COUNT);
  }
}

// 提取消息内容
function extractMessageContent(msg) {
  if (!msg.message || !msg.message.content) {
    console.log('No message content for:', msg.uuid);
    return '';
  }

  const content = msg.message.content;

  // 字符串类型
  if (typeof content === 'string') {
    return content;
  }

  // 数组类型（包含 text、tool_use、tool_result 等类型）
  if (Array.isArray(content)) {
    // 提取文本内容
    const textParts = content.filter(c => c.type === 'text').map(c => c.text);
    if (textParts.length > 0) {
      return textParts.join('\n');
    }

    // 检查是否只有工具结果（这种情况下不显示消息）
    const hasOnlyToolResults = content.length > 0 &&
                               content.every(c => c.type === 'tool_result');
    if (hasOnlyToolResults) {
      console.log('Skipping tool_result message:', msg.uuid);
      return '';
    }

    // 如果没有 text 部分，返回空字符串
    return '';
  }

  // 对象类型
  if (typeof content === 'object') {
    return JSON.stringify(content, null, 2);
  }

  console.log('Unknown content type:', typeof content, content);
  return '';
}

// 格式化时间
function formatTime(date) {
  if (!date) return '';

  const d = new Date(date);
  const now = new Date();
  const diff = now - d;

  // 如果是今天
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 如果是昨天
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `昨天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // 其他日期
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// HTML 转义
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const str = String(text);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// HTML 转义并保留换行符（用于消息内容）
function escapeHtmlWithLineBreaks(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const str = String(text);
  // 先转义 HTML 特殊字符
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  // 然后将换行符转换为 br 标签
  return escaped.replace(/\n/g, '<br>');
}

// 启动应用
init();

// 统计功能
async function showStatsModal() {
  try {
    // 检查模态框元素是否存在
    const statsModalEl = document.getElementById('statsModal');
    if (!statsModalEl) {
      console.error('statsModal element not found');
      return;
    }

    // 计算统计数据
    let totalSessions = 0;
    let totalMessages = 0;
    let totalToolCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const project of projects) {
      totalSessions += project.sessionCount;

      // 获取每个会话的消息数量和工具调用次数
      for (const session of project.sessions) {
        try {
          const response = await fetch(`/api/sessions/${project.id}/${session.id}`);
          const messages = await response.json();
          totalMessages += messages.length;

          // 计算工具调用次数和 Token 消耗
          messages.forEach(msg => {
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              const toolCalls = msg.message.content.filter(c => c.type === 'tool_use');
              totalToolCalls += toolCalls.length;
            }

            // 计算 Token 消耗
            if (msg.message?.usage) {
              totalInputTokens += msg.message.usage.input_tokens || 0;
              totalOutputTokens += msg.message.usage.output_tokens || 0;
            }
          });
        } catch (err) {
          console.error('Error loading session for stats:', err);
        }
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    // 预估成本（假设输入 $0.001/1K tokens，输出 $0.002/1K tokens）
    const estimatedCost = (totalInputTokens * 0.001 / 1000) + (totalOutputTokens * 0.002 / 1000);

    // 更新统计数据
    const totalProjectsEl = document.getElementById('totalProjects');
    const totalSessionsEl = document.getElementById('totalSessions');
    const totalMessagesEl = document.getElementById('totalMessages');
    const totalToolCallsEl = document.getElementById('totalToolCalls');
    const totalTokensEl = document.getElementById('totalTokens');
    const totalInputTokensEl = document.getElementById('totalInputTokens');
    const totalOutputTokensEl = document.getElementById('totalOutputTokens');
    const estimatedCostEl = document.getElementById('estimatedCost');

    if (totalProjectsEl) totalProjectsEl.textContent = projects.length;
    if (totalSessionsEl) totalSessionsEl.textContent = totalSessions;
    if (totalMessagesEl) totalMessagesEl.textContent = totalMessages;
    if (totalToolCallsEl) totalToolCallsEl.textContent = totalToolCalls;
    if (totalTokensEl) totalTokensEl.textContent = totalTokens.toLocaleString();
    if (totalInputTokensEl) totalInputTokensEl.textContent = totalInputTokens.toLocaleString();
    if (totalOutputTokensEl) totalOutputTokensEl.textContent = totalOutputTokens.toLocaleString();
    if (estimatedCostEl) estimatedCostEl.textContent = `$${estimatedCost.toFixed(2)}`;

    // 显示模态框
    statsModalEl.classList.add('active');
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// 导出为 Markdown
function exportAsMarkdown() {
  if (!currentSession || !currentSession.messages) return;

  let markdown = `# 会话记录\n\n`;
  markdown += `**会话 ID**: ${currentSession.id}\n\n`;
  markdown += `**时间**: ${formatTime(new Date())}\n\n`;
  markdown += `---\n\n`;

  currentSession.messages.forEach(msg => {
    const type = msg.type === 'user' ? '用户' : '助手';
    const time = formatTime(new Date(msg.timestamp));
    const content = extractMessageContent(msg);

    markdown += `## ${type} (${time})\n\n`;
    markdown += `${content}\n\n`;

    // 添加工具调用信息
    if (msg.message?.content && Array.isArray(msg.message.content)) {
      const toolCalls = msg.message.content.filter(c => c.type === 'tool_use');
      if (toolCalls.length > 0) {
        markdown += `### 工具调用\n\n`;
        toolCalls.forEach(tc => {
          markdown += `**工具**: ${tc.name}\n\n`;
          markdown += `\`\`\`json\n${JSON.stringify(tc.input, null, 2)}\n\`\`\`\n\n`;
        });
      }

      const toolResults = msg.message.content.filter(c => c.type === 'tool_result');
      if (toolResults.length > 0) {
        markdown += `### 工具结果\n\n`;
        toolResults.forEach(tr => {
          markdown += `\`\`\`json\n${JSON.stringify(tr.content, null, 2)}\n\`\`\`\n\n`;
        });
      }
    }

    markdown += `---\n\n`;
  });

  downloadFile(markdown, `session-${currentSession.id}.md`, 'text/markdown');
}

// 导出为 JSON
function exportAsJson() {
  if (!currentSession || !currentSession.messages) return;

  const json = JSON.stringify(currentSession.messages, null, 2);
  downloadFile(json, `session-${currentSession.id}.json`, 'application/json');
}

// 下载文件
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 滚动到底部
async function scrollToBottom() {
  if (!messagesContainer) return;

  // 显示加载提示
  showToast('正在加载所有消息...', 'info');

  // 加载所有剩余消息
  while (loadedMessageCount < allMessages.length) {
    loadMoreMessages(LOAD_MORE_COUNT);
    // 给UI一点时间更新
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // 移除加载更多按钮
  removeLoadMoreButton();

  // 滚动到底部
  messagesContainer.scrollTo({
    top: messagesContainer.scrollHeight,
    behavior: 'smooth'
  });

  // 更新消息目录状态
  updateMessageIndexLoadingStatus();

  showToast('已跳转到最后一条消息');
}

// 切换工具结果的展开/折叠状态
window.toggleToolResult = function(resultId) {
  const content = document.getElementById(resultId);
  const header = content.previousElementSibling;
  const toggleIcon = header.querySelector('.toggle-icon');

  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    toggleIcon.textContent = '▼';
  } else {
    content.classList.add('expanded');
    toggleIcon.textContent = '▲';
  }
}

// 切换工具调用的展开/折叠状态
window.toggleToolCall = function(callId) {
  const content = document.getElementById(callId);
  const header = content.previousElementSibling;
  const toggleIcon = header.querySelector('.toggle-icon');

  if (content.classList.contains('expanded')) {
    content.classList.remove('expanded');
    toggleIcon.textContent = '▼';
  } else {
    content.classList.add('expanded');
    toggleIcon.textContent = '▲';
  }
}

// 切换消息目录显示/隐藏
function toggleMessageIndex() {
  renderMessageIndex();
  messageIndexPanel.classList.toggle('hidden');
}

// 渲染消息目录
function renderMessageIndex() {
  if (userMessagesIndex.length === 0) {
    messageIndexList.innerHTML = '<div class="empty-index">暂无用户消息</div>';
    return;
  }

  messageIndexList.innerHTML = userMessagesIndex.map((msg, index) => {
    const isLoaded = msg.messageIndex < loadedMessageCount;
    const loadedClass = isLoaded ? '' : 'not-loaded';
    const loadedIndicator = isLoaded ? '' : '<span class="loading-indicator" title="消息未加载">⏳</span>';
    
    return `
    <div class="message-index-item ${loadedClass}" onclick="scrollToMessage('${msg.id}')" data-message-id="${msg.id}">
      <div class="message-index-number">${index + 1}</div>
      <div class="message-index-content">
        <div class="message-index-preview">${escapeHtml(msg.preview)}</div>
        <div class="message-index-time">${msg.time}${loadedIndicator}</div>
      </div>
    </div>
  `;
  }).join('');
}

// 更新消息目录的加载状态
function updateMessageIndexLoadingStatus() {
  if (!messageIndexPanel || messageIndexPanel.classList.contains('hidden')) {
    return;
  }

  const items = messageIndexList.querySelectorAll('.message-index-item');
  items.forEach(item => {
    const messageId = item.dataset.messageId;
    const msg = userMessagesIndex.find(m => m.id === messageId);
    if (msg) {
      const isLoaded = msg.messageIndex < loadedMessageCount;
      if (isLoaded) {
        item.classList.remove('not-loaded');
        const timeEl = item.querySelector('.message-index-time');
        const indicator = timeEl.querySelector('.loading-indicator');
        if (indicator) {
          indicator.remove();
        }
      }
    }
  });
}

// 跳转到指定消息
window.scrollToMessage = async function(messageId) {
  // 查找目标消息在索引中的位置
  const targetMsgIndex = userMessagesIndex.findIndex(msg => msg.id === messageId);
  
  if (targetMsgIndex === -1) {
    showToast('消息未找到', 'error');
    return;
  }

  const targetMessage = userMessagesIndex[targetMsgIndex];
  const targetIndex = targetMessage.messageIndex;

  // 检查消息是否已加载
  if (targetIndex >= loadedMessageCount) {
    showToast('正在加载消息...', 'info');
    
    // 加载消息直到目标位置
    while (loadedMessageCount <= targetIndex) {
      loadMoreMessages(LOAD_MORE_COUNT);
      // 给UI一点时间更新
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 移除加载更多按钮
    removeLoadMoreButton();
  }

  const messageElement = document.getElementById(messageId);
  if (!messageElement) {
    showToast('消息加载失败', 'error');
    return;
  }

  // 计算滚动位置，让消息居中显示
  const containerRect = messagesContainer.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();
  const scrollTop = messagesContainer.scrollTop;
  const targetScrollTop = scrollTop + (messageRect.top - containerRect.top) - (containerRect.height / 2) + (messageRect.height / 2);

  messagesContainer.scrollTo({
    top: targetScrollTop,
    behavior: 'smooth'
  });

  // 高亮显示消息
  messageElement.style.boxShadow = '0 0 0 2px var(--accent-primary), 0 4px 20px rgba(99, 102, 241, 0.3)';
  messageElement.style.transform = 'scale(1.02)';
  
  setTimeout(() => {
    messageElement.style.boxShadow = '';
    messageElement.style.transform = '';
  }, 2000);

  // 关闭目录面板
  messageIndexPanel.classList.add('hidden');
}

// 显示工具详情
window.showToolDetail = function(toolCallId) {
  const toolData = toolCallsMap.get(toolCallId);
  if (!toolData) {
    showToast('工具详情未找到', 'error');
    return;
  }

  const { toolCall, message, icon, color, displayName } = toolData;

  // 查找工具结果 - 在整个消息历史中查找
  let toolResult = null;
  let resultMessage = null;
  for (const m of allMessages) {
    if (m.message?.content && Array.isArray(m.message.content)) {
      const foundResult = m.message.content.find(c => c.type === 'tool_result' && c.tool_use_id === toolCallId);
      if (foundResult) {
        toolResult = foundResult;
        resultMessage = m;
        break;
      }
    }
  }

  // 判断工具执行状态
  const isError = resultMessage?.toolUseResult?.status !== 'success';

  // 检查执行结果是否为空
  let hasResultContent = false;
  if (toolResult) {
    const formattedResult = formatToolResult(toolResult.content);
    // 检查格式化后的结果是否包含实际内容（不仅仅是"空结果"或"等待结果"等占位符）
    hasResultContent = !formattedResult.includes('（空结果）') &&
                      !formattedResult.includes('无参数') &&
                      !formattedResult.includes('{0 个键}') &&
                      !formattedResult.includes('[0 项]');
  }

  // 创建详情模态框
  const modal = document.createElement('div');
  modal.className = 'modal tool-detail-modal';
  modal.innerHTML = `
    <div class="modal-content tool-detail-content">
      <div class="modal-header">
        <div class="tool-detail-header">
          <span class="tool-icon" style="font-size: 24px;">${icon}</span>
          <div>
            <h2 style="font-size: 18px; font-weight: 600;">${escapeHtml(displayName)}</h2>
            <p style="font-size: 12px; color: var(--text-muted);">${escapeHtml(toolCall.name)}</p>
          </div>
        </div>
        <button class="btn btn-icon close-tool-detail">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="modal-body tool-detail-body">
        <div class="tool-detail-section">
          <h3 class="tool-detail-section-title">
            <span>📥</span> 参数输入
          </h3>
          <div class="tool-detail-content-box">
            ${formatToolParams(toolCall.input)}
          </div>
        </div>
        ${toolResult && hasResultContent ? `
        <div class="tool-detail-section">
          <h3 class="tool-detail-section-title ${isError ? 'error' : 'success'}">
            <span>${isError ? '❌' : '✓'}</span> ${isError ? '执行结果（失败）' : '执行结果'}
          </h3>
          <div class="tool-detail-content-box ${isError ? 'error' : ''}">
            ${formatToolResult(toolResult.content)}
          </div>
        </div>
        ` : ''}
        <div class="tool-detail-section">
          <h3 class="tool-detail-section-title">
            <span>ℹ️</span> 元信息
          </h3>
          <div class="tool-detail-meta">
            <div class="meta-item">
              <span class="meta-label">调用ID:</span>
              <span class="meta-value">${escapeHtml(toolCall.id)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">时间:</span>
              <span class="meta-value">${formatTime(new Date(message.timestamp))}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">参数数量:</span>
              <span class="meta-value">${toolCall.input ? Object.keys(toolCall.input).length : 0}</span>
            </div>
            ${toolResult ? `
            <div class="meta-item">
              <span class="meta-label">状态:</span>
              <span class="meta-value ${isError ? 'error' : 'success'}">${isError ? '失败' : '成功'}</span>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="modal-actions" style="max-width: 400px; margin: 0 auto;">
        <button class="btn btn-secondary copy-detail-params" data-tool-id="${toolCallId}">
          📋 复制参数
        </button>
        ${toolResult && hasResultContent ? `
        <button class="btn btn-secondary copy-detail-result" data-tool-id="${toolCallId}">
          📋 复制结果
        </button>
        ` : ''}
        <button class="btn close-tool-detail-btn" style="background: var(--accent-gradient); color: white;">
          关闭
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  // 添加关闭事件
  const closeModal = () => {
    modal.classList.add('active');
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector('.close-tool-detail').addEventListener('click', closeModal);
  modal.querySelector('.close-tool-detail-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // 复制参数
  const copyParamsBtn = modal.querySelector('.copy-detail-params');
  if (copyParamsBtn) {
    copyParamsBtn.addEventListener('click', () => {
      const jsonStr = JSON.stringify(toolCall.input, null, 2);
      copyToClipboard(jsonStr);
    });
  }

  // 复制结果
  const copyResultBtn = modal.querySelector('.copy-detail-result');
  if (copyResultBtn) {
    copyResultBtn.addEventListener('click', () => {
      const contentStr = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content, null, 2);
      copyToClipboard(contentStr);
    });
  }

  // 显示模态框
  requestAnimationFrame(() => {
    modal.classList.add('active');
  });
}

// 打开项目目录
async function openProjectDirectory() {
  if (!currentProject) {
    showToast('没有选中的项目', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/open-directory/${currentProject.id}`);
    const result = await response.json();

    if (result.success) {
      showToast('已打开项目目录');
    } else {
      showToast(result.error || '打开目录失败', 'error');
    }
  } catch (error) {
    console.error('Failed to open directory:', error);
    showToast('打开目录失败', 'error');
  }
}