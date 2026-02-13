# HaoMD Skills 插件系统方案

## 一、设计理念

**HaoMD Skills** 是一个受 Claude Skills 启发的插件系统，核心原则：

1. **零配置**：放入技能文件夹即自动加载
2. **纯 JavaScript**：无需编译，直接运行
3. **自动 UI 生成**：根据配置自动生成表单
4. **AI 原生集成**：插件与 AI Chat 无缝对接
5. **文件操作简化**：自动处理保存对话框

### 关键特性

✅ 每个技能一个文件夹
✅ skill.js + README.md 即可
✅ 动态生成表单界面
✅ AI 自动调用技能函数
✅ 自动生成保存对话框
✅ 无需编译配置

---

## 二、技能文件结构

```
~/.haomd/skills/                    # 用户技能目录
├── article-generator/
│   ├── skill.js                    # 技能主文件（必须）
│   └── README.md                   # 技能描述（必须）
├── code-review/
│   ├── skill.js
│   └── README.md
└── blog-writer/
    ├── skill.js
    └── README.md
```

**文件命名规范：**
- 技能文件必须命名为 `skill.js`
- 文档必须命名为 `README.md`
- 文件夹名称即为技能 ID

---

## 三、技能接口定义

### 3.1 skill.js 格式

```javascript
// ~/.haomd/skills/article-generator/skill.js

/**
 * 技能元数据
 */
const metadata = {
  id: 'article-generator',           // 技能 ID（与文件夹名一致）
  name: '文章生成器',                 // 显示名称
  description: '根据主题生成技术文章', // 简短描述
  version: '1.0.0',                 // 版本号
  author: 'Your Name',              // 作者（可选）
  icon: '📄'                        // Emoji 图标（可选）
}

/**
 * 表单配置 - 定义用户输入界面
 */
const form = [
  {
    name: 'topic',                   // 字段名
    label: '文章主题',               // 显示标签
    type: 'text',                   // 字段类型：text/textarea/number/select/checkbox
    placeholder: '例如：如何学习 TypeScript',
    required: true                   // 是否必填
  },
  {
    name: 'sections',
    label: '章节数量',
    type: 'number',
    default: 3,                      // 默认值
    min: 1,
    max: 10
  },
  {
    name: 'tone',
    label: '文章风格',
    type: 'select',
    default: 'technical',
    options: [
      { value: 'technical', label: '技术风格' },
      { value: 'formal', label: '正式风格' },
      { value: 'casual', label: '随意风格' }
    ]
  },
  {
    name: 'includeCode',
    label: '包含代码示例',
    type: 'checkbox',
    default: true
  }
]

/**
 * 构建 AI 提示词
 * @param {Object} userInput - 用户填写的表单数据
 * @returns {string} AI 提示词
 */
function buildPrompt(userInput) {
  const { topic, sections, tone, includeCode } = userInput
  
  const toneMap = {
    technical: '技术专业',
    formal: '正式严谨',
    casual: '轻松随意'
  }
  
  let prompt = `请写一篇关于"${topic}"的文章，包含${sections}个章节，风格为${toneMap[tone]}。`
  
  if (includeCode) {
    prompt += ' 请在适当位置包含代码示例。'
  }
  
  return prompt
}

/**
 * 执行技能 - 处理 AI 响应
 * @param {string} aiResponse - AI 返回的响应
 * @param {Object} context - 执行上下文
 * @param {Function} context.saveFile - 显示保存对话框
 * @param {Function} context.writeFile - 写入文件
 * @param {Function} context.readFile - 读取文件
 * @param {Function} context.sendAI - 发送消息到 AI
 * @param {Object} context.userInput - 用户输入
 * @param {string} context.currentContent - 当前编辑器内容
 * @param {string} context.currentFilePath - 当前文件路径
 * @returns {Promise<Object>} 执行结果
 */
async function execute(aiResponse, context) {
  try {
    // 1. 处理 AI 响应
    const content = aiResponse
    
    // 2. 生成默认文件名
    const { topic } = context.userInput
    const defaultName = `${topic}.md`
    
    // 3. 显示保存对话框
    const filePath = await context.saveFile({
      defaultName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    })
    
    // 4. 如果用户选择了路径，保存文件
    if (filePath) {
      await context.writeFile(filePath, content)
      
      return {
        success: true,
        message: `文章已保存到：${filePath}`,
        savedPath: filePath
      }
    }
    
    // 5. 用户取消保存
    return {
      success: false,
      message: '用户取消了保存'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || '执行失败'
    }
  }
}

// 导出技能对象
export default {
  metadata,
  form,
  buildPrompt,
  execute
}
```

### 3.2 README.md 格式

