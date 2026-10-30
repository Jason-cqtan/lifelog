// Command lifelog syncs personal activity data into data/ and exports data.json
// for the web dashboard.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // CI runners may lack zoneinfo

	"github.com/Jason-cqtan/lifelog/internal/app"
	"github.com/Jason-cqtan/lifelog/internal/export"
	"github.com/Jason-cqtan/lifelog/internal/oauth"
	"github.com/Jason-cqtan/lifelog/internal/server"
	"github.com/Jason-cqtan/lifelog/internal/settings"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/source/applehealth"
	"github.com/Jason-cqtan/lifelog/internal/source/duolingo"
	"github.com/Jason-cqtan/lifelog/internal/source/garmin"
	"github.com/Jason-cqtan/lifelog/internal/source/joyrun"
	"github.com/Jason-cqtan/lifelog/internal/source/runningpage"
	"github.com/Jason-cqtan/lifelog/internal/source/spotify"
	"github.com/Jason-cqtan/lifelog/internal/source/strava"
	"github.com/Jason-cqtan/lifelog/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/term"
)

// pool is the database when DATABASE_URL is set; nil means the JSON files in data/.
var pool *pgxpool.Pool

const usage = `lifelog — 个人数据同步工具

用法:
  lifelog sync [-full] [source...]         同步已配置的数据源(默认全部): %s
  lifelog import applehealth export.xml    导入 Apple 健康导出的体能训练
  lifelog import spotify-history FILE...   导入 Spotify 隐私数据导出的播放历史
  lifelog import joyrun                    从悦跑圈下载轨迹，补算 running_page 导入跑步的分段最佳(短信验证码登录)
  lifelog import running-page activities.json [-gpx GPX_OUT]  导入 running_page 的历史记录(带 GPX 时计算分段最佳)
  lifelog export [-out PATH] [-demo]       生成前端用的 data.json
  lifelog auth strava|spotify|garmin|duolingo  一次性授权,token 写入数据库(未配置数据库时写入 .env)
  lifelog seal [-old ANSWER]               把路线加密存入 data/routes.json;-old 用于更换答案(用旧答案打开,新答案重新加密)
  lifelog serve [-addr ADDR] [-www DIR] [-repo DIR] [-compress SCRIPT]  后台管理 + 定时同步(需要数据库)
  lifelog db import [-dir data] [-env .env]  把 data/*.json 和 .env 里的配置导入数据库(可重复运行)
  lifelog db dump [-dir data]              把数据库导出成 data/*.json(路线用地图答案加密)

设置了 DATABASE_URL 时数据和配置都在 PostgreSQL 里，配置在后台管理页修改;否则用 data/ 和 .env。
环境变量: DATABASE_URL LIFELOG_ADMIN_PASSWORD LIFELOG_DATA(默认 data) LIFELOG_TZ(默认 Asia/Shanghai),其余见 .env.example
`

func main() {
	loadDotEnv(".env")
	log.SetFlags(0)
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, sourceNames())
		os.Exit(2)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	var err error
	if pool, err = app.ConnectDB(ctx); err != nil {
		log.Fatal("error: ", err)
	}
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "sync":
		err = runSync(ctx, args)
	case "import":
		err = runImport(args)
	case "export":
		err = runExport(args)
	case "auth":
		err = runAuth(ctx, args)
	case "seal":
		err = runSeal(args)
	case "serve":
		err = runServe(ctx, args)
	case "db":
		err = runDB(ctx, args)
	default:
		fmt.Fprintf(os.Stderr, usage, sourceNames())
		os.Exit(2)
	}
	if err != nil {
		log.Fatal("error: ", err)
	}
}

func location() *time.Location {
	loc, err := app.Location()
	if err != nil {
		log.Fatal(err)
	}
	return loc
}

func openStore() (*store.Store, error) { return app.OpenStore(context.Background(), pool) }

func runSync(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("sync", flag.ExitOnError)
	full := fs.Bool("full", false, "re-fetch full history instead of only new data")
	fs.Parse(args)

	st, err := openStore()
	if err != nil {
		return err
	}
	failed, err := app.Sync(ctx, st, fs.Args(), *full, log.Default())
	if err != nil {
		return err
	}
	if len(failed) > 0 {
		return fmt.Errorf("sources failed: %s", strings.Join(failed, ", "))
	}
	return nil
}

