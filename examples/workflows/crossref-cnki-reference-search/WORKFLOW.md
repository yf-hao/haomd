# Crossref + CNKI Reference Search

这个 Workflow 针对同一研究课题，分别调用 CNKI 与 Crossref 参考文献 Skill，合并两边的 GB/T 7714 引文。最终先列 CNKI 中文引文，再列 Crossref 英文引文。

## 适用请求

用户明确要求从 Crossref 与 CNKI 查找某个课题的参考文献，例如：

> 从 Crossref 与 CNKI 查与“基于 Spring Boot 的大学生学术成长服务平台设计与实现”相关的参考文献。

先从 Workflow 面板启用该工作流。AI Chat 应先搜索并读取本 Workflow，再为 Crossref 生成最多三组英文检索词、为 CNKI 生成最多六组中文检索词，然后运行。

## 依赖

- `crossref-reference-search` Skill，需已导入并启用。
- `cnki-reference-search` Skill，需已导入并启用，且已配置有效的 `cookie.txt`。

如果任一 Skill 不存在或未启用，先在 Skills 面板导入/启用；CNKI 的 Cookie 失效时，工作流结果会记录该来源失败，不能推测或伪造引文。

## 输入

Workflow 接收以下 JSON：

```json
{
  "topic": "基于 Spring Boot 的大学生学术成长服务平台设计与实现",
  "crossrefQueries": [
    "Spring Boot student academic management",
    "university student academic advising platform",
    "student academic development information system"
  ],
  "cnkiKeywords": [
    "Spring Boot 学业管理",
    "Spring Boot 学生发展",
    "大学生 学业指导",
    "高校 学业发展",
    "学业支持 平台",
    "学生发展 服务平台"
  ]
}
```

Crossref 使用最多三组英文检索词。CNKI 使用最多六组中文检索词：先覆盖“技术＋业务”“业务＋系统类型”“技术＋系统类型”，再针对“学业指导、学业发展、学业支持、学生发展”等相邻学术表达补充短词组。不要把未在题目出现的实现功能当成项目事实。用户明确限制年份或文献类型时，按 Skills 支持的参数和筛选规则执行。

## 步骤

1. `crossref` 调用 `crossref-reference-search/search`，每组最多返回 20 条候选元数据，候选带 Crossref 官方 API 元数据生成的 GB/T 7714 格式 `citation`。
2. `cnki` 调用 `cnki-reference-search/search`，按最多六组中文主题词检索、去重，并在最多 24 次 HTTP 请求的预算内为均衡候选调用 CNKI GetExport；成功记录包含 GB/T 7714 格式 `citation`。
3. 失败策略为 `continue`。一方出错时仍保留另一方结果；检查每个来源 JSON 中的 `errors`、`records` 和 `citation`，不把错误页、空引文或没有题名/作者的候选当作可核验引文。

两个 Skill 按工作流步骤顺序执行。Workflow 的 `output_from` 返回 `topic` 及两个 Skill 的原始 JSON 输出字符串，便于保留成功或失败时各自的诊断信息。

## 合并与最终回复

Workflow 返回后，由 AI 直接提取两个来源记录中非空且可核对的 `citation` 字段，目标为 10 条 CNKI 中文引文和 5 条 Crossref 英文引文。不因过度严格的主题匹配而漏掉相邻领域的有用文献。可纳入直接相关的平台/系统设计、使用相关技术实现的系统，以及大学生学业指导、学业发展、学业支持和学生成功等相邻领域研究；排除只有泛词重合的记录。合并时按以下顺序处理：

- 先处理 CNKI 记录，筛掉空引文、书目与用户课题无关的记录，并按题名和完整课题的相关性排序。
- 再处理 Crossref 记录，筛掉空引文、作者缺失或占位作者、以及只命中宽泛词但与课题无关的记录，并按题名和完整课题的相关性排序。
- 按“CNKI 中文引文在前、Crossref 英文引文在后”的顺序串接两组结果；不要把中英文条目交错排列。
- 优先用规范化 DOI 去重；CNKI 记录没有 DOI 时，以规范化题名、作者和年份联合去重。不要仅凭来源或临时链接判断重复。
- 先选 10 条相关且有效的 CNKI 中文引文，再选 5 条相关且有效的 Crossref 英文引文，最终共 15 条。若某个来源没有足够的有效相关引文，只返回该来源实际可用的条数，不编造补齐，也不自动用另一来源超额替代。按“中文 10 条在前、英文 5 条在后”的顺序从 `[1]` 连续编号；去掉来源引文自带的旧序号，不要改写其他书目信息。
- 最终答复只输出排序后的 GB/T 7714 引文，每条一段，不加标题、检索过程、来源说明、数量说明或其他文字。
- 若某一来源失败，使用另一来源成功且可核验的引文；只有两边都没有可用引文时，才用一句简短说明实际失败原因。

## 输出映射

`output_from` 返回：

- `topic`：原始课题。
- `crossref`：Crossref `search` 的 stdout JSON 字符串。
- `cnki`：CNKI `search` 的 stdout JSON 字符串。

`output` 保留两个 Skill 的原始 JSON，便于 AI 从各自的 `records[].citation` 提取引文。最终答复不输出这些 JSON、元数据或诊断字段，只输出合并后的引文列表。
