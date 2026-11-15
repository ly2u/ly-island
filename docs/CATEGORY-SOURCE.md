# 分类只有一个来源

旧实现把 `post.topic=工程/探索` 临时生成为书，而后台只显示 `organization.json` 的分类，
因此前台出现管理员无法选择或改名的“探索”。分类来源统一为真实目录后，不再使用这个兜底。

- `organization.topics` 指向目录中的 `type=topic`；书架、文章详情和搜索显示同一组分类名。
- 没有选择真实分类就显示“未分类”。明确清空分类后，旧固定分组不会重新把文章分回去。
- 旧 `topic` 字段暂留给兼容筛选和工程/工坊入口，不能当作文章详情或书架分类。
- 全岛搜索只显示文章/项目类型，分类筛选来自真实公开目录；私人目录不进入公开选项。
- 分类改名用原ID，文章和书的地址不变。

## 一次性元数据修复

`category-migration.mjs` 只处理没有 organization 字段、旧固定分组为工程/探索的非回收站文章。
已有分类（包括明确的空分类）、项目、正文、标题、日期、发布状态、slug等全部保留。
它创建或复用真实分类，并写 `legacyBooks` 别名；历史 engineering/exploration 书链接可以在改名后
继续解析到同一ID。别名只有公开分类才随公众目录输出，导入/导出保持并校验该映射。

修复是维护命令，不在启动或GET请求中自动执行。默认只读计划；实际写入复用现有内容导入事务，
两份文件一起持久提交，中断由现有恢复逻辑撤销未提交批次。存在自动保存的编辑草稿时拒绝写入，
避免悄悄改变其来源版本。操作前备份，执行时停止sites，并在成功或失败后都恢复服务。

VPS没有宿主机Node时，可用已通过预检查的生产镜像：

```sh
# 只读核对，不修改存档
# IMAGE替换为已通过预检查的 ly-sites:<发布编号>
docker run --rm --user 1000:1000 -v /srv/ly-data/sites:/app/data:ro IMAGE \
  node --input-type=module -e 'import {migrateLegacyCategories} from "./category-migration.mjs"; console.log(migrateLegacyCategories("/app/data"));'
```

实际执行前先运行现有备份，再在sites停止期间将挂载改为可写并传 `{apply:true}`。
实际UID/GID应与生产应用相同；不要让root生成应用用户不可读的数据文件。
运行后核对仅预期文章新增organization、目录新增分类/别名，原正文/URL/状态逐项不变。
旧浏览器页面需要刷新；已有旧版本提交仍受409版本冲突保护，不能覆盖新归属。

如需撤销元数据修复，停sites后从修复前的本地备份同时恢复posts.json和organization.json，
保留应用UID/GID，再启动；不能只恢复其中一份。源码回退使用既有release.py流程。
