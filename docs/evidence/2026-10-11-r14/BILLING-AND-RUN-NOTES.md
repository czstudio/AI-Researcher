# 第十四轮 Pro 实跑产物与计费（2026-10-11，uid 195131）

## 任务与产物
| 任务 | 模式 | 步数 | 实扣 | 预估价 | 产物 |
|---|---|---:|---:|---:|---|
| 246270 | Idea Spark | 341 | **9 cr** | 3 cr | project/attention-sinks-small-models-idea-tree.json（21KB，13 节点三层，本目录） |
| 246271 | Reproduce Paper | 371 | **7 cr** | 10 cr | 独立 PyTorch 复现：MNIST 97.36%±0.04 vs 论文≈97.23；BN 增益 0.29±0.10pp（部分复现，诚实标注）；Imagenette 代理 ImageNet；三种子（本目录 progress.md） |

- 计费=用量制终证：预估价仅作准入门槛，结算按实耗（≈38-53 步/cr）。
- 两任务并行 15min+，Pro 并发≥2；getUserCreditInfo 无并发字段。
- 下载契约：`GET /api/file/download?fileKey=nova_agent_v1/user_data/session_<sid>/workspace/<path>&chatSessionId=<sid>`。
- 保真报告要点：Reproduce Agent 把"Table 1 column B"歧义显式解释为 Figure 3 最大 single-crop 列再复现——歧义处理模板行为的活体样本。
