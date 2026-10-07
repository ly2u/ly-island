# 发布与回滚

从这份文档开始，**Git 是源码的唯一来源**：线上只运行已合并到 `main`、并打了标签的提交。发布由 `scripts/release.py` 完成，合并 PR 不会自动部署。

## 1. 发布脚本做什么、不做什么

| 管理 | 不管理 |
|---|---|
| `sites` 容器镜像：从标签源码构建，切换 `ly-sites:current` | `compose.yaml`、`Caddyfile`：与标签版本不一致时拒绝发布，需人工安装（第 6 节） |
| 岛屿静态资源：更新 `apps/ly-island-preview/dist`，保持目录不变 | 运维脚本和 systemd 单元：只提示差异，人工安装 |
| 岛屿源码文件与 `SOURCE-MANIFEST.json`，使备份校验保持一致 | 内容数据（`/srv/ly-data`）、CivilFlow、个人 AI 桥接 |
| 发布记录、发布前备份、健康检查、自动回滚 | `apps/rqly-sites/` 运行目录：迁移后不再修改，也不再用于构建 |

四个命令：

```bash
python3 scripts/release.py check  <标签>       # 预检查，不改线上
python3 scripts/release.py deploy <发布编号>   # 发布，失败自动回滚
python3 scripts/release.py rollback            # 手动撤销当前发布
python3 scripts/release.py status              # 查看当前发布和历史
```

**发布编号**由 `check` 打印，格式是 `<标签>-<提交前 12 位>`，例如 `v2026.10.08-81677bd3a1f2`。`deploy` 必须用完整编号，这就是发布确认。

**预检查会写入的内容**（都不影响线上）：

- `/opt/ly-stack/releases/<发布编号>/` 目录；
- Docker 镜像标签 `ly-sites:<发布编号>`；
- 在 `node:24-alpine` 容器里运行 `npm ci`，需要访问 npm 注册表。

它不会切换容器，不会修改岛屿文件，也不会修改配置。

## 2. 首次迁移（只做一次）

前提：本仓库关于发布流程的 PR 已合并。全程大约 10 分钟，第 5 步 `sites` 会重启几秒钟。

**0. 选时间。** 避开每天 UTC 03:15（北京时间 11:15）的自动备份。

**1. 备份。**

```bash
cd /opt/ly-stack
bash scripts/backup.sh
```

**2. 准备仓库工作树。** 它必须是完整克隆，`origin` 指向 GitHub，并且没有本地修改。

```bash
R=/opt/ly-stack/repository
git -C $R remote get-url origin              # 应为 https://github.com/ly2u/ly-island（或 git@ 形式）
git -C $R status --short                     # 应无输出；有输出就先停下来核对
git -C $R rev-parse --is-shallow-repository  # 应为 false；为 true 时运行 git -C $R fetch --unshallow
git -C $R checkout main && git -C $R pull --ff-only
```

**3. 给当前运行的镜像打上 `ly-sites:current`。**

```bash
cd /opt/ly-stack
running=$(docker inspect --format '{{.Image}}' "$(docker compose ps -q sites)")
docker image tag "$running" ly-sites:current
docker image inspect --format '{{.Id}}' ly-sites:current   # 应与 $running 相同
```

**4. 核对差异，再安装新的 `compose.yaml` 和运维脚本。**

```bash
for f in compose.yaml scripts/backup.sh scripts/verify-backup.py scripts/record-island-source.py; do
  diff -u /opt/ly-stack/$f $R/$f
done
```

预期只有这些差异：

- `compose.yaml`：`sites` 的 `image` 改为 `ly-sites:current`，去掉 `build`，加上 `pull_policy: never`；
- `backup.sh`：增加发布目录；
- `verify-backup.py`：增加发布产物校验；
- `record-island-source.py`：增加可选的目录参数。

**如果还有其他差异，说明线上已经和仓库不一致，先停下来核对，不要继续。**

确认后保存旧文件，再安装。`cp` 覆盖已有文件时会保留原文件的权限。

```bash
mkdir -p /opt/ly-stack/rollback/before-release-flow
for f in compose.yaml scripts/backup.sh scripts/verify-backup.py scripts/record-island-source.py; do
  cp /opt/ly-stack/$f /opt/ly-stack/rollback/before-release-flow/$(basename $f)
  cp $R/$f /opt/ly-stack/$f
done
```

**5. 用新的 compose 重建 `sites`。** 镜像相同，只是名称变了。

```bash
cd /opt/ly-stack
docker compose config -q
docker compose up -d --no-build --no-deps --force-recreate --wait sites
curl -fsS https://rqly.com/healthz && echo
```

**6. 确认备份仍然通过。**

