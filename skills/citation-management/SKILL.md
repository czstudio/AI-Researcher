---
name: citation-management
description: 引用管理（bib 去重、DOI/arXiv 校验、防幻觉）
---
# Citation Management

1. 所有引用入 references.bib；key 规范 `authorYYYYkeyword`。
2. 每条引用必须有可验证标识（DOI 或 arXiv ID）；从 paper_search 结果直接提取，不手打。
3. 正文 `\cite{}` key 必须与 bib 一致；编译前 grep 对齐。
4. 引用不可达/未验证的，在 evidence_extraction.md 标记 UNVERIFIED，不进 bib。
