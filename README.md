# Lifelog

一个记录"每天都做了什么"的个人网站:跑步 / 骑行 / 爬山(手表同步)、多邻国学习时长、Spotify 听歌时长、GitHub 贡献。
思路参考 [running_page](https://github.com/yihong0618/running_page) 和 [workouts_page](https://github.com/ben-29/workouts_page),后端用 Go 重写。

```
VPS: lifelog serve(每天 8/13/22 点，时间在后台可改)
  └─ sync      各数据源 → PostgreSQL
  └─ export    去重、按天汇总 → data.json(网站读这个静态文件)
  └─ 备份      PostgreSQL → data/*.json 提交回仓库 → Actions 构建 GitHub Pages
后台 /admin/  数据源 token、时区、地图、同步时间等配置;手动同步、查看同步日志
```

## 目录

| 路径 | 作用 |
|---|---|
| `cmd/lifelog` | CLI 入口:`sync` / `import` / `export` / `auth` |
| `internal/model` | 统一的数据模型:`Activity`(运动)、`DailyMetric`(每日数值)、`Play`(听歌记录) |
| `internal/store` | 存储:同步时在内存里，持久化到 PostgreSQL(`DATABASE_URL`)或 `data/` 下的 JSON 文件(一行一条记录) |
| `internal/db` | 连接 PostgreSQL、建表(`schema.sql`) |
| `internal/settings` | 原来 `.env` 里的配置项定义，存在 `settings` 表，后台修改 |
| `internal/server` | `lifelog serve`:后台 API(`/api/admin/`)、定时同步、导出网站、备份到 GitHub |
| `internal/source/*` | 每个数据源一个包,实现 `source.Source` 接口 |
| `internal/export` | 跨来源去重 + 生成 `data.json`;`-demo` 生成示例数据 |
| `web/` | React + Vite 前端:每类一张年度热力图 + 运动记录卡片(路线缩略图);`web/admin/` 是后台管理页 |

**数据在哪:** 设置了 `DATABASE_URL` 时，数据和配置都以 PostgreSQL 为准;每次同步后 `lifelog serve` 把数据库导出成 `data/*.json`
推回 GitHub 作为备份(纯文本一行一条记录，每次提交只有几行变化;路线用地图答案加密)。没设置时 CLI 直接读写 `data/` 和 `.env`,GitHub Actions 走的就是这条路。

**同一次运动被多个来源同步到时**(如 Garmin 手表 → Garmin Connect → Strava),`export` 会把开始时间相差 3 分钟内、类型相同的记录合并,
按 garmin > coros > strava > applehealth 的优先级保留一条(见 `internal/export/export.go`)。

## 本地运行

```bash
go run ./cmd/lifelog export -demo          # 生成示例数据
cd web && npm install && npm run dev       # http://localhost:5173
```

接入真实数据:`cp .env.example .env`,填好后 `go run ./cmd/lifelog sync`,再 `export`。

### 用 PostgreSQL 和后台

```bash
brew install postgresql@17 && brew services start postgresql@17 && createdb lifelog
# .env 里加 DATABASE_URL=postgres:///lifelog 和 LIFELOG_ADMIN_PASSWORD=...
go run ./cmd/lifelog db import -env .env   # data/*.json 和 .env 里的配置导入数据库(要导入路线需先有 LIFELOG_MAP_ANSWER)
go run ./cmd/lifelog serve                 # 后台 API :8080,导出到 web/public/data.json
cd web && npm run dev                      # 后台:http://localhost:5173/admin/(/api 代理到 :8080)
```

`lifelog db dump -dir DIR` 把数据库导出成 JSON 文件;`go test ./internal/store` 加上 `LIFELOG_TEST_DATABASE_URL=postgres:///lifelog_test` 会跑数据库的往返测试。

## 各数据源

| 来源 | 方式 | 需要 |
|---|---|---|
| Strava | 官方 API | 在 [API 设置](https://www.strava.com/settings/api) 建应用(回调域填 `127.0.0.1`),`lifelog auth strava` 拿 refresh token |
| Garmin | 非官方,同 garth 的移动端登录流程 | `lifelog auth garmin` 本地登录一次(支持两步验证),得到 `GARMIN_TOKEN`(约一年有效);中国区加 `GARMIN_CN=true` |
| COROS 高驰 | 非官方 | 账号密码;中国区加 `COROS_CN=true` |
| Apple 健康 | iPhone 推送 | [Health Auto Export](https://apps.apple.com/app/id1115567069) 的 REST API 自动化推到 `https://域名/api/push/applehealth`:JSON、Export Version 2、打开 Include Route Data,请求头 `Authorization: Bearer <后台设置的推送密钥>` |
| Apple 健康(历史) | 本地导入 | 健康 App → 导出所有健康数据,在服务器上 `lifelog import applehealth export.xml`(没有路线) |
| running_page 历史 | 本地导入 | `lifelog import running-page <running_page 仓库>/src/static/activities.json`,与现有来源重叠的记录在导出时自动去重 |
| 多邻国 | 非官方 `xp_summaries` | 浏览器登录 duolingo.com,复制 `jwt_token` cookie |
| Spotify | 官方 API(只给最近 50 首) | 在 [Dashboard](https://developer.spotify.com/dashboard) 建应用,Redirect URI 填 `http://127.0.0.1:8888/callback`,`lifelog auth spotify`;历史记录在隐私设置里申请"扩展流媒体历史",用 `lifelog import spotify-history` 导入 |
| GitHub | GraphQL 贡献日历 | 一个有 `read:user` 权限的 token |

没配置的来源会自动跳过。某个来源失败不影响其他来源，后台的同步记录里能看到每次的日志。
用了数据库后,`lifelog auth ...` 拿到的 token 直接写进数据库;也可以在本地授权后到后台粘贴。

## 部署到 GitHub Pages

1. 推到 GitHub,Settings → Pages → Source 选 **GitHub Actions**
2. Settings → Secrets and variables → Actions,按 `.env.example` 添加 Secrets(`GARMIN_CN` / `COROS_CN` / `LIFELOG_TZ` 放 Variables)
3. Actions 里手动运行一次 **Sync & Deploy**,勾选 *full* 拉取全部历史

> ⚠️ 公开仓库会公开 `data/` 里的全部数据,包括跑步路线(可能暴露住址)。介意的话用私有仓库 + Vercel/Cloudflare Pages 部署,或在 export 时裁掉路线首尾。

## 部署到自己的服务器

见 [deploy/README.md](deploy/README.md):VPS 上跑 PostgreSQL 和 `lifelog serve`,定时同步、提供网站和后台(Let's Encrypt 自动续期)，并把数据备份回 GitHub,GitHub Pages 保留。

## 待验证 / 后续

- Garmin、COROS、多邻国都是非官方接口,字段和登录流程以真实账号测试为准;COROS 列表字段(距离、爬升单位)尤其需要核对。
- Garmin 的路线来自活动详情接口(每条一次请求，只在第一次同步时下载);COROS 暂未下载 FIT,所以没有路线。
- 可加:Keep / 悦跑圈、地图页(Leaflet)、年度海报 SVG、按月统计图。
