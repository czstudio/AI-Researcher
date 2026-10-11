---
name: pdf-export
description: 编译 LaTeX 源为 PDF 并验证（tectonic 引擎 + pdfinfo 质检）
---
# PDF Export

1. `python3 skills/pdf-export/scripts/export_pdf.py <input.tex> <output.pdf>` — tectonic 编译。
2. 检查 JSON 输出 `ok: true` 和 `pages` 数。
3. 编译失败时读 `log` 字段修复 LaTeX 错误后重试。
4. 成功后必须过 `report-quality-gate` 验收。