func runImport(args []string) error {
	if len(args) >= 1 && args[0] == "joyrun" {
		return importJoyrun()
	}
	if len(args) < 2 {
		return fmt.Errorf("usage: lifelog import applehealth|spotify-history|running-page FILE...")
	}
	st, err := openStore()
	if err != nil {
		return err
	}
	// running-page takes an optional "-gpx DIR" (its GPX_OUT) for best efforts
	var gpxDir string
	files := args[1:]
	for i := 0; i < len(files); i++ {
		if files[i] == "-gpx" && i+1 < len(files) {
			gpxDir = files[i+1]
			files = append(files[:i:i], files[i+2:]...)
			break
		}
	}
	for _, path := range files {
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		var n int
		switch args[0] {
		case "applehealth":
			n, err = applehealth.Import(bufio.NewReaderSize(f, 1<<20), st)
		case "spotify-history":
			n, err = spotify.ImportHistory(f, st)
		case "running-page":
			n, err = runningpage.Import(f, st, gpxDir)
		default:
			err = fmt.Errorf("unknown importer %q", args[0])
		}
		f.Close()
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		log.Printf("%s: %d new records", path, n)
	}
	return st.Save()
}

func runExport(args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	out := fs.String("out", "web/public/data.json", "output path")
	demo := fs.Bool("demo", false, "write generated sample data instead of real data")
	fs.Parse(args)

	if *demo {
		return export.Write(*out, export.Demo(location()), &export.Lock{Question: "演示数据，答案是 demo", Answer: "demo"})
	}
	st, err := openStore()
	if err != nil {
		return err
	}
	return app.Export(st, *out, log.Default())
}

// runSeal rewrites data/ so every route sits sealed in routes.json: it moves
// plain-text polylines out of activities.json, and with -old re-seals under the
// current LIFELOG_MAP_ANSWER after the answer changed.
func runSeal(args []string) error {
	fs := flag.NewFlagSet("seal", flag.ExitOnError)
	old := fs.String("old", "", "previous answer, when changing it")
	fs.Parse(args)
	if pool != nil {
		return errors.New("seal works on data/ only; the database keeps routes itself and `db dump` seals them on the way out")
	}
	answer := source.Getenv("LIFELOG_MAP_ANSWER")
	if answer == "" {
		return errors.New("set LIFELOG_MAP_ANSWER first")
	}
	open := answer
	if *old != "" {
		open = *old
	}
	st, err := store.Open(app.DataDir(), open)
	if err != nil {
		return err
	}
	if *old != "" {
		if err := st.Rekey(answer); err != nil {
			return err
		}
	}
	n := 0
	for _, a := range st.Activities() {
		if a.Polyline != "" {
			n++
		}
	}
	log.Printf("seal: %d routes sealed in %s", n, filepath.Join(app.DataDir(), "routes.json"))
	return st.Save()
}

func runAuth(ctx context.Context, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: lifelog auth strava|spotify|garmin|duolingo")
	}
	c := &http.Client{Timeout: 30 * time.Second}
	switch args[0] {
	case "strava":
		return oauthApp(ctx, "STRAVA", "https://www.strava.com/settings/api", strava.Authorize)
	case "spotify":
		return oauthApp(ctx, "SPOTIFY", "https://developer.spotify.com/dashboard", spotify.Authorize)
	case "duolingo":
		fmt.Println("在浏览器登录 duolingo.com → 开发者工具 → Application/存储 → Cookies → 复制 jwt_token 的值")
		fmt.Print("粘贴 jwt_token(输入不显示): ")
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return err
		}
		jwt := strings.Trim(strings.TrimSpace(string(b)), `"`)
		exp, err := duolingo.Check(ctx, c, jwt)
		if err != nil {
			return fmt.Errorf("token 无效: %w", err)
		}
		if err := saveSetting("DUOLINGO_JWT", jwt); err != nil {
			return err
		}
		if exp.IsZero() {
			fmt.Println("验证成功,DUOLINGO_JWT 已写入" + settingsHome() + "。")
		} else {
			fmt.Printf("验证成功,DUOLINGO_JWT 已写入%s(有效期至 %s)。\n", settingsHome(), exp.Format("2006-01-02"))
		}
		return nil
	case "garmin":
		in := bufio.NewReader(os.Stdin)
		prompt := func(label, env string) string {
			if v := source.Getenv(env); v != "" {
				return v
			}
			fmt.Print(label)
			s, _ := in.ReadString('\n')
			return strings.TrimSpace(s)
		}
		domain := garmin.Domain()
		if source.Getenv("GARMIN_CN") == "" && strings.EqualFold(prompt("是否为中国区账号 (garmin.cn)? [y/N]: ", ""), "y") {
			domain = "garmin.cn"
		}
		fmt.Println("Garmin 区域:", domain)
		email := prompt("Garmin 邮箱: ", "GARMIN_EMAIL")
		password := source.Getenv("GARMIN_PASSWORD")
		if password == "" {
			fmt.Print("Garmin 密码(输入不显示): ")
			b, err := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Println()
			if err != nil {
				return err
			}
			password = string(b)
		}
		tok, err := garmin.Login(ctx, email, password, domain, func() (string, error) {
			return prompt("两步验证码: ", ""), nil
		})
		if err != nil {
			return err
		}
		// The token is a credential: keep it out of the terminal and in the untracked .env.
		if err := saveSetting("GARMIN_TOKEN", tok.Encode()); err != nil {
			return err
		}
		if domain == "garmin.cn" {
			if err := saveSetting("GARMIN_CN", "true"); err != nil {
				return err
			}
		}
		fmt.Println("登录成功,GARMIN_TOKEN 已写入" + settingsHome() + "(约一年有效)。")
		return nil
	}
	return fmt.Errorf("unknown provider %q", args[0])
}