```markdown
---
id: article-generator
name: 文章生成器
description: 根据主题生成结构化的技术文章
version: 1.0.0
author: Your Name
icon: 📄
---

# 文章生成器

根据用户输入的主题自动生成结构化的技术文章。

## 功能

- 根据主题生成文章
- 支持自定义章节数量
- 可选择文章风格
- 可选择是否包含代码示例
- 自动保存到指定位置

## 使用方法

1. 在菜单中选择「技能」→「文章生成器」
2. 填写表单：
   - 文章主题（必填）
   - 章节数量（默认 3）
   - 文章风格（技术/正式/随意）
   - 是否包含代码示例（默认是）
3. 点击「执行」
4. AI 生成文章后，选择保存位置
5. 自动保存为 Markdown 文件

## 示例

**输入：**
- 主题：如何学习 TypeScript
- 章节数量：3
- 风格：技术风格
- 包含代码：是

**输出：**
一篇包含 3 个章节的技术风格文章，包含代码示例。
```

---

## 四、核心实现

### 4.1 技能加载器

```typescript
// app/src/skills/loader.ts

import { readDir, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { join, appDataDir } from '@tauri-apps/api/path'

const SKILLS_DIR = 'skills'

/**
 * 从 README.md frontmatter 解析元数据
 */
async function parseMetadata(readmePath: string) {
  try {
    const content = await readTextFile(readmePath)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    
    if (!frontmatterMatch) {
      throw new Error('No frontmatter found in README.md')
    }
    
    const metadata: Record<string, string> = {}
    const lines = frontmatterMatch[1].split('\n')
    
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/)
      if (match) {
        const [, key, value] = match
        metadata[key] = value.replace(/^['"]|['"]$/g, '')
      }
    }
    
    return metadata
  } catch (error) {
    console.error('Failed to parse metadata:', error)
    return null
  }
}

/**
 * 验证技能对象
 */
function isValidSkill(skill: any): boolean {
  return (
    skill &&
    typeof skill === 'object' &&
    skill.metadata &&
    typeof skill.buildPrompt === 'function' &&
    typeof skill.execute === 'function' &&
    Array.isArray(skill.form)
  )
}

/**
 * 加载所有技能
 */
export async function loadSkills(): Promise<any[]> {
  try {
    const appDir = await appDataDir()
    const skillsPath = await join(appDir, SKILLS_DIR)
    
    // 检查技能目录是否存在
    const dirExists = await exists(skillsPath)
    if (!dirExists) {
      return []
    }
    
    // 扫描技能目录
    const entries = await readDir(skillsPath)
    
    const skills: any[] = []
    
    for (const entry of entries) {
      // 只处理目录
      if (!entry.children) {
        continue
      }
      
      try {
        // 1. 检查 skill.js 和 README.md 是否存在
        const skillPath = await join(skillsPath, entry.name, 'skill.js')
        const readmePath = await join(skillsPath, entry.name, 'README.md')
        
        // 2. 读取 README.md 元数据
        const metadata = await parseMetadata(readmePath)
        if (!metadata) {
          console.warn(`No metadata found in ${readmePath}`)
          continue
        }
        
        // 3. 动态导入技能
        const module = await import(/* @vite-ignore */ `file://${skillPath}`)
        const skill = module.default
        
        // 4. 验证技能结构
        if (isValidSkill(skill)) {
          // 合并 README 中的元数据
          skill.metadata = { ...skill.metadata, ...metadata }
          skills.push(skill)
        } else {
          console.warn(`Invalid skill: ${entry.name}`)
        }
      } catch (error) {
        console.error(`Failed to load skill: ${entry.name}`, error)
      }
    }
    
    return skills
  } catch (error) {
    console.error('Failed to load skills:', error)
    return []
  }
}
```

### 4.2 技能服务

```typescript
// app/src/services/skillService.ts

