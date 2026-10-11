---
name: dataviz
description: 数据可视化调色板校验与选型（validate_palette + choosing-a-form + anti-patterns）
---
# Dataviz

1. 选色后运行 `node skills/dataviz/scripts/validate_palette.js '#2a78d6' '#eb6834' --mode light --surface '#ffffff'` 验证可区分性与对比度。
2. 图型选择参照 choosing-a-form 原则：比较→柱状、趋势→折线、分布→直方、关系→散点。
3. 避免 anti-patterns：3D 饼图、双 Y 轴无标注、截断 Y 轴不声明、彩虹色标。
4. 证据图必须有数据来源标注（脚本生成，不手画）。
