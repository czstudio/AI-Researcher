---
name: scientific-schematics
description: 科学示意图（TikZ/矢量格式的方法/机制说明图）
---
# Scientific Schematics

1. 机制/方法说明图优先用 TikZ（LaTeX 内嵌）或 SVG（可编辑矢量），不用位图。
2. 结构：模块框 + 箭头 + 标签；颜色过 dataviz validate_palette。
3. 编译验证：schematic .tex 用 tectonic 单独编译确认无错后再 \input 主稿。
4. 避免生成式图像（AI 画）冒充示意图——示意图必须是确定性的矢量表达。
