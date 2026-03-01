/**
 * iflow-run 增强功能模块
 * 包含：Markdown 代码高亮、键盘快捷键、WebSocket 实时更新、分页加载
 */

// ==================== Markdown 代码高亮 ====================

class MarkdownRenderer {
  constructor() {
    this.marked = window.marked;
    this.hljs = window.hljs;
    this.init();
  }

  init() {
    // 配置 marked
    this.marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: (code: string, lang: string) => {
        if (lang && this.hljs.getLanguage(lang)) {
          try {
            return this.hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('Highlight.js error:', err);
          }
        }
        return this.hljs.highlightAuto(code).value;
      }
    });
  }

  render(markdown) {
    try {
      return this.marked.parse(markdown);
    } catch (err) {
      console.error('Markdown rendering error:', err);
      return this.escapeHtml(markdown);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 检测是否是 Markdown 格式
  isMarkdown(text) {
    if (!text) return false;
    const markdownPatterns = [
      /^#{1,6}\s/m,           // 标题
      /\*\*.*?\*\*/,          // 粗体
      /\*.*?\*/,              // 斜体
      /`{3}[\s\S]*?`{3}/,    // 代码块
      /`.*?`/,                // 行内代码
      /^\s*[-*+]\s/m,         // 无序列表
      /^\s*\d+\.\s/m,         // 有序列表
      /\[.*?\]\(.*?\)/,       // 链接
      /^\s*>\s/m,             // 引用
      /\|.*\|/                // 表格
    ];
    return markdownPatterns.some(pattern => pattern.test(text));
  }
}

// 全局 Markdown 渲染器实例
const markdownRenderer = new MarkdownRenderer();

// ==================== 键盘快捷键 ====================

class KeyboardShortcuts {
  constructor() {
    this.shortcuts = new Map();
    this.init();
  }

  init() {
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  register(key, callback, description) {
    this.shortcuts.set(key, { callback, description });
  }

  handleKeyDown(e) {
    // 忽略在输入框中的按键
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    const key = this.buildKeyString(e);
    const shortcut = this.shortcuts.get(key);

    if (shortcut) {
      e.preventDefault();
      shortcut.callback();
    }
  }

  buildKeyString(e) {
    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(e.key.toUpperCase());
    return parts.join('+');
  }

  getShortcutsList() {
    return Array.from(this.shortcuts.entries()).map(([key, value]) => ({
      key,
      description: value.description
    }));
  }
}

// 全局键盘快捷键实例
const keyboardShortcuts = new KeyboardShortcuts();

// ==================== WebSocket 实时更新 ====================

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.listeners = new Map();
  }

  connect(url) {
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit('message', data);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.emit('disconnected');
        this.reconnect();
      };
    } catch (err) {
      console.error('WebSocket connection error:', err);
    }
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`);
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// 全局 WebSocket 管理器实例
const wsManager = new WebSocketManager();

// ==================== 分页加载 ====================

class PaginationManager {
  constructor() {
    this.currentPage = 1;
    this.pageSize = 20;
    this.totalItems = 0;
    this.totalPages = 1;
    this.isLoading = false;
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  setPageSize(size: number) {
    this.pageSize = size;
    this.currentPage = 1;
  }

  updatePagination(total: number) {
    this.totalItems = total;
    this.totalPages = Math.ceil(total / this.pageSize);
    this.currentPage = Math.min(this.currentPage, this.totalPages) || 1;
  }

  getPaginationInfo() {
    return {
      currentPage: this.currentPage,
      pageSize: this.pageSize,
      totalItems: this.totalItems,
      totalPages: this.totalPages,
      hasNext: this.currentPage < this.totalPages,
      hasPrev: this.currentPage > 1
    };
  }
}

// 全局分页管理器实例
const paginationManager = new PaginationManager();

// ==================== 初始化增强功能 ====================

function initEnhancements() {
  // 初始化键盘快捷键
  setupKeyboardShortcuts();

  // 初始化 WebSocket
  setupWebSocket();

  // 初始化分页
  setupPagination();

  console.log('iflow-run 增强功能已加载');
}

// 设置键盘快捷键
function setupKeyboardShortcuts() {
  // Ctrl/Cmd + K: 快速搜索
  keyboardShortcuts.register('Ctrl+K', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.focus();
    }
  }, '快速搜索');

  // Ctrl/Cmd + F: 在当前会话中搜索
  keyboardShortcuts.register('Ctrl+F', () => {
    const messageSearchInput = document.getElementById('messageSearchInput');
    if (messageSearchInput) {
      messageSearchInput.focus();
    }
  }, '搜索消息');

  // Ctrl/Cmd + R: 刷新
  keyboardShortcuts.register('Ctrl+R', () => {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.click();
    }
  }, '刷新');

  // Ctrl/Cmd + E: 导出当前会话
  keyboardShortcuts.register('Ctrl+E', () => {
    const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
    if (exportMarkdownBtn) {
      exportMarkdownBtn.click();
    }
  }, '导出为 Markdown');

  // Ctrl/Cmd + Shift + E: 导出为 JSON
  keyboardShortcuts.register('Ctrl+Shift+E', () => {
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.click();
    }
  }, '导出为 JSON');

  // Esc: 关闭模态框/面板
  keyboardShortcuts.register('Escape', () => {
    // 关闭统计面板
    const statsModal = document.getElementById('statsModal');
    if (statsModal && statsModal.classList.contains('active')) {
      statsModal.classList.remove('active');
      return;
    }

    // 关闭消息目录
    const messageIndexPanel = document.getElementById('messageIndexPanel');
    if (messageIndexPanel && !messageIndexPanel.classList.contains('hidden')) {
      messageIndexPanel.classList.add('hidden');
      return;
    }

    // 返回会话列表
    const backBtn = document.getElementById('backBtn');
    const sessionDetail = document.getElementById('sessionDetail');
    if (backBtn && sessionDetail && !sessionDetail.classList.contains('hidden')) {
      backBtn.click();
    }
  }, '关闭面板/返回');

  // Ctrl/Cmd + B: 切换侧边栏
  keyboardShortcuts.register('Ctrl+B', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('hidden');
    }
  }, '切换侧边栏');

  // Ctrl/Cmd + T: 切换主题
  keyboardShortcuts.register('Ctrl+T', () => {
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      themeBtn.click();
    }
  }, '切换主题');

  // Ctrl/Cmd + S: 显示快捷键帮助
  keyboardShortcuts.register('Ctrl+S', () => {
    showShortcutsHelp();
  }, '显示快捷键帮助');

  console.log('键盘快捷键已设置');
}

// 设置 WebSocket
function setupWebSocket() {
  wsManager.connect();

  // 监听会话更新
  wsManager.on('message', (data) => {
    if (data.type === 'session_update') {
      console.log('检测到会话更新');
      // 显示通知
      showToast('会话已更新', 'info');
      // 刷新项目列表
      if (typeof loadProjects === 'function') {
        loadProjects();
      }
    }
  });

  // 监听连接状态
  wsManager.on('connected', () => {
    showToast('实时连接已建立', 'success');
    updateWsStatus(true);
  });

  wsManager.on('disconnected', () => {
    showToast('实时连接已断开', 'error');
    updateWsStatus(false);
  });
}

// 更新 WebSocket 状态显示
function updateWsStatus(connected: boolean) {
  const wsStatus = document.getElementById('wsStatus');
  const wsStatusIndicator = document.getElementById('wsStatusIndicator');
  const wsStatusText = document.getElementById('wsStatusText');

  if (wsStatus && wsStatusIndicator && wsStatusText) {
    wsStatus.style.display = 'flex';
    wsStatusIndicator.className = `ws-status-indicator ${connected ? 'connected' : 'disconnected'}`;
    wsStatusText.textContent = connected ? '实时连接' : '连接断开';
  }
}

// 设置分页
function setupPagination() {
  // 这个函数将在 loadProjects 中被调用
  console.log('分页管理器已初始化');
}

// 显示快捷键帮助
function showShortcutsHelp() {
  const shortcuts = keyboardShortcuts.getShortcutsList();
  
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>键盘快捷键</h2>
        <button class="btn btn-icon" onclick="this.closest('.modal').remove()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="shortcuts-list">
          ${shortcuts.map(s => `
            <div class="shortcut-item">
              <kbd class="shortcut-key">${s.key}</kbd>
              <span class="shortcut-desc">${s.description}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// ==================== 工具函数 ====================

// 显示 Toast 通知（如果已存在则使用现有的）
function showToast(message, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
  } else {
    // 降级实现
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
}

// ==================== 导出全局变量 ====================

window.markdownRenderer = markdownRenderer;
window.keyboardShortcuts = keyboardShortcuts;
window.wsManager = wsManager;
window.paginationManager = paginationManager;

// ==================== DOM 加载完成后初始化 ====================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEnhancements);
} else {
  initEnhancements();
}