// Package settings keeps the configuration that used to live in .env (source
// credentials, timezone, map lock, sync schedule) in the settings table, where
// the admin page edits it. Values there take precedence over the environment;
// see source.Getenv.
package settings

import (
	"context"
	"strings"

	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Kind string

const (
	Text   Kind = "text"
	Bool   Kind = "bool"
	Secret Kind = "secret" // write-only in the admin page
)

// Def describes one setting for the admin page.
type Def struct {
	Key     string `json:"key"`
	Group   string `json:"group"`
	Label   string `json:"label"`
	Help    string `json:"help,omitempty"`
	Kind    Kind   `json:"kind"`
	Default string `json:"default,omitempty"`
}

// Internal keys, managed by the server rather than shown as settings.
const (
	AdminPasswordHash = "_admin_password_hash"
	SessionKey        = "_session_key"
)

// SyncHours is when the server syncs every day, e.g. "8,13,22" (LIFELOG_TZ).
const SyncHours = "LIFELOG_SYNC_HOURS"

// GitBackup turns on pushing data/*.json to GitHub after each sync.
const GitBackup = "LIFELOG_GIT_BACKUP"

var Defs = []Def{
	{Key: "LIFELOG_TZ", Group: "通用", Label: "时区", Help: "按这个时区把记录归到日期", Kind: Text, Default: "Asia/Shanghai"},
	{Key: SyncHours, Group: "通用", Label: "每天同步时间(点)", Help: "逗号分隔的整点，如 8,13,22;留空则不自动同步。Spotify 只保留最近 50 首，间隔别太长", Kind: Text, Default: "8,13,22"},
	{Key: GitBackup, Group: "通用", Label: "同步后备份到 GitHub", Help: "把 data/*.json 提交并推送到仓库(GitHub Pages 跟着更新)", Kind: Bool, Default: "true"},

	{Key: "LIFELOG_MAP_QUESTION", Group: "地图", Label: "地图问题", Help: "访客看路线前要回答的问题", Kind: Text, Default: "站长姓氏？"},
	{Key: "LIFELOG_MAP_ANSWER", Group: "地图", Label: "地图答案", Help: "网站和 GitHub 备份里的路线都用它加密;留空则不导出路线", Kind: Secret},
	{Key: "VITE_MAPBOX_TOKEN", Group: "地图", Label: "Mapbox token", Help: "公开 token(pk.*),在 Mapbox 后台限制为你的域名", Kind: Text},
	{Key: "VITE_MAP_GCJ02", Group: "地图", Label: "路线转 GCJ-02", Help: "中国境内路线偏离道路时打开", Kind: Bool},

	{Key: "STRAVA_CLIENT_ID", Group: "Strava", Label: "Client ID", Kind: Text},
	{Key: "STRAVA_CLIENT_SECRET", Group: "Strava", Label: "Client Secret", Kind: Secret},
	{Key: "STRAVA_REFRESH_TOKEN", Group: "Strava", Label: "Refresh token", Help: "lifelog auth strava", Kind: Secret},

	{Key: "GARMIN_TOKEN", Group: "Garmin", Label: "Token", Help: "lifelog auth garmin,约一年有效", Kind: Secret},
	{Key: "GARMIN_CN", Group: "Garmin", Label: "中国区 (garmin.cn)", Kind: Bool},

	{Key: "COROS_ACCOUNT", Group: "COROS 高驰", Label: "账号", Kind: Text},
	{Key: "COROS_PASSWORD", Group: "COROS 高驰", Label: "密码", Kind: Secret},
	{Key: "COROS_CN", Group: "COROS 高驰", Label: "中国区", Kind: Bool},

	{Key: "DUOLINGO_JWT", Group: "多邻国", Label: "jwt_token", Help: "duolingo.com 的 jwt_token cookie", Kind: Secret},

	{Key: "SPOTIFY_CLIENT_ID", Group: "Spotify", Label: "Client ID", Kind: Text},
	{Key: "SPOTIFY_CLIENT_SECRET", Group: "Spotify", Label: "Client Secret", Kind: Secret},
	{Key: "SPOTIFY_REFRESH_TOKEN", Group: "Spotify", Label: "Refresh token", Help: "lifelog auth spotify", Kind: Secret},

	{Key: "GH_USERNAME", Group: "GitHub 贡献", Label: "用户名", Kind: Text},
	{Key: "GH_TOKEN", Group: "GitHub 贡献", Label: "Token", Help: "fine-grained token,无需仓库权限", Kind: Secret},
}

// Lookup returns the definition of key.
func Lookup(key string) (Def, bool) {
	for _, d := range Defs {
		if d.Key == key {
			return d, true
		}
	}
	return Def{}, false
}

// Load reads every stored value, internal keys included.
func Load(ctx context.Context, pool *pgxpool.Pool) (map[string]string, error) {
	rows, err := pool.Query(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// Apply loads the stored values and makes source.Getenv return them, falling
// back to each Def's default when neither the database nor the environment
// has a value.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	m, err := Load(ctx, pool)
	if err != nil {
		return err
	}
	cfg := map[string]string{}
	for _, d := range Defs {
		if v := strings.TrimSpace(m[d.Key]); v != "" {
			cfg[d.Key] = v
		}
	}
	source.SetConfig(cfg, defaults())
	return nil
}

func defaults() map[string]string {
	out := map[string]string{}
	for _, d := range Defs {
		if d.Default != "" {
			out[d.Key] = d.Default
		}
	}
	return out
}

// Set stores value for key; an empty value removes it.
func Set(ctx context.Context, pool *pgxpool.Pool, key, value string) error {
	if value == "" {
		_, err := pool.Exec(ctx, `DELETE FROM settings WHERE key = $1`, key)
		return err
	}
	_, err := pool.Exec(ctx, `INSERT INTO settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}
