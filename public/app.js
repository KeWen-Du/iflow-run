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

// ==================== v1.2.0 新增功能状态 ====================
let selectedSessions = new Set(); // 批量选择的会话
let isBatchMode = false; // 批量操作模式
let advancedFilters = {
  model: '', // 模型筛选
  status: '', // 状态筛选：success, error, all
  tag: '' // 标签筛选
};
let allTags = {}; // 所有标签数据
let allModels = new Set(); // 所有模型列表

// ==================== 会话收藏功能 ====================
const FAVORITES_KEY = 'iflow-run-favorites';

// 获取收藏列表
function getFavorites() {
  try {
    const favorites = localStorage.getItem(FAVORITES_KEY);
    return favorites ? JSON.parse(favorites) : [];
  } catch {
    return [];
  }
}

// 检查会话是否已收藏
function isFavorite(projectId, sessionId) {
  const favorites = getFavorites();
  return favorites.some(f => f.projectId === projectId && f.sessionId === sessionId);
}

// 添加收藏
function addFavorite(projectId, sessionId, preview) {
  const favorites = getFavorites();
  if (!isFavorite(projectId, sessionId)) {
    favorites.push({ projectId, sessionId, preview, addedAt: Date.now() });
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    showToast('已收藏此会话');
  }
}

// 移除收藏
function removeFavorite(projectId, sessionId) {
  let favorites = getFavorites();
  favorites = favorites.filter(f => !(f.projectId === projectId && f.sessionId === sessionId));
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  showToast('已取消收藏');
}

// 切换收藏状态
function toggleFavorite(projectId, sessionId, preview) {
  if (isFavorite(projectId, sessionId)) {
    removeFavorite(projectId, sessionId);
    return false;
  } else {
    addFavorite(projectId, sessionId, preview);
    return true;
  }
}

// ==================== 用户设置功能 ====================
const SETTINGS_KEY = 'iflow-run-settings';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  pageSize: 20,
  autoRefresh: true,
  defaultMessageFilter: 'all'
};

