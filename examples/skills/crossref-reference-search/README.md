# Crossref 参考文献检索 Skill

本包包含两个 HaoMD `builtin-js` 脚本，使用运行时提供的 `http.request`，无需 Python、Cookie 或 API key，支持 Windows、macOS 和 Linux。

- `search`：分别查询 AI 生成的三组英文关键词，提取元数据、按 DOI 去重并保留来源查询。
- `export-reference`：按选定 DOI 重新核对 Crossref 记录，清理字段并生成编号的 GB/T 7714 引文。

AI 负责拆分题目和相关性排序；最终只返回最多 10 条引文，不附其他描述。数量不足时不编造补齐，缺失卷期页码不补造。

## 安装与使用

完整包须包含 `skill.json`、`SKILL.md` 和 `scripts` 文件夹。当前 HaoMD 的“导入 Skill”只导入说明正文；要保留脚本，请将本完整目录复制到 HaoMD 配置目录的 `haomd/skills/crossref-reference-search` 中。该项目的本机安装副本会随本次更新同步。

通常位置：

- macOS：`~/Library/Application Support/haomd/skills/crossref-reference-search`
- Windows：`%APPDATA%\haomd\skills\crossref-reference-search`
- Linux：`~/.config/haomd/skills/crossref-reference-search`

在 HaoMD 的 Skills 面板启用此 Skill，即表示允许 AI 使用它并执行脚本。开启新聊天，使用支持工具调用的 OpenAI 兼容模型，输入：

> 从 Crossref 查与“基于 Spring Boot 的大学生学术成长服务平台设计与实现”相关的参考文献。

AI 会构建三组英文关键词，调用 `search`，按课题相关性筛选后调用 `export-reference`。最终仅输出排序后的引文。Skill 只访问 Crossref 元数据，不读取论文全文。

## 验证

可在项目根目录运行 `node --test examples/skills/crossref-reference-search/tests/scripts.test.cjs`，检查去重、编码、元数据异常和引文格式。HaoMD 模型是否正确拆词及筛选仍需在实际对话中验证。