```bash
bash scripts/backup.sh
```

**撤销迁移**（任一步出问题时）：把 `rollback/before-release-flow/` 里的 4 个文件复制回原位置，然后运行：

```bash
docker compose up -d --no-deps --force-recreate --wait sites
```

旧的镜像标签（`ly-sites:github-static-fix-20261007`）没有删除，旧 `compose.yaml` 仍然可以直接使用。

## 3. 每次发布

**1. 合并 PR，然后给 `main` 上的提交打标签。** 标签以 `v` 加数字开头，例如 `v2026.10.08`、`v1.2.0`。可以在 GitHub 的 Releases 页面创建，也可以在本地：

```bash
git tag v2026.10.08 origin/main
git push origin v2026.10.08
```

**2. 预检查（不改线上）。**

```bash
cd /opt/ly-stack/repository
git pull --ff-only
python3 scripts/release.py check v2026.10.08
```

预检查会依次：

1. 确认标签指向的提交已经在 `origin/main` 上；
2. 导出源码；
3. 在隔离容器里运行全部 `scripts/check*.mjs`；
4. 构建岛屿；
5. 构建 `sites` 镜像。

预检查还会以只读方式请求一遍线上地址：`/healthz`、`/api/posts`、`/notes`、首页和 `https://7zui.com/`。如果其中某个地址现在就不通，发布后的健康检查必然失败，所以报告会把它列为"不能发布"的原因。如果 7zui.com 已停用，可以在命令前加 `LY_TOOL_HOST=` 跳过它，`check` 和 `deploy` 都要加。

然后打印一份报告（同时保存为 `releases/<发布编号>/check-report.txt`），包括：

- 提交和说明；
- 镜像和岛屿是否会变化；
- 自当前发布以来的源码改动；
- 线上配置是否与标签版本一致；
- 能否发布，以及发布命令。

完整日志在 `releases/<发布编号>/check.log`。

**3. 发布。**

```bash
python3 scripts/release.py deploy <报告里的发布编号>
```

发布的步骤：

1. 核对预检查产物没有被改动，线上 `compose.yaml` 和 `Caddyfile` 与标签版本一致，线上地址现在都正常；任何一项不满足就停止，不做备份也不做修改；
2. 运行 `backup.sh`：这期间 `sites` 和 `caddy` 会停止，网站暂时不可访问，时长与平时备份相同；
3. 如果镜像有变化，切换 `ly-sites:current`，只重建 `sites` 容器，等待容器健康；
4. 通过本机 Caddy 检查 `https://rqly.com/healthz`、`/api/posts`、`/notes` 和 `https://7zui.com/`；
5. 把线上岛屿与发布版本逐个文件比较（全部构建产物，加上随产物同步的岛屿源码）。只要有任何一个文件不同，就更新岛屿：先加入新的带哈希资源，再原子替换 `admin-scene.js` 等顶层文件，最后替换 `index.html`；同步岛屿源码，重新生成 `SOURCE-MANIFEST.json`。所以只改后台场景时也会发布；
6. 逐个确认线上实际返回的 `index.html` 和 `admin-scene.js` 等顶层文件就是本次发布的版本，再确认首页引用的每个资源都能访问；
7. 写入 `releases/current.json` 和 `releases/history.jsonl`。

第 3 到 6 步任何一步失败都会**自动回滚**：镜像指回原来的版本。如果岛屿更新已经开始，不论进行到哪一步，都完整恢复发布前的快照，包括顶层文件、岛屿源码和 `SOURCE-MANIFEST.json`。然后再做一遍健康检查，确认线上返回的首页和后台场景都是发布前的版本。新加入的带哈希资源会保留，旧页面可能还在引用它们，而快照里的清单没有列出它们，不影响备份校验。

退出码：

| 退出码 | 含义 |
|---|---|
| 0 | 发布成功 |
| 1 | 未能发布：发布前被拒绝（没有做任何修改），或失败后已自动回滚并通过健康检查 |
| 2 | 自动回滚也失败了，按第 5 节人工处理 |

**4. 发布后人工看一眼：** 首页岛屿、一篇 `/notes/` 文章、后台登录。

## 4. 回滚

**手动撤销当前发布**：

```bash
python3 scripts/release.py rollback
```

它会恢复当前发布在发布前保存的岛屿文件和镜像，然后做健康检查。可以连续执行，每次往前退一个发布；退到迁移前的状态后再执行会提示"没有可撤销的发布"。

**回到更早的任意版本**：对那个旧标签重新运行 `check` 和 `deploy`。

**数据兼容性：** 回滚只更换代码，不改数据。如果新版本已经写入了旧版本不认识的数据格式，回滚后旧代码可能出错。这种情况需要用发布前自动生成的备份（`/srv/ly-backups/`）恢复数据。所以涉及数据格式变化的 PR，应在 PR 说明里写明，发布前单独评估。