// 获取用户设置
function getUserSettings() {
  try {
    const settings = localStorage.getItem(SETTINGS_KEY);
    return settings ? { ...DEFAULT_SETTINGS, ...JSON.parse(settings) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// 保存用户设置
function saveUserSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// DOM 元素
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const projectsList = document.getElementById('projectsList');
const sessionsContainer = document.getElementById('sessionsContainer');
const sessionDetail = document.getElementById('sessionDetail');
const messagesContainer = document.getElementById('messagesContainer');
const currentProjectTitle = document.getElementById('currentProjectTitle');
const backBtn = document.getElementById('backBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchBox = document.getElementById('searchBox');
const themeBtn = document.getElementById('themeBtn');
const openIflowBtn = document.getElementById('openIflowBtn');
const openDirectoryBtn = document.getElementById('openDirectoryBtn');
const openWorkdirBtn = document.getElementById('openWorkdirBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
const toggleMessageIndexBtn = document.getElementById('toggleMessageIndexBtn');
const messageIndexPanel = document.getElementById('messageIndexPanel');
const closeMessageIndexBtn = document.getElementById('closeMessageIndexBtn');
const messageIndexList = document.getElementById('messageIndexList');

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

  // 加载侧边栏状态
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed');
  if (sidebarCollapsed === 'true' && sidebar) {
    sidebar.classList.add('collapsed');
  }

  await loadProjects();
  setupEventListeners();
  
  // 初始化 v1.2.0 新功能
  await initV120Features();
}

// 设置事件监听
function setupEventListeners() {
  // 侧边栏切换
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
  }

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

  // 搜索按钮点击显示/隐藏搜索框
  if (searchToggleBtn && searchBox) {
    searchToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = searchBox.classList.toggle('hidden');
      if (!isHidden) {
        searchInput.focus();
      }
    });

    // 点击其他地方关闭搜索框
    document.addEventListener('click', (e) => {
      if (!searchBox.contains(e.target) && !searchToggleBtn.contains(e.target)) {
        searchBox.classList.add('hidden');
      }
    });

    // ESC键关闭搜索框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !searchBox.classList.contains('hidden')) {
        searchBox.classList.add('hidden');
      }
    });
  }

  // 搜索功能
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderSessionsList();
    });
  }

  // 主题切换
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
    });
  }

  // 打开 iflow 功能
  if (openIflowBtn) {
    openIflowBtn.addEventListener('click', () => {
      openIflowInWorkingDir();
    });
  }

  // 打开目录功能
  if (openDirectoryBtn) {
    openDirectoryBtn.addEventListener('click', () => {
      openProjectDirectory();
    });
  }

  // 打开工作目录功能
  if (openWorkdirBtn) {
    openWorkdirBtn.addEventListener('click', () => {
      openWorkingDirectory();
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
  const messageSearchToggleBtn = document.getElementById('messageSearchToggleBtn');
  const messageSearchBox = document.getElementById('messageSearchBox');

  // 搜索按钮点击显示/隐藏搜索框
  if (messageSearchToggleBtn && messageSearchBox) {
    messageSearchToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = messageSearchBox.classList.toggle('hidden');
      if (!isHidden && messageSearchInput) {
        messageSearchInput.focus();
      }
    });

    // 点击其他地方关闭搜索框
    document.addEventListener('click', (e) => {
      if (!messageSearchBox.contains(e.target) && !messageSearchToggleBtn.contains(e.target)) {
        messageSearchBox.classList.add('hidden');
      }
    });

    // ESC键关闭搜索框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !messageSearchBox.classList.contains('hidden')) {
        messageSearchBox.classList.add('hidden');
      }
    });
  }

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

  // 初始化设置面板
  initSettingsPanel();
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
      <div class="project-item-content">
        <div class="project-name">${project.name}</div>
        <div class="project-meta">
          <span class="session-count">${project.sessionCount} 个会话</span>
        </div>
      </div>
      <button class="btn btn-icon project-open-iflow" data-project-id="${project.id}" title="打开 iflow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="12" y1="19" x2="20" y2="19" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `).join('');

  // 添加点击事件（使用事件委托）
  projectsList.addEventListener('click', (e) => {
    // 检查是否点击了打开 iflow 按钮
    const openIflowBtn = e.target.closest('.project-open-iflow');
    if (openIflowBtn) {
      e.stopPropagation();
      const projectId = openIflowBtn.dataset.projectId;
      openIflowForProject(projectId);
      return;
    }

    // 检查是否点击了项目项
    const projectItem = e.target.closest('.project-item');
    if (projectItem) {
      const projectId = projectItem.dataset.projectId;
      selectProject(projectId);
    }
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

  // 更新模型列表
  updateModelsList();

  // 根据搜索查询过滤会话
  let filteredSessions = currentProject.sessions.filter(session => {
    if (!searchQuery) return true;

    const searchText = searchQuery.toLowerCase();
    const matchId = session.id.toLowerCase().includes(searchText);
    const matchPreview = session.preview.toLowerCase().includes(searchText);

    return matchId || matchPreview;
  });

  // 应用高级筛选
  filteredSessions = filteredSessions.filter(session => sessionMatchesFilters(session));

  // 将收藏的会话排在前面
  const favorites = getFavorites();
  filteredSessions = filteredSessions.sort((a, b) => {
    const aIsFav = favorites.some(f => f.projectId === currentProject.id && f.sessionId === a.id);
    const bIsFav = favorites.some(f => f.projectId === currentProject.id && f.sessionId === b.id);
    if (aIsFav && !bIsFav) return -1;
    if (!aIsFav && bIsFav) return 1;
    return 0;
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
      ${filteredSessions.map(session => {
        const isFav = isFavorite(currentProject.id, session.id);
        const sessionKey = `${currentProject.id}/${session.id}`;
        const isSelected = selectedSessions.has(sessionKey);
        const sessionTags = session.tags || [];
        const statusIcon = session.status === 'error' ? '❌' : session.status === 'success' ? '✓' : '?';
        const statusClass = session.status === 'error' ? 'status-error' : session.status === 'success' ? 'status-success' : 'status-unknown';
        
        return `
        <div class="session-card ${isBatchMode ? 'batch-mode' : ''} ${isFav ? 'favorite' : ''} ${isSelected ? 'selected' : ''}" data-session-id="${session.id}">
          ${isBatchMode ? `
            <div class="session-checkbox">
              <input type="checkbox" ${isSelected ? 'checked' : ''} data-session-id="${session.id}" />
            </div>
          ` : ''}
          <div class="session-card-header">
            <div class="session-id">${session.id}</div>
            <div class="session-time">${formatTime(session.mtime)}</div>
          </div>
          <div class="session-preview">${escapeHtml(session.preview)}</div>
          <div class="session-meta-row">
            ${session.model ? `<span class="session-model" title="模型">🤖 ${session.model}</span>` : ''}
            <span class="session-status ${statusClass}" title="状态">${statusIcon}</span>
            ${session.tokenUsage?.total ? `<span class="session-tokens" title="Token 消耗">📊 ${session.tokenUsage.total}</span>` : ''}
          </div>
          ${sessionTags.length > 0 ? `
            <div class="session-tags">
              ${sessionTags.map(tag => {
                const tagData = allTags[tag] || { color: '#6366f1' };
                return `<span class="tag-badge small" style="background: ${tagData.color}20; border-color: ${tagData.color};">${tag}</span>`;
              }).join('')}
            </div>
          ` : ''}
          <div class="session-card-actions">
            <button class="btn btn-icon btn-small tag-btn" 
                    data-session-id="${session.id}"
                    title="管理标签">
              🏷️
            </button>
            <button class="btn btn-icon btn-small favorite-btn ${isFav ? 'active' : ''}" 
                    data-session-id="${session.id}" 
                    data-preview="${escapeHtml(session.preview.substring(0, 50))}"
                    title="${isFav ? '取消收藏' : '收藏此会话'}">
              ${isFav ? '⭐' : '☆'}
            </button>
            <button class="btn btn-icon btn-small delete-btn" 
                    data-session-id="${session.id}"
                    title="删除此会话">
              🗑️
            </button>
          </div>
        </div>
      `}).join('')}
    </div>
  `;

  // 批量模式复选框事件
  if (isBatchMode) {
    sessionsContainer.querySelectorAll('.session-checkbox input').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const sessionId = checkbox.dataset.sessionId;
        toggleSessionSelection(sessionId);
        checkbox.closest('.session-card').classList.toggle('selected', selectedSessions.has(`${currentProject.id}/${sessionId}`));
      });
    });
  }

  // 添加标签按钮事件
  sessionsContainer.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      showTagManagerModal(sessionId);
    });
  });

  // 添加收藏和删除按钮事件监听
  sessionsContainer.querySelectorAll('.favorite-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      const preview = btn.dataset.preview;
      const newState = toggleFavorite(currentProject.id, sessionId, preview);
      btn.classList.toggle('active', newState);
      btn.textContent = newState ? '⭐' : '☆';
      btn.title = newState ? '取消收藏' : '收藏此会话';
      btn.closest('.session-card').classList.toggle('favorite', newState);
      // 重新排序
      setTimeout(() => renderSessionsList(), 100);
    });
  });

  sessionsContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      if (confirm(`确定要删除会话 "${sessionId}" 吗？此操作不可恢复。`)) {
        await deleteSession(currentProject.id, sessionId);
      }
    });
  });
}

// 删除会话
async function deleteSession(projectId, sessionId) {
  try {
    const response = await fetch(`/api/sessions/${projectId}/${sessionId}`, {
      method: 'DELETE'
    });
    const result = await response.json();

    if (result.success) {
      showToast('会话已删除');
      // 从当前项目会话列表中移除
      if (currentProject) {
        currentProject.sessions = currentProject.sessions.filter(s => s.id !== sessionId);
        currentProject.sessionCount = currentProject.sessions.length;
        // 如果删除的是当前查看的会话，返回列表
        if (currentSession && currentSession.id === sessionId) {
          sessionDetail.classList.add('hidden');
          sessionsContainer.classList.remove('hidden');
          currentSession = null;
        }
        renderSessionsList();
      }
    } else {
      showToast(result.error || '删除失败', 'error');
    }
  } catch (error) {
    console.error('Failed to delete session:', error);
    showToast('删除失败', 'error');
  }
}

// 加载会话详情
async function loadSession(sessionId) {
  if (!currentProject) {
    console.error('currentProject is null!');
    return;
  }

  try {
    const url = `/api/sessions/${currentProject.id}/${sessionId}`;
    const response = await fetch(url);
    const messages = await response.json();

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

  // 显示/隐藏打开工作目录按钮
  if (openWorkdirBtn) {
    openWorkdirBtn.style.display = cwd ? 'flex' : 'none';
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
    loadMoreBtn.className = 'btn btn-secondary load-more-btn';
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
      return '';
    }

    // 如果没有 text 部分，返回空字符串
    return '';
  }

  // 对象类型
  if (typeof content === 'object') {
    return JSON.stringify(content, null, 2);
  }

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

// 数字格式化（添加千位分隔符）
function formatNumber(num) {
  if (num === null || num === undefined) {
    return '0';
  }
  return Number(num).toLocaleString('zh-CN');
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

// ==================== 设置面板功能 ====================

// 显示设置面板
function showSettingsModal() {
  const settingsModalEl = document.getElementById('settingsModal');
  if (!settingsModalEl) return;

  // 加载当前设置
  const settings = getUserSettings();

  // 填充设置值
  const themeSelect = document.getElementById('settingTheme');
  const pageSizeSelect = document.getElementById('settingPageSize');
  const defaultFilterSelect = document.getElementById('settingDefaultFilter');
  const autoRefreshCheck = document.getElementById('settingAutoRefresh');

  if (themeSelect) themeSelect.value = settings.theme;
  if (pageSizeSelect) pageSizeSelect.value = settings.pageSize;
  if (defaultFilterSelect) defaultFilterSelect.value = settings.defaultMessageFilter;
  if (autoRefreshCheck) autoRefreshCheck.checked = settings.autoRefresh;

  // 显示模态框
  settingsModalEl.classList.add('active');
}

// 关闭设置面板
function closeSettingsModal() {
  const settingsModalEl = document.getElementById('settingsModal');
  if (settingsModalEl) {
    settingsModalEl.classList.remove('active');
  }
}

// 保存设置
function saveSettings() {
  const themeSelect = document.getElementById('settingTheme');
  const pageSizeSelect = document.getElementById('settingPageSize');
  const defaultFilterSelect = document.getElementById('settingDefaultFilter');
  const autoRefreshCheck = document.getElementById('settingAutoRefresh');

  const settings = {
    theme: themeSelect?.value || 'dark',
    pageSize: parseInt(pageSizeSelect?.value || '20'),
    defaultMessageFilter: defaultFilterSelect?.value || 'all',
    autoRefresh: autoRefreshCheck?.checked !== false
  };

  saveUserSettings(settings);

  // 应用主题
  if (settings.theme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }

  showToast('设置已保存');
  closeSettingsModal();
}

// 重置设置
function resetSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  showToast('设置已恢复默认');
  showSettingsModal(); // 重新加载默认设置
}

// 初始化设置面板事件监听
function initSettingsPanel() {
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  const settingsModalEl = document.getElementById('settingsModal');

  if (settingsBtn) {
    settingsBtn.addEventListener('click', showSettingsModal);
  }

  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveSettings);
  }

  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener('click', resetSettings);
  }

  if (settingsModalEl) {
    settingsModalEl.addEventListener('click', (e) => {
      if (e.target === settingsModalEl) {
        closeSettingsModal();
      }
    });
  }
}

// 启动应用
init();

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
      <div class="modal-actions">
        <button class="btn btn-secondary copy-detail-params" data-tool-id="${toolCallId}">
          📋 复制参数
        </button>
        ${toolResult && hasResultContent ? `
        <button class="btn btn-secondary copy-detail-result" data-tool-id="${toolCallId}">
          📋 复制结果
        </button>
        ` : ''}
        <button class="btn btn-primary close-tool-detail-btn">
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
      showToast('已打开会话目录');
    } else {
      showToast(result.error || '打开目录失败', 'error');
    }
  } catch (error) {
    console.error('Failed to open directory:', error);
    showToast('打开目录失败', 'error');
  }
}

// 打开工作目录
async function openWorkingDirectory() {
  if (!currentProject || !currentSession) {
    showToast('没有选中的会话', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/open-workdir/${currentProject.id}/${currentSession.id}`);
    const result = await response.json();

    if (result.success) {
      showToast(`已打开 ${result.path}`);
    } else {
      showToast(result.error || '打开目录失败', 'error');
    }
  } catch (error) {
    console.error('Failed to open working directory:', error);
    showToast('打开目录失败', 'error');
  }
}

// 在工作目录打开终端并执行 iflow
async function openIflowInWorkingDir() {
  if (!currentProject || !currentSession) {
    showToast('没有选中的会话', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/open-iflow/${currentProject.id}/${currentSession.id}`);
    const result = await response.json();

    if (result.success) {
      showToast(`已在 ${result.path} 打开 iflow`);
    } else {
      showToast(result.error || '打开 iflow 失败', 'error');
    }
  } catch (error) {
    console.error('Failed to open iflow:', error);
    showToast('打开 iflow 失败', 'error');
  }
}

// 在项目的工作目录打开终端并执行 iflow
async function openIflowForProject(projectId) {
  try {
    const response = await fetch(`/api/open-iflow-project/${projectId}`);
    const result = await response.json();

    if (result.success) {
      showToast(`已在 ${result.path} 打开 iflow`);
    } else {
      showToast(result.error || '打开 iflow 失败', 'error');
    }
  } catch (error) {
    console.error('Failed to open iflow for project:', error);
    showToast('打开 iflow 失败', 'error');
  }
}

// ==================== v1.2.0 批量操作功能 ====================

// 切换批量操作模式
function toggleBatchMode() {
  // 检查是否在会话详情页面，如果是则不允许进入批量模式
  const sessionDetail = document.getElementById('sessionDetail');
  if (sessionDetail && !sessionDetail.classList.contains('hidden')) {
    showToast('请先返回会话列表再使用批量操作模式', 'error');
    return;
  }
  
  isBatchMode = !isBatchMode;
  selectedSessions.clear();
  
  const batchModeBtn = document.getElementById('batchModeBtn');
  const batchActionsPanel = document.getElementById('batchActionsPanel');
  const advancedFilterPanel = document.getElementById('advancedFilterPanel');
  
  if (isBatchMode) {
    if (batchModeBtn) batchModeBtn.classList.add('active');
    if (batchActionsPanel) batchActionsPanel.classList.remove('hidden');
    if (advancedFilterPanel) advancedFilterPanel.classList.remove('hidden');
    showToast('已进入批量操作模式');
  } else {
    if (batchModeBtn) batchModeBtn.classList.remove('active');
    if (batchActionsPanel) batchActionsPanel.classList.add('hidden');
    if (advancedFilterPanel) advancedFilterPanel.classList.add('hidden');
    showToast('已退出批量操作模式');
  }
  
  renderSessionsList();
}

// 切换会话选择
function toggleSessionSelection(sessionId) {
  const key = `${currentProject.id}/${sessionId}`;
  if (selectedSessions.has(key)) {
    selectedSessions.delete(key);
  } else {
    selectedSessions.add(key);
  }
  updateBatchSelectionCount();
}

// 全选/取消全选
function toggleSelectAll() {
  if (!currentProject) return;
  
  const allSessionKeys = currentProject.sessions.map(s => `${currentProject.id}/${s.id}`);
  const allSelected = allSessionKeys.every(key => selectedSessions.has(key));
  
  if (allSelected) {
    allSessionKeys.forEach(key => selectedSessions.delete(key));
  } else {
    allSessionKeys.forEach(key => selectedSessions.add(key));
  }
  
  renderSessionsList();
  updateBatchSelectionCount();
}

// 更新批量选择计数
function updateBatchSelectionCount() {
  const countEl = document.getElementById('selectedCount');
  if (countEl) {
    countEl.textContent = selectedSessions.size;
  }
}

// 批量删除会话
async function batchDeleteSessions() {
  if (selectedSessions.size === 0) {
    showToast('请先选择要删除的会话', 'error');
    return;
  }
  
  const sessions = Array.from(selectedSessions).map(key => {
    const [projectId, sessionId] = key.split('/');
    return { projectId, sessionId };
  });
  
  if (!confirm(`确定要删除 ${sessions.length} 个会话吗？此操作不可恢复。`)) {
    return;
  }
  
  try {
    const response = await fetch('/api/sessions/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(`已删除 ${result.deletedCount} 个会话`);
      selectedSessions.clear();
      
      // 刷新项目列表
      await loadProjects();
      if (currentProject) {
        selectProject(currentProject.id);
      }
    } else {
      showToast(result.error || '批量删除失败', 'error');
    }
  } catch (error) {
    console.error('Failed to batch delete sessions:', error);
    showToast('批量删除失败', 'error');
  }
}

// ==================== v1.2.0 高级筛选功能 ====================

// 加载标签数据
async function loadTagsData() {
  try {
    const response = await fetch('/api/tags');
    const data = await response.json();
    allTags = data.tags || {};
    
    // 更新标签筛选下拉框
    updateTagFilterOptions();
  } catch (error) {
    console.error('Failed to load tags:', error);
  }
}

// 更新标签筛选选项
function updateTagFilterOptions() {
  const tagFilter = document.getElementById('tagFilter');
  if (!tagFilter) return;
  
  const currentValue = tagFilter.value;
  tagFilter.innerHTML = '<option value="">全部标签</option>';
  
  Object.keys(allTags).forEach(tagName => {
    const option = document.createElement('option');
    option.value = tagName;
    option.textContent = `${tagName} (${allTags[tagName].count || 0})`;
    tagFilter.appendChild(option);
  });
  
  tagFilter.value = currentValue;
}

// 应用高级筛选
function applyAdvancedFilters() {
  const modelFilter = document.getElementById('modelFilter');
  const statusFilter = document.getElementById('statusFilter');
  const tagFilter = document.getElementById('tagFilter');
  
  advancedFilters.model = modelFilter?.value || '';
  advancedFilters.status = statusFilter?.value || '';
  advancedFilters.tag = tagFilter?.value || '';
  
  renderSessionsList();
}

// 重置高级筛选
function resetAdvancedFilters() {
  advancedFilters = { model: '', status: '', tag: '' };
  
  const modelFilter = document.getElementById('modelFilter');
  const statusFilter = document.getElementById('statusFilter');
  const tagFilter = document.getElementById('tagFilter');
  
  if (modelFilter) modelFilter.value = '';
  if (statusFilter) statusFilter.value = '';
  if (tagFilter) tagFilter.value = '';
  
  renderSessionsList();
}

// 检查会话是否符合高级筛选条件
function sessionMatchesFilters(session) {
  // 模型筛选
  if (advancedFilters.model && session.model !== advancedFilters.model) {
    return false;
  }
  
  // 状态筛选
  if (advancedFilters.status && session.status !== advancedFilters.status) {
    return false;
  }
  
  // 标签筛选
  if (advancedFilters.tag) {
    const sessionTags = session.tags || [];
    if (!sessionTags.includes(advancedFilters.tag)) {
      return false;
    }
  }
  
  return true;
}

// 更新模型列表
function updateModelsList() {
  if (!currentProject) return;
  
  allModels.clear();
  currentProject.sessions.forEach(session => {
    if (session.model) {
      allModels.add(session.model);
    }
  });
  
  // 更新模型筛选下拉框
  const modelFilter = document.getElementById('modelFilter');
  if (!modelFilter) return;
  
  const currentValue = modelFilter.value;
  modelFilter.innerHTML = '<option value="">全部模型</option>';
  
  Array.from(allModels).sort().forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelFilter.appendChild(option);
  });
  
  modelFilter.value = currentValue;
}

// ==================== v1.2.0 标签管理功能 ====================

// 显示标签管理模态框
async function showTagManagerModal(sessionId) {
  const key = `${currentProject.id}/${sessionId}`;
  const session = currentProject.sessions.find(s => s.id === sessionId);
  
  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'modal tag-manager-modal';
  modal.innerHTML = `
    <div class="modal-content tag-manager-content">
      <div class="modal-header">
        <h2>🏷️ 管理标签</h2>
        <button class="btn btn-icon close-tag-manager">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="tag-session-info">
          <span class="tag-session-id">${sessionId}</span>
          <span class="tag-session-preview">${session?.preview?.substring(0, 50) || ''}...</span>
        </div>
        <div class="tag-input-section">
          <input type="text" id="newTagInput" placeholder="输入新标签..." class="tag-input" />
          <button class="btn btn-primary" id="addTagBtn">添加</button>
        </div>
        <div class="current-tags-section">
          <h4>当前标签</h4>
          <div id="currentTagsList" class="current-tags-list">
            <span class="loading-tags">加载中...</span>
          </div>
        </div>
        <div class="all-tags-section">
          <h4>所有标签</h4>
          <div id="allTagsList" class="all-tags-list">
            ${Object.keys(allTags).length === 0 ? '<span class="no-tags">暂无标签</span>' : 
              Object.entries(allTags).map(([name, data]) => `
                <span class="tag-badge clickable" data-tag="${name}" style="background: ${data.color}20; border-color: ${data.color};">
                  ${name}
                </span>
              `).join('')}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary close-tag-manager-btn">关闭</button>
        <button class="btn btn-primary save-tags-btn">保存</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 加载当前会话标签
  await loadSessionTags(sessionId);
  
  // 添加事件监听
  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 200);
  };
  
  modal.querySelector('.close-tag-manager').addEventListener('click', closeModal);
  modal.querySelector('.close-tag-manager-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // 添加新标签
  const addTagBtn = modal.querySelector('#addTagBtn');
  const newTagInput = modal.querySelector('#newTagInput');
  
  addTagBtn.addEventListener('click', () => {
    const tagName = newTagInput.value.trim().toLowerCase();
    if (tagName) {
      addTagToCurrentSession(tagName);
      newTagInput.value = '';
    }
  });
  
  newTagInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const tagName = newTagInput.value.trim().toLowerCase();
      if (tagName) {
        addTagToCurrentSession(tagName);
        newTagInput.value = '';
      }
    }
  });
  
  // 点击已有标签添加
  modal.querySelector('#allTagsList').addEventListener('click', (e) => {
    const tagBadge = e.target.closest('.tag-badge.clickable');
    if (tagBadge) {
      const tagName = tagBadge.dataset.tag;
      addTagToCurrentSession(tagName);
    }
  });
  
  // 保存标签
  modal.querySelector('.save-tags-btn').addEventListener('click', async () => {
    await saveSessionTags(sessionId);
    closeModal();
  });
  
  // 显示模态框
  requestAnimationFrame(() => {
    modal.classList.add('active');
  });
}

