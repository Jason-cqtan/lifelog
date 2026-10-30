-- Applied by db.Migrate on every start; each statement must be safe to re-run.

CREATE TABLE IF NOT EXISTS activities (
	source           text NOT NULL,
	source_id        text NOT NULL,
	type             text NOT NULL,
	raw_type         text NOT NULL DEFAULT '',
	name             text NOT NULL DEFAULT '',
	start_time       timestamptz NOT NULL,
	distance_m       double precision NOT NULL DEFAULT 0,
	moving_time_s    integer NOT NULL DEFAULT 0,
	elapsed_time_s   integer NOT NULL DEFAULT 0,
	elevation_gain_m double precision NOT NULL DEFAULT 0,
	avg_hr           double precision NOT NULL DEFAULT 0,
	avg_cadence      double precision NOT NULL DEFAULT 0,
	stride_m         double precision NOT NULL DEFAULT 0,
	-- plain text here: the database is private; routes are sealed only where they leave it
	-- (data/routes.json backup and the site's routes.enc)
	polyline         text NOT NULL DEFAULT '',
	weather          jsonb,
	best_efforts     jsonb,
	updated_at       timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (source, source_id)
);
CREATE INDEX IF NOT EXISTS activities_start_time ON activities (start_time);

CREATE TABLE IF NOT EXISTS daily_metrics (
	date       date NOT NULL,
	source     text NOT NULL,
	metric     text NOT NULL,
	value      double precision NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (date, source, metric)
);

CREATE TABLE IF NOT EXISTS plays (
	played_at timestamptz NOT NULL,
	track     text NOT NULL,
	artist    text NOT NULL DEFAULT '',
	track_id  text NOT NULL DEFAULT '',
	ms_played bigint NOT NULL DEFAULT 0,
	PRIMARY KEY (played_at, track)
);

-- whole documents replaced on each sync (Spotify top lists, Duolingo courses);
-- json, not jsonb, keeps them byte for byte so the data/ backup doesn't churn
CREATE TABLE IF NOT EXISTS snapshots (
	name       text PRIMARY KEY,
	data       json NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- what used to live in .env: source credentials, timezone, map lock, schedule
CREATE TABLE IF NOT EXISTS settings (
	key        text PRIMARY KEY,
	value      text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
	id          bigserial PRIMARY KEY,
	trigger     text NOT NULL,             -- schedule | admin | cli
	sources     text NOT NULL DEFAULT '',  -- empty: all configured
	started_at  timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz,
	status      text NOT NULL DEFAULT 'running', -- running | ok | partial | failed
	log         text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sync_runs_started_at ON sync_runs (started_at DESC);