// oauthApp asks for the developer app's credentials if .env lacks them, runs the
// browser authorization, and saves all three values to .env without echoing them.
func oauthApp(ctx context.Context, prefix, dashboard string, authorize func(context.Context, *http.Client, string, string) (string, error)) error {
	id, secret := source.Getenv(prefix+"_CLIENT_ID"), source.Getenv(prefix+"_CLIENT_SECRET")
	if id == "" || secret == "" {
		fmt.Println("先在 " + dashboard + " 创建应用,回调地址填 " + oauth.RedirectURI)
		fmt.Print("Client ID: ")
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		id = strings.TrimSpace(line)
		fmt.Print("Client Secret(输入不显示): ")
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return err
		}
		secret = strings.TrimSpace(string(b))
	}
	c := &http.Client{Timeout: 30 * time.Second}
	refresh, err := authorize(ctx, c, id, secret)
	if err != nil {
		return err
	}
	for k, v := range map[string]string{"_CLIENT_ID": id, "_CLIENT_SECRET": secret, "_REFRESH_TOKEN": refresh} {
		if err := saveSetting(prefix+k, v); err != nil {
			return err
		}
	}
	fmt.Println("授权成功," + prefix + "_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN 已写入" + settingsHome() + "。")
	return nil
}

var mainlandMobile = regexp.MustCompile(`^1\d{10}$`)

// importJoyrun logs in to 悦跑圈 with an SMS code and attaches best efforts from
// its tracks to the matching runs imported from running_page (same run IDs).
func importJoyrun() error {
	ctx := context.Background()
	in := bufio.NewReader(os.Stdin)
	ask := func(label, env string) string {
		if v := source.Getenv(env); v != "" {
			return v
		}
		fmt.Print(label)
		s, _ := in.ReadString('\n')
		return strings.TrimSpace(s)
	}
	fmt.Println("先在悦跑圈 App 的登录页用手机号点「获取验证码」(不要用它登录 App),再把收到的验证码填在这里。")
	phone := strings.TrimPrefix(strings.ReplaceAll(ask("手机号: ", "JOYRUN_PHONE"), " ", ""), "+86")
	// a mistyped number makes Joyrun answer "Verification code error", so check first
	if !mainlandMobile.MatchString(phone) {
		return fmt.Errorf("手机号应为 11 位数字(以 1 开头),输入的是 %d 位", len(phone))
	}
	code := ask("短信验证码: ", "")

	st, err := openStore()
	if err != nil {
		return err
	}
	c := &joyrun.Client{HTTP: &http.Client{Timeout: 60 * time.Second}}
	if err := c.Login(ctx, phone, code); err != nil {
		return err
	}
	ids, err := c.RunIDs(ctx)
	if err != nil {
		return err
	}
	log.Printf("joyrun: %d runs in the account", len(ids))
	updated, noTrack := 0, 0
	var unmatched []string
	for _, id := range ids {
		act, ok := st.Activity("running_page:" + id)
		if !ok {
			unmatched = append(unmatched, id)
			continue
		}
		run, err := c.Run(ctx, id)
		if err != nil {
			return err
		}
		time.Sleep(300 * time.Millisecond) // be gentle with an unofficial API
		if len(run.Efforts) == 0 {
			noTrack++
			continue
		}
		act.BestEfforts = run.Efforts
		st.UpsertActivity(act)
		updated++
	}
	log.Printf("joyrun: best efforts for %d runs; %d without a usable track; %d not in data (skipped)", updated, noTrack, len(unmatched))
	return st.Save()
}

