# 部署到 VPS

VPS 上跑 PostgreSQL 和 `lifelog serve`:按后台设置的时间(默认每天 8:00、13:00、22:00)同步、通过自己的域名提供网站和后台管理页，并把数据备份回 GitHub;GitHub Pages 继续保留，跟着这些推送自动更新。服务器上只有 Caddy、PostgreSQL、一个 Go 二进制和静态网页，不需要安装 Go 或 Node。

```
VPS                                                     GitHub
  lifelog.service: lifelog serve (127.0.0.1:8080)         Jason-cqtan/lifelog
    定时 → sync → PostgreSQL
           → export → /opt/lifelog/www/data.json
           → 备份 data/*.json, git push        ──push──▶  data/ 提交 → Actions 构建 → Pages
  Caddy: https://<域名>          网站 + /admin/(静态)
         https://<域名>/api/*    → lifelog serve
```

| 文件 | 作用 |
|---|---|
| `deploy.sh setup` | 一次性：上传并运行 `install.sh` |
| `install.sh` | 装 Caddy 和 PostgreSQL、建 `lifelog` 用户/数据库/GitHub 部署密钥、写 Caddy 配置、装 `lifelog.service`、开防火墙 |
| `deploy.sh release` | 本地交叉编译 + 构建网页和后台 → 上传 → 重启 `lifelog serve`;改代码后重跑 |
| `lifelog.service` | `lifelog serve`:后台 API、定时同步、导出网站、备份到 GitHub |
| `Caddyfile` | HTTPS、缓存头、`/api/` 反向代理、`www.` 跳转 |

服务器的 `/opt/lifelog/.env` 只放两项:`DATABASE_URL`(本机 socket,peer 认证，没有密码)和 `LIFELOG_ADMIN_PASSWORD`(后台登录密码,`install.sh` 首次运行时生成并打印)。其余配置——各数据源 token、时区、同步时间、地图问题和答案、Mapbox token——都在后台的「设置」里改。

## 上线步骤

1. **买 VPS**:系统选 Debian 12 或 Ubuntu 24.04,1 核 / 1GB 内存 / 10GB 磁盘就够。云厂商的「安全组/防火墙」里放行 22、80、443。
2. **域名解析**:把 `<域名>` 和 `www.<域名>` 的 A 记录指向 VPS 的 IP。
3. **SSH 免密登录**(你自己操作，需要输入一次 VPS 密码):`ssh-copy-id root@<IP>`
4. **初始化**:`deploy/deploy.sh setup root@<IP> <域名> <邮箱>`
   第一次会打印一个部署密钥：添加到 GitHub 仓库 Settings → Deploy keys,勾选 *Allow write access*,然后再跑一次同样的命令(这次会克隆仓库)。记下打印的后台密码。
5. **发布并导入**:`deploy/deploy.sh release root@<IP> --with-env --import-data`
   `--with-env` 把本地 `.env` 里的 token 等配置写进服务器数据库(登录密码和手机号不会上传);`--import-data` 把仓库里的 `data/*.json` 导入数据库。
   路线是用地图答案加密的，本地 `.env` 里要有 `LIFELOG_MAP_ANSWER`,否则路线导入不了。
6. **后台**:打开 `https://<域名>/admin/`,用第 4 步的密码登录，先在「设置」最下面改密码，再核对各数据源是否「已配置」,点「立即同步全部」试一次。
7. **Mapbox**:在 token 的 URL 限制里加上 `https://<域名>`。
8. **交接**:仓库变量 `SYNC_ON_ACTIONS=false`(`gh variable set SYNC_ON_ACTIONS --body false`),之后只有 VPS 同步,Actions 只在数据推送后构建 Pages。

> 从旧版(`lifelog-sync.timer` + `sync.sh`)升级：先 `deploy.sh setup` 一次(装 PostgreSQL、换成 `lifelog.service`、停掉旧定时器),再按第 5、6 步走。
> 数据库还没导入时，备份会拒绝覆盖 `data/`(不会把 GitHub 上的历史清空)。

## 日常

- 同步记录和日志：后台「同步记录」;服务日志:`journalctl -u lifelog -n 50`
- 手动同步：后台「概览」→「立即同步全部」,或单个数据源的「同步」/「全量」
- 改 token / 时区 / 同步时间 / 地图答案：后台「设置」,下次同步生效;地图相关的改完点「只重新导出网站」立即生效
- 在本地 `lifelog auth spotify` 等重新授权后：把新 token 粘到后台，或 `deploy/deploy.sh release root@<IP> --with-env`(会覆盖后台里这些项)
- 关掉 GitHub 备份：后台「设置」→「同步后备份到 GitHub」
- 数据库备份:`runuser -u lifelog -- pg_dump lifelog | gzip > lifelog.sql.gz`(GitHub 上的 `data/` 也是一份完整备份)
- 证书：由 Caddy 自动申请和续期(到期前约 30 天),`journalctl -u caddy | grep -i certificate` 可看续期记录。
- 回退到 GitHub Actions 同步：把 `SYNC_ON_ACTIONS` 删掉或设为 `true`,再 `systemctl disable --now lifelog`。
