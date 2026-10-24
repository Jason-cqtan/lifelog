// Command lifelog syncs personal activity data into data/ and exports data.json
// for the web dashboard.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"
	_ "time/tzdata" // CI runners may lack zoneinfo

	"github.com/Jason-cqtan/lifelog/internal/export"
	"github.com/Jason-cqtan/lifelog/internal/source"
	"github.com/Jason-cqtan/lifelog/internal/source/applehealth"
	"github.com/Jason-cqtan/lifelog/internal/source/coros"
	"github.com/Jason-cqtan/lifelog/internal/source/duolingo"
	"github.com/Jason-cqtan/lifelog/internal/source/garmin"
	"github.com/Jason-cqtan/lifelog/internal/source/github"
	"github.com/Jason-cqtan/lifelog/internal/source/spotify"
	"github.com/Jason-cqtan/lifelog/internal/source/strava"
	"github.com/Jason-cqtan/lifelog/internal/store"
	"golang.org/x/term"
)

var sources = []source.Source{
	garmin.Garmin{},
	coros.Coros{},
	strava.Strava{},
	duolingo.Duolingo{},
	spotify.Spotify{},
	github.GitHub{},
}

const usage = `lifelog — 个人数据同步工具

用法:
  lifelog sync [-full] [source...]         同步已配置的数据源(默认全部): %s
  lifelog import applehealth export.xml    导入 Apple 健康导出的体能训练
  lifelog import spotify-history FILE...   导入 Spotify 隐私数据导出的播放历史
  lifelog export [-out PATH] [-demo]       生成前端用的 data.json
  lifelog auth strava|spotify|garmin       一次性授权,打印需要保存到 Secrets 的 token

环境变量: LIFELOG_DATA(默认 data) LIFELOG_TZ(默认 Asia/Shanghai),其余见 .env.example
`

func main() {
	loadDotEnv(".env")
	log.SetFlags(0)
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, usage, sourceNames())
		os.Exit(2)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	var err error
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "sync":
		err = runSync(ctx, args)
	case "import":
		err = runImport(args)
	case "export":
		err = runExport(args)
	case "auth":
		err = runAuth(ctx, args)
	default:
		fmt.Fprintf(os.Stderr, usage, sourceNames())
		os.Exit(2)
	}
	if err != nil {
		log.Fatal("error: ", err)
	}
}

func dataDir() string {
	if d := source.Getenv("LIFELOG_DATA"); d != "" {
		return d
	}
	return "data"
}

func location() *time.Location {
	name := source.Getenv("LIFELOG_TZ")
	if name == "" {
		name = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Fatalf("LIFELOG_TZ: %v", err)
	}
	return loc
}

func runSync(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("sync", flag.ExitOnError)
	full := fs.Bool("full", false, "re-fetch full history instead of only new data")
	fs.Parse(args)

	want := map[string]bool{}
	for _, n := range fs.Args() {
		want[n] = true
	}
	st, err := store.Open(dataDir())
	if err != nil {
		return err
	}
	env := &source.Env{
		Store: st,
		HTTP:  &http.Client{Timeout: 60 * time.Second},
		Loc:   location(),
		Full:  *full,
		Log:   log.Default(),
	}

	var failed []string
	for _, s := range sources {
		if len(want) > 0 && !want[s.Name()] {
			continue
		}
		if !s.Configured() {
			if len(want) > 0 {
				failed = append(failed, s.Name()+" (not configured)")
			} else {
				log.Printf("%s: skipped, not configured", s.Name())
			}
			continue
		}
		// One broken source (expired token, API change) must not block the others.
		if err := s.Sync(ctx, env); err != nil {
			log.Printf("%s: FAILED: %v", s.Name(), err)
			failed = append(failed, s.Name())
		}
	}
	if err := st.Save(); err != nil {
		return err
	}
	if len(failed) > 0 {
		return fmt.Errorf("sources failed: %s", strings.Join(failed, ", "))
	}
	return nil
}

func runImport(args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: lifelog import applehealth|spotify-history FILE...")
	}
	st, err := store.Open(dataDir())
	if err != nil {
		return err
	}
	for _, path := range args[1:] {
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

	loc := location()
	if *demo {
		return export.Write(*out, export.Demo(loc))
	}
	st, err := store.Open(dataDir())
	if err != nil {
		return err
	}
	o := export.Build(st, loc)
	log.Printf("export: %d activities, %d days -> %s", len(o.Activities), len(o.Daily), *out)
	return export.Write(*out, o)
}

func runAuth(ctx context.Context, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: lifelog auth strava|spotify|garmin")
	}
	c := &http.Client{Timeout: 30 * time.Second}
	switch args[0] {
	case "strava":
		return strava.Authorize(ctx, c)
	case "spotify":
		return spotify.Authorize(ctx, c)
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
		if err := setDotEnv(".env", "GARMIN_TOKEN", tok.Encode()); err != nil {
			return err
		}
		if domain == "garmin.cn" {
			if err := setDotEnv(".env", "GARMIN_CN", "true"); err != nil {
				return err
			}
		}
		fmt.Println("登录成功,GARMIN_TOKEN 已写入 .env(约一年有效)。")
		return nil
	}
	return fmt.Errorf("unknown provider %q", args[0])
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

func sourceNames() string {
	var names []string
	for _, s := range sources {
		names = append(names, s.Name())
	}
	return strings.Join(names, ", ")
}

// loadDotEnv sets KEY=VALUE lines from path without overriding real env vars,
// so local runs can keep secrets in an untracked .env file.
func loadDotEnv(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		k, v, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.Index(v, " #"); i >= 0 {
			v = v[:i] // inline comment
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set {
			os.Setenv(k, v)
		}
	}
}
