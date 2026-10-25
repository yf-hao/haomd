# Crossref + CNKI Reference Search Workflow

该示例把 CNKI 与 Crossref 两个参考文献 Skills 编排成一个 Workflow。AI 从结果中提取有效引文，按相关性筛选并去重，目标为先输出 10 条 CNKI 中文引文，再输出 5 条 Crossref 英文引文。

## 依赖

先在 Skills 面板导入并启用：

- `examples/skills/crossref-reference-search`
- `examples/skills/cnki-reference-search`

CNKI Skill 还需要在其配置目录准备有效的 `cookie.txt`。

## 配置

打开 Workflows 面板，点击导入按钮并选择本目录 `crossref-cnki-reference-search`。导入后工作流默认禁用；打开它检查步骤依赖并启用。步骤顺序为 Crossref 搜索，然后 CNKI 搜索；两步的输入模板分别绑定 `input.crossrefQueries` 和 `input.cnkiKeywords`。

## 验收请求

```text
从 Crossref 与 CNKI 查与“基于 Spring Boot 的大学生学术成长服务平台设计与实现”相关的参考文献。
```

AI 应为 Crossref 构建最多三组英文关键词，为 CNKI 构建最多六组中文关键词，先读取再运行该 Workflow；Crossref 每组取 20 条候选，合并去重并按相关性排序，最终回复 10 条中文引文和 5 条英文引文。若有效相关记录不足，则只返回实际可用的引文。