// saveSetting stores a credential from `lifelog auth`: in the database when
// there is one (the admin page shows it), else in the untracked .env.
func saveSetting(key, value string) error {
	if pool != nil {
		return settings.Set(context.Background(), pool, key, value)
	}
	return setDotEnv(".env", key, value)
}

func settingsHome() string {
	if pool != nil {
		return "数据库"
	}
	return " .env"
}

// setDotEnv sets key=value in path, replacing an existing line for key.
func setDotEnv(path, key, value string) error {
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var lines []string
	replaced := false
	for _, line := range strings.Split(strings.TrimRight(string(b), "\n"), "\n") {
		if k, _, ok := strings.Cut(line, "="); ok && strings.TrimSpace(k) == key {
			line, replaced = key+"="+value, true
		}
		if line != "" || len(lines) > 0 {
			lines = append(lines, line)
		}
	}
	if !replaced {
		lines = append(lines, key+"="+value)
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}

func sourceNames() string { return strings.Join(app.SourceNames(), ", ") }

func runServe(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", "127.0.0.1:8080", "listen address (put Caddy in front)")
	www := fs.String("www", "web/public", "site directory: data.json and routes.enc are written here")
	repo := fs.String("repo", "", "git checkout to push data/ backups from (empty: no backup)")
	compress := fs.String("compress", "", "script that writes .br/.zst/.gz copies of data.json (deploy/compress.sh)")
	fs.Parse(args)
	if pool == nil {
		return errors.New("serve needs DATABASE_URL")
	}
	return server.New(pool, server.Options{WWW: *www, Repo: *repo, Compress: *compress}).Run(ctx, *addr)
}

func runDB(ctx context.Context, args []string) error {
	if pool == nil {
		return errors.New("set DATABASE_URL first")
	}
	if len(args) == 0 {
		return errors.New("usage: lifelog db import|dump")
	}
	fs := flag.NewFlagSet("db "+args[0], flag.ExitOnError)
	dir := fs.String("dir", app.DataDir(), "JSON data directory (import: empty to import settings only)")
	envFile := fs.String("env", "", "also import settings from this .env file, replacing stored values")
	fs.Parse(args[1:])
	answer := source.Getenv("LIFELOG_MAP_ANSWER")
	switch args[0] {
	case "import":
		if *envFile != "" {
			n, err := importEnv(ctx, *envFile)
			if err != nil {
				return err
			}
			log.Printf("settings: %d imported from %s", n, *envFile)
			answer = source.Getenv("LIFELOG_MAP_ANSWER")
		}
		if *dir == "" {
			return nil
		}
		files, err := store.Open(*dir, answer)
		if err != nil {
			return err
		}
		st, err := files.ImportInto(ctx, pool)
		if err != nil {
			return err
		}
		routes := 0
		for _, a := range st.Activities() {
			if a.Polyline != "" {
				routes++
			}
		}
		log.Printf("db: %d activities (%d with routes), %d daily values, %d plays in the database",
			len(st.Activities()), routes, len(st.Daily()), len(st.Plays()))
		if routes == 0 && answer == "" {
			log.Printf("db: no routes imported: set LIFELOG_MAP_ANSWER to open data/routes.json")
		}
		return nil
	case "dump":
		st, err := store.OpenDB(ctx, pool)
		if err != nil {
			return err
		}
		log.Printf("db: writing %d activities to %s", len(st.Activities()), *dir)
		return st.WriteFiles(*dir, answer)
	}
	return fmt.Errorf("unknown db command %q", args[0])
}

// importEnv copies the known, non-empty settings in a .env file into the
// database, replacing what is stored for those keys.
func importEnv(ctx context.Context, path string) (int, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	n := 0
	for k, v := range parseDotEnv(b) {
		if _, known := settings.Lookup(k); !known || v == "" {
			continue
		}
		if err := settings.Set(ctx, pool, k, v); err != nil {
			return n, err
		}
		n++
	}
	return n, settings.Apply(ctx, pool)
}

// loadDotEnv sets KEY=VALUE lines from path without overriding real env vars,
// so local runs can keep secrets in an untracked .env file.
func loadDotEnv(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for k, v := range parseDotEnv(b) {
		if _, set := os.LookupEnv(k); !set {
			os.Setenv(k, v)
		}
	}
}

func parseDotEnv(b []byte) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.Index(v, " #"); i >= 0 {
			v = v[:i] // inline comment
		}
		out[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
	}
	return out
}
