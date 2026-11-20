# 桌面构建配置

LING 移除反馈工单、远程遥测采集和导出。错误横幅提供本地错误详情和复制，日志由用户手动导出。模型请求保留请求关联和 provider 所需的会话类型。会话能力、请求用途统计字段和首响应埋点已移除。

桌面自动更新由 `ZCODE_AUTO_UPDATE` 控制。构建脚本将该值注入 `__ZCODE_AUTO_UPDATE_ENABLED__`，缺省关闭。LING 发布流程按 [GitHub Releases 自动更新](ling-github-updates.md) 开启。
