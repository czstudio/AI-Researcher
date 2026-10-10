---
name: novix-ideaspark
description: 多轮研究驱动的 idea 树生成方法论（按线上行为重建）
---
# Idea Spark 方法论

1. 以 `idea-tree.json` 为唯一事实源：节点 `{id,parent,children[],created_at,summary,description,next_action,references[]}`。
2. 每轮分支扩展前必须先做 fresh research（mcp__paper_search__unified_paper_search）。
3. 分支持久化门槛：novelty（相对检索到的先例有差异）、gap（指出现有工作空白）、feasibility（给出可检验评估协议）、references（≥3 条真实引用）——四项全过才写入。
4. 每轮结束跑一次自检：引用可解析、描述含可证伪评估协议、树的父子关系一致。
5. 输出语言与用户任务一致。
