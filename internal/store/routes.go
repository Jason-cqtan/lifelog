package store

import (
	"bytes"
	"crypto/cipher"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/Jason-cqtan/lifelog/internal/seal"
)

// Routes never reach the repository in plain text: Save strips polylines from
// activities.json and keeps them in routes.json, each sealed on its own with
// the key derived from the map answer (package seal) and bound to its activity
// id. A route that hasn't changed keeps its ciphertext, so a sync only adds
// lines for new routes instead of rewriting the file.
const routesFile = "routes.json"

// checkText is sealed into routes.json so a wrong answer fails at Open, not halfway.
const checkText = "lifelog routes"

type sealedRoutes struct {
	Salt   []byte            `json:"salt"`
	Iter   int               `json:"iter"`
	Check  []byte            `json:"check"`
	Routes map[string][]byte `json:"routes"` // activity key -> nonce | ciphertext
}

type routeKeys struct {
	file   sealedRoutes
	aead   cipher.AEAD // nil: no answer given
	exists bool        // routes.json was there at Open
	prev   map[string]sealedRoute
}

type sealedRoute struct {
	plain string
	ct    []byte
}

// openRoutes reads routes.json and, with the answer, the polylines in it.
func openRoutes(dir, answer string) (*routeKeys, map[string]string, error) {
	k := &routeKeys{prev: map[string]sealedRoute{}}
	b, err := os.ReadFile(filepath.Join(dir, routesFile))
	switch {
	case errors.Is(err, os.ErrNotExist):
		if answer == "" {
			return k, nil, nil
		}
		k.file = sealedRoutes{Salt: seal.Salt(), Iter: seal.Iter}
		if k.aead, err = seal.Key(answer, k.file.Salt, k.file.Iter); err != nil {
			return nil, nil, err
		}
		k.file.Check = seal.Seal(k.aead, []byte(checkText), nil)
		return k, nil, nil
	case err != nil:
		return nil, nil, err
	}
	k.exists = true
	if err := json.Unmarshal(b, &k.file); err != nil {
		return nil, nil, fmt.Errorf("parse %s: %w", routesFile, err)
	}
	if answer == "" {
		return k, nil, nil // sealed and staying that way; Save leaves the file alone
	}
	if k.aead, err = seal.Key(answer, k.file.Salt, k.file.Iter); err != nil {
		return nil, nil, err
	}
	if c, err := seal.Open(k.aead, k.file.Check, nil); err != nil || string(c) != checkText {
		return nil, nil, fmt.Errorf("LIFELOG_MAP_ANSWER does not open data/%s", routesFile)
	}
	routes := map[string]string{}
	for id, ct := range k.file.Routes {
		p, err := seal.Open(k.aead, ct, []byte(id))
		if err != nil {
			return nil, nil, fmt.Errorf("data/%s: route %s: %w", routesFile, id, err)
		}
		routes[id] = string(p)
		k.prev[id] = sealedRoute{string(p), ct}
	}
	return k, routes, nil
}

// rekey switches to a new answer (fresh salt); every route is sealed again on Save.
func (k *routeKeys) rekey(answer string) error {
	k.file = sealedRoutes{Salt: seal.Salt(), Iter: seal.Iter}
	aead, err := seal.Key(answer, k.file.Salt, k.file.Iter)
	if err != nil {
		return err
	}
	k.aead = aead
	k.file.Check = seal.Seal(aead, []byte(checkText), nil)
	k.prev = map[string]sealedRoute{}
	return nil
}

// save writes routes.json for id -> polyline.
func (k *routeKeys) save(dir string, routes map[string]string) error {
	if k.aead == nil {
		if len(routes) > 0 {
			return errors.New("routes need LIFELOG_MAP_ANSWER: refusing to store them in plain text")
		}
		return nil // nothing new; a sealed routes.json stays as it is
	}
	if len(routes) == 0 && !k.exists {
		return nil
	}
	k.file.Routes = map[string][]byte{}
	for id, p := range routes {
		if old, ok := k.prev[id]; ok && old.plain == p {
			k.file.Routes[id] = old.ct
			continue
		}
		ct := seal.Seal(k.aead, []byte(p), []byte(id))
		k.file.Routes[id] = ct
		k.prev[id] = sealedRoute{p, ct}
	}

	// one route per line, sorted, so diffs show just the added ones
	ids := make([]string, 0, len(k.file.Routes))
	for id := range k.file.Routes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	head, _ := json.Marshal(struct {
		Salt  []byte `json:"salt"`
		Iter  int    `json:"iter"`
		Check []byte `json:"check"`
	}{k.file.Salt, k.file.Iter, k.file.Check})
	var buf bytes.Buffer
	buf.Write(head[:len(head)-1]) // reopen the object to append routes
	buf.WriteString(`,"routes":{` + "\n")
	for i, id := range ids {
		kb, _ := json.Marshal(id)
		vb, _ := json.Marshal(k.file.Routes[id])
		buf.Write(kb)
		buf.WriteString(":")
		buf.Write(vb)
		if i < len(ids)-1 {
			buf.WriteString(",")
		}
		buf.WriteString("\n")
	}
	buf.WriteString("}}\n")
	path := filepath.Join(dir, routesFile)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	k.exists = true
	return os.Rename(tmp, path)
}
