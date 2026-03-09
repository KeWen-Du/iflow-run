# 对比参考功能设计

> 版本: 1.0  
> 日期: 2026-03-09  
> 状态: 已批准

## 概述

为 iflow-run 的 AI 会话分析功能新增"提问改进建议"模块，帮助用户提升与 AI 的交互质量。

## 功能描述

在现有的 AI 会话分析报告中，新增一个 **"提问改进建议"** 部分，针对用户消息生成：

1. **当前提问** - 用户原始消息
2. **改进建议** - AI 生成的更好提问方式
3. **改进理由** - 为什么这样改更好

## 实现方案

### 整合到现有 AI 分析接口

复用 `/api/ai/analyze` 接口，在 prompt 中增加对"提问改进建议"的要求。

### 前端变更

在会话分析报告模态框中新增一个 section：

```html
<!-- 提问改进建议 -->
<div class="analysis-section">
  <h3 class="analysis-section-title">💡 提问改进建议</h3>
  <div id="analysisPromptImprovements" class="analysis-content"></div>
</div>
```

### 后端变更

修改 AI 分析的 prompt，增加对用户提问质量的分析要求。

### 响应结构

```json
{
  "promptImprovements": [
    {
      "originalMessage": "用户原始消息",
      "improvedMessage": "改进后的消息示例",
      "reason": "改进理由"
    }
  ]
}
```

## 文件变更

| 文件 | 变更类型 | 描述 |
|------|----------|------|
| `server.ts` | 修改 | 更新 AI 分析 prompt |
| `public/app.js` | 修改 | 渲染提问改进建议 |
| `public/index.html` | 修改 | 添加 HTML 结构 |
| `public/styles.css` | 修改 | 添加样式 |

## 预估工作量

- 后端: ~30 行代码修改
- 前端: ~50 行代码修改
- 样式: ~20 行代码修改

总计: ~100 行代码变更

## 成功标准

1. AI 分析报告中显示"提问改进建议"部分
2. 针对每条用户消息生成改进建议
3. 建议内容有帮助、不空洞