// 当前编辑的会话标签（临时存储）
let currentEditingTags = [];

// 加载会话标签
async function loadSessionTags(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${currentProject.id}/${sessionId}/tags`);
    const data = await response.json();
    currentEditingTags = data.tags || [];
    renderCurrentTags();
  } catch (error) {
    console.error('Failed to load session tags:', error);
    currentEditingTags = [];
    renderCurrentTags();
  }
}

// 渲染当前标签
function renderCurrentTags() {
  const container = document.getElementById('currentTagsList');
  if (!container) return;
  
  if (currentEditingTags.length === 0) {
    container.innerHTML = '<span class="no-current-tags">暂无标签</span>';
    return;
  }
  
  container.innerHTML = currentEditingTags.map(tag => {
    const tagData = allTags[tag] || { color: '#6366f1' };
    return `
      <span class="tag-badge removable" data-tag="${tag}" style="background: ${tagData.color}20; border-color: ${tagData.color};">
        ${tag}
        <button class="remove-tag-btn" data-tag="${tag}">×</button>
      </span>
    `;
  }).join('');
  
  // 添加移除事件
  container.querySelectorAll('.remove-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tagName = btn.dataset.tag;
      removeTagFromCurrentSession(tagName);
    });
  });
}

// 添加标签到当前编辑
function addTagToCurrentSession(tagName) {
  if (!currentEditingTags.includes(tagName)) {
    currentEditingTags.push(tagName);
    renderCurrentTags();
  }
}

// 从当前编辑移除标签
function removeTagFromCurrentSession(tagName) {
  currentEditingTags = currentEditingTags.filter(t => t !== tagName);
  renderCurrentTags();
}

// 保存会话标签
async function saveSessionTags(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${currentProject.id}/${sessionId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: currentEditingTags })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast('标签已保存');
      
      // 更新本地数据
      const session = currentProject.sessions.find(s => s.id === sessionId);
      if (session) {
        session.tags = currentEditingTags;
      }
      
      // 重新加载标签数据
      await loadTagsData();
      renderSessionsList();
    } else {
      showToast(result.error || '保存标签失败', 'error');
    }
  } catch (error) {
    console.error('Failed to save session tags:', error);
    showToast('保存标签失败', 'error');
  }
}

// 初始化 v1.2.0 功能
async function initV120Features() {
  // 加载标签数据
  await loadTagsData();

  // 绑定批量操作按钮事件
  const batchModeBtn = document.getElementById('batchModeBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const batchDeleteBtn = document.getElementById('batchDeleteBtn');

  if (batchModeBtn) {
    batchModeBtn.addEventListener('click', toggleBatchMode);
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', toggleSelectAll);
  }

  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', batchDeleteSessions);
  }

  // 绑定高级筛选事件
  const modelFilter = document.getElementById('modelFilter');
  const statusFilter = document.getElementById('statusFilter');
  const tagFilter = document.getElementById('tagFilter');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  
  if (modelFilter) {
    modelFilter.addEventListener('change', applyAdvancedFilters);
  }
  
  if (statusFilter) {
    statusFilter.addEventListener('change', applyAdvancedFilters);
  }
  
  if (tagFilter) {
    tagFilter.addEventListener('change', applyAdvancedFilters);
  }
  
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', resetAdvancedFilters);
  }
  
  // 初始化 v1.3.0 P1 功能
  initAIFeatures();
}

// ==================== v1.3.0 P1 AI 助手功能 ====================

let aiChatHistory = [];
let isAiPanelOpen = false;

// 切换 AI 助手面板
function toggleAiAssistant() {
  const panel = document.getElementById('aiAssistantPanel');
  const btn = document.getElementById('aiAssistantBtn');
  
  isAiPanelOpen = !isAiPanelOpen;
  
  if (isAiPanelOpen) {
    panel.classList.remove('hidden');
    btn.classList.add('active');
    // 检查 AI 配置
    checkAIConfig();
  } else {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  }
}

// 检查 AI 配置状态
async function checkAIConfig() {
  try {
    const response = await fetch('/api/ai/config');
    const config = await response.json();
    
    const welcomeMsg = document.querySelector('.ai-welcome-message p:last-child');
    if (welcomeMsg) {
      if (config.enabled && config.hasApiKey) {
        welcomeMsg.textContent = 'AI 助手已就绪，有什么可以帮助你的？';
        welcomeMsg.style.color = 'var(--accent-primary)';
      } else {
        welcomeMsg.textContent = '请先在设置中配置 API Key 以启用 AI 功能';
        welcomeMsg.style.color = 'var(--text-muted)';
      }
    }
  } catch (error) {
    console.error('Failed to check AI config:', error);
  }
}

// 发送 AI 消息
async function sendAiMessage(message) {
  const chatMessages = document.getElementById('aiChatMessages');
  const input = document.getElementById('aiChatInput');
  
  // 添加用户消息
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'ai-message user';
  userMsgEl.textContent = message;
  chatMessages.appendChild(userMsgEl);
  
  // 添加加载指示
  const loadingEl = document.createElement('div');
  loadingEl.className = 'ai-message assistant loading';
  loadingEl.textContent = '思考中';
  chatMessages.appendChild(loadingEl);
  
  // 滚动到底部
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // 清空输入框
  input.value = '';
  input.style.height = 'auto';
  
  // 添加到历史
  aiChatHistory.push({ role: 'user', content: message });
  
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: aiChatHistory,
        context: currentSession ? {
          projectId: currentProject?.id,
          sessionId: currentSession?.id,
          sessionSummary: currentProject?.sessions?.find(s => s.id === currentSession?.id)?.preview
        } : null
      })
    });
    
    const result = await response.json();
    
    // 移除加载指示
    loadingEl.remove();
    
    if (result.success) {
      // 添加助手回复
      const assistantMsgEl = document.createElement('div');
      assistantMsgEl.className = 'ai-message assistant';
      assistantMsgEl.innerHTML = formatAIMessage(result.message);
      chatMessages.appendChild(assistantMsgEl);
      
      // 添加到历史
      aiChatHistory.push({ role: 'assistant', content: result.message });
    } else {
      // 显示错误
      const errorEl = document.createElement('div');
      errorEl.className = 'ai-message assistant';
      errorEl.innerHTML = `<span style="color: #ef4444;">错误: ${result.error || result.message}</span>`;
      chatMessages.appendChild(errorEl);
    }
  } catch (error) {
    loadingEl.remove();
    const errorEl = document.createElement('div');
    errorEl.className = 'ai-message assistant';
    errorEl.innerHTML = `<span style="color: #ef4444;">请求失败: ${error.message}</span>`;
    chatMessages.appendChild(errorEl);
  }
  
  // 滚动到底部
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 格式化 AI 消息（支持 Markdown）
function formatAIMessage(content) {
  if (!content) return '';
  
  // 简单的 Markdown 转换
  let formatted = content
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
  
  return formatted;
}

// 清除 AI 上下文（保留欢迎消息，清空历史记录）
function clearAiContext() {
  aiChatHistory = [];
  const chatMessages = document.getElementById('aiChatMessages');
  if (chatMessages) {
    // 保留欢迎消息，移除其他消息
    const welcomeMsg = chatMessages.querySelector('.ai-welcome-message');
    chatMessages.innerHTML = '';
    if (welcomeMsg) {
      chatMessages.appendChild(welcomeMsg);
    }
  }
  showToast('已清除 AI 上下文');
}

// 新建 AI 会话（完全重置，包括欢迎消息）
function clearAiChat() {
  aiChatHistory = [];
  const chatMessages = document.getElementById('aiChatMessages');
  if (chatMessages) {
    // 重置为初始欢迎消息
    chatMessages.innerHTML = `
      <div class="ai-welcome-message">
        <div class="ai-welcome-icon">👋</div>
        <div class="ai-welcome-text">
          <p>你好！我是 AI 助手，可以帮助你：</p>
          <ul>
            <li>分析当前会话内容</li>
            <li>解释代码和工具调用</li>
            <li>回答技术问题</li>
            <li>提供建议和优化方案</li>
          </ul>
          <p style="color: var(--text-muted); font-size: 12px; margin-top: 12px;">请先在设置中配置 API Key 以启用 AI 功能</p>
        </div>
      </div>
    `;
  }
  // 清空输入框
  const input = document.getElementById('aiChatInput');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  showToast('已创建新的 AI 会话');
}

// 快速操作处理
function handleAiQuickAction(action) {
  if (!currentSession) {
    showToast('请先选择一个会话', 'error');
    return;
  }
  
  switch (action) {
    case 'analyze':
      analyzeCurrentSession();
      break;
    case 'explain':
      sendAiMessage('请解释当前会话中的关键工具调用和它们的作用');
      break;
  }
}

// 分析当前会话
async function analyzeCurrentSession() {
  if (!currentProject || !currentSession) {
    showToast('请先选择一个会话', 'error');
    return;
  }
  
  // 显示分析模态框
  const modal = document.getElementById('analysisModal');
  const loading = document.getElementById('analysisLoading');
  const result = document.getElementById('analysisResult');
  const error = document.getElementById('analysisError');
  const footer = document.getElementById('analysisFooter');
  
  modal.classList.add('active');
  loading.style.display = 'block';
  result.style.display = 'none';
  error.style.display = 'none';
  footer.style.display = 'none';
  
  try {
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject.id,
        sessionId: currentSession.id
      })
    });
    
    const data = await response.json();
    
    loading.style.display = 'none';
    
    if (data.success) {
      renderAnalysisResult(data.analysis);
      result.style.display = 'block';
      footer.style.display = 'flex';
    } else {
      document.getElementById('analysisErrorMsg').textContent = data.error || data.message;
      error.style.display = 'block';
    }
  } catch (err) {
    loading.style.display = 'none';
    document.getElementById('analysisErrorMsg').textContent = err.message;
    error.style.display = 'block';
  }
}

// 渲染分析结果
function renderAnalysisResult(analysis) {
  // 摘要
  document.getElementById('analysisSummary').innerHTML = formatAIMessage(analysis.summary || '暂无摘要');
  
  // 关键决策
  const decisionsEl = document.getElementById('analysisDecisions');
  if (analysis.decisions && analysis.decisions.length > 0) {
    decisionsEl.innerHTML = '<ul>' + analysis.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('') + '</ul>';
  } else {
    decisionsEl.innerHTML = '<p style="color: var(--text-muted);">暂无关键决策</p>';
  }
  
  // 问题解决
  const problemsEl = document.getElementById('analysisProblems');
  if (analysis.problems && analysis.problems.length > 0) {
    problemsEl.innerHTML = '<ul>' + analysis.problems.map(p => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>';
  } else {
    problemsEl.innerHTML = '<p style="color: var(--text-muted);">暂无问题解决记录</p>';
  }
  
  // 效率统计
  const statsEl = document.getElementById('analysisStats');
  const stats = analysis.stats || {};
  const metadata = analysis.metadata || {};
  
  statsEl.innerHTML = `
    <div class="analysis-stat-item">
      <div class="analysis-stat-value">${metadata.messageCount || 0}</div>
      <div class="analysis-stat-label">消息数量</div>
    </div>
    <div class="analysis-stat-item">
      <div class="analysis-stat-value">${formatNumber(metadata.totalTokens || 0)}</div>
      <div class="analysis-stat-label">Token 消耗</div>
    </div>
    <div class="analysis-stat-item">
      <div class="analysis-stat-value">${metadata.toolCallCount || 0}</div>
      <div class="analysis-stat-label">工具调用</div>
    </div>
    <div class="analysis-stat-item">
      <div class="analysis-stat-value">${stats.efficiency || '--'}</div>
      <div class="analysis-stat-label">效率评估</div>
    </div>
  `;
  
  // 建议
  const suggestionsEl = document.getElementById('analysisSuggestions');
  if (analysis.suggestions && analysis.suggestions.length > 0) {
    suggestionsEl.innerHTML = '<ul>' + analysis.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('') + '</ul>';
  } else {
    suggestionsEl.innerHTML = '<p style="color: var(--text-muted);">暂无改进建议</p>';
  }
}

// 导出分析报告
function exportAnalysisReport() {
  const summary = document.getElementById('analysisSummary').innerText;
  const decisions = document.getElementById('analysisDecisions').innerText;
  const problems = document.getElementById('analysisProblems').innerText;
  const stats = document.getElementById('analysisStats').innerText;
  const suggestions = document.getElementById('analysisSuggestions').innerText;
  
  const report = `# 会话分析报告

## 会话摘要
${summary}

## 关键决策
${decisions}

## 问题解决过程
${problems}

## 效率统计
${stats}

## 改进建议
${suggestions}

---
*报告生成时间: ${new Date().toLocaleString('zh-CN')}*
`;
  
  downloadFile(report, `analysis-${currentSession?.id || 'report'}.md`, 'text/markdown');
  showToast('分析报告已导出');
}

// 初始化 AI 功能
function initAIFeatures() {
  // AI 助手按钮
  const aiAssistantBtn = document.getElementById('aiAssistantBtn');
  if (aiAssistantBtn) {
    aiAssistantBtn.addEventListener('click', toggleAiAssistant);
  }
  
  // 关闭 AI 助手面板
  const closeAiAssistantBtn = document.getElementById('closeAiAssistantBtn');
  if (closeAiAssistantBtn) {
    closeAiAssistantBtn.addEventListener('click', () => {
      document.getElementById('aiAssistantPanel').classList.add('hidden');
      document.getElementById('aiAssistantBtn').classList.remove('active');
      isAiPanelOpen = false;
    });
  }
  
  // 新建会话按钮
  const aiNewChatBtn = document.getElementById('aiNewChatBtn');
  if (aiNewChatBtn) {
    aiNewChatBtn.addEventListener('click', clearAiChat);
  }
  
  // 清除上下文按钮
  const aiClearContextBtn = document.getElementById('aiClearContextBtn');
  if (aiClearContextBtn) {
    aiClearContextBtn.addEventListener('click', clearAiContext);
  }
  
  // AI 聊天输入
  const aiChatInput = document.getElementById('aiChatInput');
  const aiSendBtn = document.getElementById('aiSendBtn');
  
  if (aiChatInput && aiSendBtn) {
    // 自动调整高度
    aiChatInput.addEventListener('input', () => {
      aiChatInput.style.height = 'auto';
      aiChatInput.style.height = Math.min(aiChatInput.scrollHeight, 120) + 'px';
    });
    
    // 发送按钮
    aiSendBtn.addEventListener('click', () => {
      const message = aiChatInput.value.trim();
      if (message) {
        sendAiMessage(message);
      }
    });
    
    // Enter 发送，Shift+Enter 换行
    aiChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const message = aiChatInput.value.trim();
        if (message) {
          sendAiMessage(message);
        }
      }
    });
  }
  
  // 快速操作按钮
  document.querySelectorAll('.ai-quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      handleAiQuickAction(action);
    });
  });
  
  // 分析会话按钮
  const analyzeSessionBtn = document.getElementById('analyzeSessionBtn');
  if (analyzeSessionBtn) {
    analyzeSessionBtn.addEventListener('click', analyzeCurrentSession);
  }
  
  // 关闭分析模态框
  const closeAnalysisBtn = document.getElementById('closeAnalysisBtn');
  if (closeAnalysisBtn) {
    closeAnalysisBtn.addEventListener('click', () => {
      document.getElementById('analysisModal').classList.remove('active');
    });
  }
  
  // 重新分析按钮
  const reanalyzeBtn = document.getElementById('reanalyzeBtn');
  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener('click', analyzeCurrentSession);
  }
  
  // 导出分析报告按钮
  const exportAnalysisBtn = document.getElementById('exportAnalysisBtn');
  if (exportAnalysisBtn) {
    exportAnalysisBtn.addEventListener('click', exportAnalysisReport);
  }
  
  // 点击模态框外部关闭
  const analysisModal = document.getElementById('analysisModal');
  if (analysisModal) {
    analysisModal.addEventListener('click', (e) => {
      if (e.target === analysisModal) {
        analysisModal.classList.remove('active');
      }
    });
  }
  
  // AI 设置相关
  const testApiConnectionBtn = document.getElementById('testApiConnectionBtn');
  if (testApiConnectionBtn) {
    testApiConnectionBtn.addEventListener('click', testAPIConnection);
  }
  
  console.log('iflow-run v1.3.0 P1 AI features initialized');
}

// 测试 API 连接
async function testAPIConnection() {
  const provider = document.getElementById('settingAiProvider').value;
  const apiKey = document.getElementById('settingApiKey').value;
  const model = document.getElementById('settingAiModel').value;
  
  if (!apiKey) {
    showToast('请输入 API Key', 'error');
    return;
  }
  
  const statusEl = document.getElementById('apiConnectionStatus');
  statusEl.style.display = 'block';
  statusEl.className = '';
  statusEl.textContent = '测试连接中...';
  
  try {
    // 先保存配置
    await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey, model, enabled: true })
    });
    
    // 测试连接
    const response = await fetch('/api/ai/test', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      statusEl.className = 'success';
      statusEl.textContent = '✓ ' + result.message;
    } else {
      statusEl.className = 'error';
      statusEl.textContent = '✗ ' + (result.error || result.message);
    }
  } catch (error) {
    statusEl.className = 'error';
    statusEl.textContent = '✗ 连接失败: ' + error.message;
  }
}

// 修改保存设置函数以支持 AI 配置
const originalSaveSettings = saveSettings;
function saveSettingsWithAI() {
  const themeSelect = document.getElementById('settingTheme');
  const pageSizeSelect = document.getElementById('settingPageSize');
  const defaultFilterSelect = document.getElementById('settingDefaultFilter');
  const autoRefreshCheck = document.getElementById('settingAutoRefresh');
  const showToolStatsCheck = document.getElementById('settingShowToolStats');
  
  // AI 设置
  const aiProvider = document.getElementById('settingAiProvider');
  const apiKey = document.getElementById('settingApiKey');
  const aiModel = document.getElementById('settingAiModel');
  const enableAiAssistant = document.getElementById('settingEnableAiAssistant');
  
  const settings = {
    theme: themeSelect?.value || 'dark',
    pageSize: parseInt(pageSizeSelect?.value || '20'),
    defaultMessageFilter: defaultFilterSelect?.value || 'all',
    autoRefresh: autoRefreshCheck?.checked !== false,
    showToolStats: showToolStatsCheck?.checked !== false,
    ai: {
      provider: aiProvider?.value || 'iflow',
      apiKey: apiKey?.value || '',
      model: aiModel?.value || 'iflow-rome-30ba3b',
      enabled: enableAiAssistant?.checked || false
    }
  };
  
  saveUserSettings(settings);
  
  // 保存到后端
  if (settings.ai.apiKey) {
    fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.ai)
    });
  }
  
  // 应用主题
  if (settings.theme === 'light') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  
  showToast('设置已保存');
  closeSettingsModal();
}

// 加载 AI 设置到设置面板
function loadAISettings() {
  const settings = getUserSettings();
  const aiSettings = settings.ai || {};
  
  const aiProvider = document.getElementById('settingAiProvider');
  const apiKey = document.getElementById('settingApiKey');
  const aiModel = document.getElementById('settingAiModel');
  const enableAiAssistant = document.getElementById('settingEnableAiAssistant');
  
  if (aiProvider) aiProvider.value = aiSettings.provider || 'iflow';
  if (apiKey) apiKey.value = aiSettings.apiKey || '';
  if (aiModel) aiModel.value = aiSettings.model || 'iflow-rome-30ba3b';
  if (enableAiAssistant) enableAiAssistant.checked = aiSettings.enabled || false;
}

// 覆盖原始的 showSettingsModal 函数
const originalShowSettingsModal = showSettingsModal;
window.showSettingsModal = function() {
  originalShowSettingsModal();
  loadAISettings();
};

// 覆盖原始的 saveSettings 函数
window.saveSettings = saveSettingsWithAI;