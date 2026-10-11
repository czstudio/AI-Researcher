---
name: report-quality-gate
description: PDF 报告确定性验收门（pdfinfo/pdffonts/PNG 导出）
---
# Report Quality Gate

1. `python3 skills/report-quality-gate/scripts/report_acceptance.py <report.pdf>` — 确定性检查。
2. 全部 checks 必须 pass：PDF magic / pages > 0 / pdffonts / PNG 导出页数一致。
3. PNG 导出后用 Read 工具逐页自审（图片质量、排版、引用格式）。
4. 任何 check 失败 → 修源重编译，不得跳过门禁。
