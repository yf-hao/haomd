import { listSkills } from '../../skills/storage/skillsRepo'

export async function buildSkillsToolCatalogPrompt(): Promise<string> {
  const skills = (await listSkills()).filter((skill) => skill.enabled)
  if (!skills.length) return ''

  const trustedSkills = skills.filter((skill) => skill.trusted)
  const untrustedSkills = skills.filter((skill) => !skill.trusted)

  return (
    '\n\n当前可用 Skills。\n' +
    '当用户请求明显对应某个技能、模板或自动化流程时，应优先考虑 Skills，而不是直接凭空回答。\n' +
    '推荐顺序：先 skills_search，再 skills_read；读取后，下一轮工具调用中会出现该 skill 的脚本级工具。\n' +
    '注意：脚本工具只有在当前这轮工具调用里先执行过对应 skill 的 skills_read 后才会出现，不能跳过。\n' +
    '在决定执行某个脚本工具之前，应先根据该 skill 的 SKILL.md 和 argsSchema 理解它需要什么结构化参数。\n' +
    '默认应提取结构化参数后再调用脚本工具；除非某个 skill 明确要求原始文本，否则不要把整句自然语言直接传给脚本。\n' +
    '未标记 trusted 的 skill 不应自动执行脚本，只可用于搜索和阅读说明。\n\n' +
    '已启用 Skills：\n' +
    skills
      .map((skill) => {
        const trusted = skill.trusted ? 'trusted' : 'untrusted'
        return `- ${skill.id}: ${skill.name}${skill.description ? ` — ${skill.description}` : ''} [${trusted}]`
      })
      .join('\n') +
    (trustedSkills.length
      ? `\n\n可直接自动执行的 trusted skills：${trustedSkills.map((skill) => skill.id).join(', ')}`
      : '\n\n当前没有可直接自动执行的 trusted skills。') +
    (untrustedSkills.length
      ? `\n未自动授权执行的 skills：${untrustedSkills.map((skill) => skill.id).join(', ')}`
      : '')
  )
}