**保留期：** 发布目录保留最近 5 个（加上当前发布和它的上一个）。更旧的目录和对应的镜像标签会自动删除；之后对它们只能重新 `check` 再 `deploy`。

## 5. 自动回滚失败（退出码 2）

先看状态，记下 `previous.imageId`：

```bash
cd /opt/ly-stack
python3 repository/scripts/release.py status
python3 -c "import json;print(json.load(open('releases/<发布编号>/release.json'))['previous'])"
```

**恢复 `sites`：**

```bash
docker image tag <previous.imageId> ly-sites:current
docker compose up -d --no-build --no-deps --force-recreate --wait sites
curl -fsS https://rqly.com/healthz && echo
```

**恢复岛屿**（`rollback/` 目录在发布开始时生成）：

```bash
D=/opt/ly-stack/apps/ly-island-preview
B=/opt/ly-stack/releases/<发布编号>/rollback
for f in $B/island-top/*; do
  n=$(basename $f)
  [ $n = index.html ] || { install -m 0644 $f $D/dist/$n.next && mv $D/dist/$n.next $D/dist/$n; }
done
install -m 0644 $B/island-top/index.html $D/dist/index.html.next && mv $D/dist/index.html.next $D/dist/index.html
rm -rf $D/src && tar -xf $B/island-source.tar -C $D   # 同时恢复发布前的 SOURCE-MANIFEST.json
```

最后打开首页确认，并运行一次 `bash scripts/backup.sh`。

## 6. 不由脚本处理的改动

**`compose.yaml` 或 `Caddyfile` 有改动的版本：** 预检查会报告"现在还不能发布"。处理顺序：

1. `diff -u` 核对；
2. 备份；
3. 复制到 `/opt/ly-stack/`；
4. 运行 `docker compose config -q` 和 `docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`；
5. 只重建或重载受影响的服务；
6. 再运行 `check` 和 `deploy`。

**运维脚本和 systemd 单元：** 预检查会提示差异，人工核对后复制。

**CivilFlow：** 独立仓库，照旧发布。

**个人 AI 桥接：** 照旧用 `scripts/install-personal-ai.sh` 安装。

**旧脚本：** `scripts/deploy-host.sh` 会从 `apps/rqly-sites` 构建 `sites`，迁移后的 `compose.yaml` 不再支持这种做法，不要再使用；`bootstrap-host.sh` 只用于全新服务器。

## 7. 记录在哪里

```text
/opt/ly-stack/releases/
├── current.json             当前发布：编号、提交、镜像 ID、岛屿首页哈希
├── history.jsonl            每次 check / deploy / 回滚 / 清理的记录
└── <发布编号>/
    ├── release.json         状态、提交、镜像、上一个版本、全部源码和岛屿文件的哈希
    ├── src/                 标签源码导出（可据此重新构建）
    ├── island-dist/         岛屿构建产物
    ├── check-report.txt     预检查报告
    ├── check.log            预检查完整日志
    ├── deploy.log           发布与回滚日志
    └── rollback/            发布前的岛屿文件和源码快照
```

`backup.sh` 会把整个 `releases/`（不含临时目录）放进每日备份。`verify-backup.py` 会按 `release.json` 中记录的哈希，校验当前发布的源码和岛屿产物能否完整恢复。

## 8. 测试

`scripts/check-release.py` 在模拟环境里覆盖这些情况：

- 预检查不改线上；
- 成功发布；
- 未合并的标签被拒绝；
- 检查失败、配置不一致、产物被改动、备份失败、线上地址本来就不通时不发布；
- `sites` 不健康或岛屿异常时自动回滚；
- 只改后台场景（首页产物不变）时也会发布；
- 岛屿更新进行到一半失败时，完整恢复快照；
- 文件已写入、但线上返回的仍是旧内容时，能发现并回滚；
- 连续手动撤销；
- 备份校验能发现被改动的发布产物。

它用假的 docker 命令和本地 HTTP 服务，不需要 Docker、网络或生产目录。GitHub Actions 每次提交都会运行它。它不能代替真实服务器上的第一次迁移和发布，所以第一次请按第 2、3 节逐步执行，并留意每一步的输出。

## 两步验证的版本兼容

管理员可自行开启验证器两步验证，见 [ADMIN-MFA.md](ADMIN-MFA.md)。开启后只能发布或回滚到支持它的版本，须使用 main 中最新的 `scripts/release.py`。备份需要同时包含 `admin-mfa.json` 与 `admin-mfa-key.json`；不要删除配置绕过验证。
