---
name: awaken
description: 会话启动例程（线上轨迹中每任务首个 Skill 调用；语义按行为重建）
---
# Awaken

1. 读取工作区现状（Glob + Read progress.md 若存在）。
2. 建立/恢复执行计划（TaskCreate）。
3. 确认可用工具面与技能清单，然后进入模式主流程。
