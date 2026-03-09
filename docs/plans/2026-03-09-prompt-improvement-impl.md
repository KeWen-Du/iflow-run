# 提问改进建议功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 AI 会话分析报告中新增"提问改进建议"模块，帮助用户学习如何更好地与 AI 交互。

**Architecture:** 修改后端 AI 分析 prompt，请求返回 `promptImprovements` 字段；前端在分析结果中渲染该字段，展示用户原始提问与改进后的提问对比。

**Tech Stack:** Node.js/Express (后端), 纯 JS (前端), 现有 AI API 集成

---

## Task 1: 修改后端 AI 分析 Prompt

**Files:**
- Modify: `server.ts:1639-1675` (AI 分析 prompt 部分)

**Step 1: 更新 prompt 请求提问改进建议**

在现有的 prompt 中增加对 `promptImprovements` 字段的请求，并提取用户消息供 AI 分析。

修改 `server.ts` 中 `analysisPrompt` 的构建逻辑：

```typescript
// 在构建 analysisPrompt 之前，提取用户消息
const userMessages: Array<{ index: number; content: string }> = [];
for (let i = 0; i < messages.length; i++) {
  const msg = messages[i];
  if (msg.type === 'user') {
    const content = extractContent(msg);
    if (content) {
      userMessages.push({ index: i + 1, content: content.substring(0, 300) });
    }
  }
}

// 修改 analysisPrompt，增加 promptImprovements 请求
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
${userMessages.map((m, i) => `${i + 1}. ${m.content}`).join('\n') || '无用户提问'}

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
      "original": "用户原始提问（截取前100字）",
      "improved": "改进后的提问示例",
      "reason": "改进理由（简短说明为什么这样改更好）"
    }
  ]
}

注意：promptImprovements 只针对可以明显改进的提问，如果提问已经很清晰则不需要改进。最多返回 3 条改进建议。

只返回 JSON，不要包含其他内容。`;
```

**Step 2: 构建并验证**

Run: `npm run build:server`
Expected: 编译成功，无错误

---

## Task 2: 添加前端 HTML 结构

**Files:**
- Modify: `public/index.html:495-500` (建议 section 之后)

**Step 1: 在分析模态框中添加提问改进建议 section**

在 `analysisSuggestions` section 之后，添加新的 section：

```html
        <!-- 提问改进建议 -->
        <div class="analysis-section" id="promptImprovementsSection" style="display: none;">
          <h3 class="analysis-section-title">💡 提问改进建议</h3>
          <div id="analysisPromptImprovements" class="analysis-content"></div>
        </div>
```

**Step 2: 验证 HTML 语法**

检查 HTML 文件是否正确闭合，无语法错误。

---

## Task 3: 添加前端渲染逻辑

**Files:**
- Modify: `public/app.js:2728-2770` (`renderAnalysisResult` 函数)

**Step 1: 在 renderAnalysisResult 函数中添加提问改进建议的渲染逻辑**

在 `renderAnalysisResult` 函数末尾（suggestions 渲染之后）添加：

```javascript
// 提问改进建议
const improvementsEl = document.getElementById('analysisPromptImprovements');
const improvementsSection = document.getElementById('promptImprovementsSection');

if (analysis.promptImprovements && analysis.promptImprovements.length > 0) {
  improvementsSection.style.display = 'block';
  improvementsEl.innerHTML = analysis.promptImprovements.map((item, index) => `
    <div class="prompt-improvement-item">
      <div class="prompt-improvement-header">
        <span class="prompt-improvement-index">#${index + 1}</span>
      </div>
      <div class="prompt-improvement-comparison">
        <div class="prompt-improvement-original">
          <div class="prompt-improvement-label">当前提问</div>
          <div class="prompt-improvement-text">${escapeHtml(item.original)}</div>
        </div>
        <div class="prompt-improvement-arrow">→</div>
        <div class="prompt-improvement-improved">
          <div class="prompt-improvement-label">改进建议</div>
          <div class="prompt-improvement-text">${escapeHtml(item.improved)}</div>
        </div>
      </div>
      <div class="prompt-improvement-reason">
        <strong>理由：</strong>${escapeHtml(item.reason)}
      </div>
    </div>
  `).join('');
} else {
  improvementsSection.style.display = 'none';
}
```

---

## Task 4: 添加 CSS 样式

**Files:**
- Modify: `public/styles.css` (文件末尾)

**Step 1: 添加提问改进建议样式**

在 `styles.css` 文件末尾添加：

```css
/* 提问改进建议样式 */
.prompt-improvement-item {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  border-left: 3px solid var(--accent-primary);
}

.prompt-improvement-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.prompt-improvement-index {
  font-weight: 600;
  color: var(--accent-primary);
  font-size: 14px;
}

.prompt-improvement-comparison {
  display: flex;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 12px;
}

.prompt-improvement-original,
.prompt-improvement-improved {
  flex: 1;
  padding: 12px;
  border-radius: 6px;
}

.prompt-improvement-original {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.prompt-improvement-improved {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.prompt-improvement-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  opacity: 0.7;
}

.prompt-improvement-original .prompt-improvement-label {
  color: #ef4444;
}

.prompt-improvement-improved .prompt-improvement-label {
  color: #22c55e;
}

.prompt-improvement-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}

.prompt-improvement-arrow {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  font-size: 18px;
}

.prompt-improvement-reason {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

@media (max-width: 768px) {
  .prompt-improvement-comparison {
    flex-direction: column;
  }
  
  .prompt-improvement-arrow {
    transform: rotate(90deg);
    justify-content: center;
  }
}
```

---

## Task 5: 构建并测试

**Step 1: 构建项目**

Run: `npm run build`
Expected: 编译成功，无错误

**Step 2: 启动服务并手动测试**

Run: `npm start`

测试步骤：
1. 打开浏览器访问 http://localhost:3000
2. 选择一个项目和一个会话
3. 点击"分析"按钮
4. 验证分析报告中显示"提问改进建议"部分
5. 验证改进建议格式正确、内容有意义

**Step 3: 提交代码**

```bash
git add server.ts public/index.html public/app.js public/styles.css
git commit -m "feat: add prompt improvement suggestions to AI analysis report"
```

---

## 验收标准

1. ✅ AI 分析报告中显示"提问改进建议"部分
2. ✅ 针对可改进的用户提问生成改进建议
3. ✅ 原始提问和改进建议并排对比显示
4. ✅ 显示改进理由
5. ✅ 移动端响应式布局正常
