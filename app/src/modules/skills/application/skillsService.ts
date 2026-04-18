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
    description: '',
    enabled: true,
    trusted: false,
    loadPolicy: 'on_demand',
    markdown: '# New Skill\n\n请描述这个 skill 的用途、适用场景、输入输出约定。\n',
    scripts: [],
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
    argsSchema: '{\n  "type": "object",\n  "properties": {}\n}',
    content:
      'function run(args) {\n' +
      '  return {\n' +
      '    ok: true,\n' +
      '    stdout: `Hello, ${args?.name ?? "World"}!`,\n' +
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

