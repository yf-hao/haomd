import type { SkillDocument, SkillScript } from '../domain/types'

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `skill-${Date.now()}`
}

export function createDefaultSkill(): SkillDocument {
  const id = `skill-${Date.now()}`
  return {
    id,
    name: 'New Skill',
    description: '一句短摘要',
    enabled: true,
    trusted: false,
    loadPolicy: 'on_demand',
    markdown:
      '# New Skill\n\n' +
      '一句话说明这个 skill 做什么。\n\n' +
      '## 适用场景\n' +
      '- 场景 1\n' +
      '- 场景 2\n\n' +
      '## 使用原则\n' +
      '- 先判断当前任务是否适合这个 skill\n' +
      '- 调用脚本时传结构化参数\n' +
      '- 不要把整句自然语言直接传给脚本\n\n' +
      '## Scripts\n\n' +
      '### run\n' +
      '用途：\n' +
      '- 这个脚本负责什么\n\n' +
      '何时使用：\n' +
      '- 用户在什么情况下应调用它\n\n' +
      '输入参数：\n' +
      '- `input`：这个参数表示什么\n\n' +
      '正确示例：\n\n' +
      '用户输入：\n' +
      '`这里放一个真实例子`\n\n' +
      '应提取参数：\n' +
      '```json\n' +
      '{\n' +
      '  "input": "这里放结构化后的值"\n' +
      '}\n' +
      '```\n\n' +
      '错误示例：\n\n' +
      '不要传：\n' +
      '```json\n' +
      '{\n' +
      '  "text": "这里放整句自然语言"\n' +
      '}\n' +
      '```\n\n' +
      '预期结果：\n' +
      '- 脚本成功执行时，应返回符合该 skill 目标的结果\n' +
      '- 输出内容必须和输入参数保持一致\n',
    scripts: [createDefaultScript(1)],
  }
}

export function createDefaultScript(index: number): SkillScript {
  const id = index <= 1 ? 'run' : `run-${index}`
  return {
    id,
    label: index <= 1 ? 'Run' : `Run ${index}`,
    runtime: 'builtin-js',
    entry: `scripts/${id}.js`,
    approvalPolicy: 'ask',
    argsSchema:
      '{\n' +
      '  "type": "object",\n' +
      '  "properties": {\n' +
      '    "input": {\n' +
      '      "type": "string",\n' +
      '      "description": "脚本需要的结构化输入"\n' +
      '    }\n' +
      '  },\n' +
      '  "required": ["input"]\n' +
      '}',
    content:
      'function run(args) {\n' +
      "  const input = typeof args?.input === 'string' ? args.input.trim() : ''\n" +
      '\n' +
      '  if (!input) {\n' +
      '    return {\n' +
      '      ok: false,\n' +
      "      stdout: '',\n" +
      "      stderr: 'Missing required arg: input',\n" +
      '      exitCode: 1,\n' +
      '    }\n' +
      '  }\n' +
      '\n' +
      '  return {\n' +
      '    ok: true,\n' +
      '    stdout: `Processed: ${input}`,\n' +
      "    stderr: '',\n" +
      '    exitCode: 0,\n' +
      '  }\n' +
      '}\n',
  }
}

export function normalizeSkillBeforeSave(skill: SkillDocument): SkillDocument {
  const nextId = slugify(skill.id || skill.name)
  return {
    ...skill,
    id: nextId,
    name: skill.name.trim() || 'Untitled Skill',
    description: skill.description?.trim() || '',
    markdown: skill.markdown || '# New Skill\n',
    scripts: skill.scripts.map((script, index) => {
      const scriptId = slugify(script.id || script.label || `run-${index + 1}`)
      return {
        ...script,
        id: scriptId,
        label: script.label.trim() || `Run ${index + 1}`,
        runtime: script.runtime.trim() || 'builtin-js',
        entry: script.entry.trim() || `scripts/${scriptId}.js`,
        approvalPolicy: script.approvalPolicy || 'ask',
        argsSchema: script.argsSchema?.trim() || '',
        content: script.content || '',
      }
    }),
  }
}
