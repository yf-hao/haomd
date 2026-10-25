# CNKI 参考文献检索 Skill

这个目录提供一个可导入 HaoMD 的 Skill。AI 固定按技术＋业务场景、业务场景＋系统类型、技术＋系统类型三组检索，去重并按题目相关性排序，再用 `export-reference` 核验前 10 篇的 GB/T 7714 引文。成功时最终只返回排序后的引文。

检索模板采用用户提供的 macOS / Chrome 155 首页点击搜索 curl：使用普通主题检索结构（SearchType=2、Subject.Items、SimpTrad="0"），从 Skill 目录的 `cookie.txt` 读取 Cookie 后直接查询，不再访问首页；关键词和页码可变，每页 20 条。筛选出文献后，复用同一文件中的 Cookie 和结果行 `CookieName` 标识调用 GetExport。

请将当前 Cookie 请求头值（不含 `Cookie:` 前缀）保存到 HaoMD 配置目录的 `haomd/skills/cnki-reference-search/cookie.txt`。macOS 通常位于 `~/Library/Application Support/haomd/skills/cnki-reference-search/cookie.txt`，Windows 通常位于 `%APPDATA%\haomd\skills\cnki-reference-search\cookie.txt`，Linux 通常位于 `~/.config/haomd/skills/cnki-reference-search/cookie.txt`。只需设置一次；脚本每次执行时由应用后端读取并注入，不会把内容发给模型或写入脚本输出。不要将 Cookie 文件提交到 Git 或分享。

如果 grid 返回 /verify/home 等验证页或 403，Skill 会停止并说明 Cookie 可能失效或知网仍要求验证。不会尝试绕过验证。

Skill 只把该 Cookie 发送到 kns.cnki.net。Cookie 不会写入脚本输出。不要仅因请求携带 Cookie 就认为验证已通过。

## 导入与使用

1. 在 HaoMD 的 Skills 面板选择“导入 Skill”，选中本目录。
2. 在 AI Chat 中使用 OpenAI 兼容模型，直接提出检索需求，例如：

   `我的题目是“基于 Spring Boot 的鲜花商城的设计与实现”，帮我找参考文献。`

3. AI 会搜索并读取 Skill，自动读取 `cookie.txt`，分别检索三组关键词，筛选并核验最多 10 篇引文。最终答复只包含按相关性排序的引文；如果核验到的引文不足 10 篇，不会编造补足。无需在聊天中指定 Skill 名称。

可以补充年份、文献类型或研究重点，例如“优先近五年的期刊论文，重点关注库存管理”。如果只想查询原词，可说明“只查该关键词，不扩展”。结果不足时会说明，不用无关论文凑数。

已经导入过旧版时，在 Skills 中编辑该 Skill，将本目录 SKILL.md 的正文（front matter 后的部分）替换进去并保存。重复导入同名目录不会覆盖已有 Skill。建议新建聊天，让 AI 重新读取更新后的说明。

导入的 Skill 默认关闭。要让 AI Chat 调用 `search` 和 `export-reference`，请在 HaoMD Skills 面板中启用它；启用即表示允许 AI 使用 Skill 并运行脚本。脚本只检索元数据和导出引文，不访问全文。AI Chat 的工具调用目前仅适用于 OpenAI 兼容模型。

脚本按实际浏览器“首页点击搜索”和用户提供的 GetExport 请求结构实现；结果解析采用 `td.seq` 的 CookieName 与 `td.name a.fz14` 题名规则，引文清理采用 `format_gb7714_2005` 规则，Cookie 从 `cookie.txt` 读取。尚未完成真实检索和引文获取的全流程验证。
