---
title: 第一座桥的点云
date: 2026-09-14
kind: article
summary: 用小模型把一座小桥的点云分割成构件，记录流程和失败的地方。
tags: [点云, BIM]
---

这是一篇示例文章，内容是虚构的，用来展示文章页的排版。

## 数据

| 项目 | 数值 |
| --- | --- |
| 点数 | 约 1,200 万 |
| 构件类别 | 7 |
| 人工修正 | 约 15% |

## 流程

1. 去噪和抽稀；
2. 按几何特征分出桥面、栏杆、桥墩；
3. 把每一类拟合成参数化构件。

```python
def thin(points, voxel=0.05):
    """按体素抽稀，保留每个格子里的第一个点。"""
    seen, kept = set(), []
    for p in points:
        key = tuple(int(c // voxel) for c in p)
        if key not in seen:
            seen.add(key)
            kept.append(p)
    return kept
```

## 失败的地方

栏杆和背景里的树经常混在一起。下一步打算先用颜色做一次粗分。
