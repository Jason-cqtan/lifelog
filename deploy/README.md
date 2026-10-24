# 部署到 VPS

VPS 负责每小时同步一次、通过自己的域名提供网站，并把数据推回 GitHub;GitHub Pages 继续保留，跟着这些推送自动更新。服务器上只有 Caddy、一个 Go 二进制和静态网页，不需要安装 Go 或 Node。

```
VPS (每小时 :07)                               GitHub
  lifelog-sync.timer → sync.sh                   Jason-cqtan/lifelog
    git pull → lifelog sync → export   ──push──▶  data/ 提交 → Actions 构建 → Pages
    /opt/lifelog/www/data.json
  Caddy: https://<域名>  (Let's Encrypt 证书，自动续期)
```

| 文件 | 作用 |
|---|---|
| `deploy.sh setup` | 一次性：上传并运行 `install.sh` |
| `install.sh` | 装 Caddy、建 `lifelog` 用户和 GitHub 部署密钥、写 Caddy 配置、装定时任务、开防火墙 |
| `deploy.sh release` | 本地交叉编译 + 构建网页 → 上传 → 立即同步一次;改代码后重跑 |
| `sync.sh` + `lifelog-sync.{service,timer}` | 每小时同步、导出、推送 |
| `Caddyfile` | HTTPS、缓存头、`www.` 跳转 |

## 上线步骤

1. **买 VPS**:系统选 Debian 12 或 Ubuntu 24.04,1 核 / 512MB–1GB 内存 / 10GB 磁盘就够。云厂商的「安全组/防火墙」里放行 22、80、443。
2. **域名解析**:把 `<域名>` 和 `www.<域名>` 的 A 记录指向 VPS 的 IP。
3. **SSH 免密登录**(你自己操作，需要输入一次 VPS 密码):`ssh-copy-id root@<IP>`
4. **初始化**:`deploy/deploy.sh setup root@<IP> <域名> <邮箱>`
   第一次会打印一个部署密钥：添加到 GitHub 仓库 Settings → Deploy keys,勾选 *Allow write access*,然后再跑一次同样的命令(这次会克隆仓库)。
5. **GitHub 贡献的 token**:VPS 上没有 Actions 自带的 token。在 GitHub 建一个 fine-grained token(不需要任何仓库权限),在本地 `.env` 加上 `GH_USERNAME=Jason-cqtan` 和 `GH_TOKEN=...`。
6. **发布**:`deploy/deploy.sh release root@<IP> --with-env`(`--with-env` 把本地 `.env` 里的 API token 传到服务器，只有 `lifelog` 用户可读;密码和手机号不会上传)。
7. **Mapbox**:在 token 的 URL 限制里加上 `https://<域名>`。
8. **交接**:仓库变量 `SYNC_ON_ACTIONS=false`(`gh variable set SYNC_ON_ACTIONS --body false`),之后只有 VPS 同步,Actions 只在数据推送后构建 Pages。

## 日常

- 查看同步日志:`journalctl -u lifelog-sync -n 50`;下次运行时间:`systemctl list-timers lifelog-sync.timer`
- 手动同步一次:`systemctl start lifelog-sync`
- 证书：由 Caddy 自动申请和续期(到期前约 30 天),`journalctl -u caddy | grep -i certificate` 可看续期记录。
- 更新 token(比如重新授权 Spotify 后):`deploy/deploy.sh release root@<IP> --with-env`
- 回退到 GitHub Actions 同步：把 `SYNC_ON_ACTIONS` 删掉或设为 `true`,再 `systemctl disable --now lifelog-sync.timer`。