import { save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

/**
 * 显示保存对话框
 */
export async function saveFile(options: { 
  defaultName: string
  filters?: Array<{ name: string, extensions: string[] }>
}): Promise<string | null> {
  try {
    const filePath = await save({
      defaultPath: options.defaultName,
      filters: options.filters
    })
    return filePath
  } catch (error) {
    console.error('Failed to save file:', error)
    return null
  }
}

/**
 * 写入文件
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

/**
 * 读取文件
 */
export async function readFile(path: string): Promise<string> {
  return await readTextFile(path)
}

/**
 * 发送消息到 AI Chat
 */
export async function sendAI(prompt: string): Promise<string> {
  const { openAiChatDialog } = await import('../hooks/useAISession')
  return await openAiChatDialog({ 
    entryMode: 'chat',
    initialMessage: prompt
  })
}
```

---

## 五、技能示例

### 5.1 文章生成器

```javascript
// ~/.haomd/skills/article-generator/skill.js

const metadata = {
  id: 'article-generator',
  name: '文章生成器',
  description: '根据主题生成结构化的技术文章',
  version: '1.0.0',
  icon: '📄'
}

const form = [
  {
    name: 'topic',
    label: '文章主题',
    type: 'text',
    placeholder: '例如：如何学习 TypeScript',
    required: true
  },
  {
    name: 'sections',
    label: '章节数量',
    type: 'number',
    default: 3,
    min: 1,
    max: 10
  },
  {
    name: 'tone',
    label: '文章风格',
    type: 'select',
    default: 'technical',
    options: [
      { value: 'technical', label: '技术风格' },
      { value: 'formal', label: '正式风格' },
      { value: 'casual', label: '随意风格' }
    ]
  }
]

function buildPrompt(userInput) {
  const { topic, sections, tone } = userInput
  return `请写一篇关于"${topic}"的文章，包含${sections}个章节，风格为${tone}。`
}

async function execute(aiResponse, context) {
  const { topic } = context.userInput
  const filePath = await context.saveFile({
    defaultName: `${topic}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  
  if (filePath) {
    await context.writeFile(filePath, aiResponse)
    return { success: true, message: `已保存到：${filePath}` }
  }
  
  return { success: false, message: '用户取消' }
}

export default { metadata, form, buildPrompt, execute }
```

### 5.2 代码审查

```javascript
// ~/.haomd/skills/code-review/skill.js

const metadata = {
  id: 'code-review',
  name: '代码审查',
  description: '审查当前代码，提供改进建议',
  version: '1.0.0',
  icon: '🔍'
}

const form = [
  {
    name: 'focus',
    label: '审查重点',
    type: 'select',
    default: 'all',
    options: [
      { value: 'all', label: '全面审查' },
      { value: 'performance', label: '性能' },
      { value: 'security', label: '安全性' },
      { value: 'readability', label: '可读性' }
    ]
  },
  {
    name: 'detailed',
    label: '详细模式',
    type: 'checkbox',
    default: false
  }
]

function buildPrompt(userInput) {
  const { focus, detailed } = userInput
  const detailText = detailed ? '详细' : '简洁'
  return `请${detailText}审查以下代码，重点关注${focus}：\n\n${context.currentContent || ''}`
}

async function execute(aiResponse, context) {
  // 代码审查结果直接在 AI Chat 中显示
  return { success: true, message: '审查完成' }
}

export default { metadata, form, buildPrompt, execute }
```

---

## 六、实施步骤

### Phase 1: MVP（1-2 周）

**Week 1: 基础设施**
- [ ] 创建技能加载器 (`loader.ts`)
- [ ] 创建技能服务 (`skillService.ts`)
- [ ] 创建技能注册表 (`registry.ts`)
- [ ] 创建表单字段类型定义

**Week 2: UI 和集成**
- [ ] 创建 SkillModal 组件
- [ ] 创建 SkillMenu 组件
- [ ] 实现动态表单渲染
- [ ] 集成到主菜单
- [ ] 编写 2-3 个示例技能

### Phase 2: 增强（1-2 周）

- [ ] 支持更多表单类型（radio, file）
- [ ] 添加表单验证
- [ ] 添加技能图标支持
- [ ] 优化错误提示
- [ ] 添加技能文档链接

### Phase 3: 完善（持续）

- [ ] 技能热重载
- [ ] 技能管理界面（启用/禁用）
- [ ] 技能市场 UI
- [ ] 技能开发文档

---

## 七、编译后可用性

### 纯 JavaScript 优势

使用纯 JavaScript 编写技能的优势：

✅ **无需编译**：技能代码直接运行
✅ **动态加载**：使用 `import()` 直接加载
✅ **简单部署**：复制文件夹即可
✅ **跨平台**：JavaScript 跨平台兼容

### 加载方式

```typescript
// 编译后仍然可以使用动态导入
const skillPath = `file://${skillsPath}/${skillName}/skill.js`
const module = await import(/* @vite-ignore */ skillPath)
const skill = module.default
```

**关键点：**
- 使用 `@vite-ignore` 注释避免 Vite 处理
- 使用 `file://` 协议加载本地文件
- Tauri 的 `plugin-fs` 提供文件系统访问

---

## 八、总结

### 核心优势

1. **极简设计**：skill.js + README.md 即可
2. **纯 JavaScript**：无需编译，零配置
3. **自动 UI**：表单配置自动生成界面
4. **AI 原生**：与 AI Chat 无缝集成
5. **编译可用**：打包后仍然动态加载

### 与 Claude Skills 的对比

| 特性 | Claude Skills | HaoMD Skills |
|------|--------------|--------------|
| 文件格式 | .md + JavaScript | skill.js + README.md |
| UI 生成 | ✅ 自动 | ✅ 自动 |
| AI 集成 | ✅ 原生 | ✅ 原生 |
| 语言 | TypeScript | JavaScript |
| 编译 | 需要编译 | 无需编译 |
| 部署 | 上传平台 | 复制文件夹 |

### 技术栈

- **前端**: React + TypeScript
- **桌面**: Tauri 2.0
- **技能语言**: JavaScript (ES2020+)
- **文件系统**: Tauri `plugin-fs`
- **状态管理**: Zustand

### 下一步

1. 实现 MVP 基础设施
2. 创建示例技能
3. 编写技能开发文档
4. 收集用户反馈
5. 持续迭代优化

---

**文档版本**: 1.0.0  
**最后更新**: 2026-02-09  
**维护者**: HaoMD Team
