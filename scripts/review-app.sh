#!/usr/bin/env bash
# Serve one commit of koejon for the human-review plugin (human-review.json, steps.video.app).
#   review-app.sh up <sha>         build that commit and serve it; prints the URL
#   review-app.sh url <shortsha>   print the URL of a running instance
#   review-app.sh down <shortsha>  stop it
# HEAD builds in place; another commit is checked out in a detached worktree first.
# The build allows ?seed= (VITE_ALLOW_SEED=1, src/lib/seed.ts): it is a local review
# build, never deployed. It talks to the local Firebase emulator only, never to the live
# project: without an emulator the app plays solo offline, which is all a film needs.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
APPS="$ROOT/.human-review/.apps"
cmd="${1:?up|url|down}"; ref="${2:?sha}"

case "$cmd" in
  up)
    short="$(git rev-parse --short "$ref")"
    dir="$APPS/$short"; mkdir -p "$dir"
    src="$ROOT"
    if [ "$(git rev-parse "$ref")" != "$(git rev-parse HEAD)" ]; then
      src="$dir/src"
      # A deleted .human-review/ leaves the worktree registered; prune forgets it.
      git worktree prune
      [ -e "$src/.git" ] || git worktree add --detach "$src" "$ref" >&2
      ln -sfn "$ROOT/node_modules" "$src/node_modules"
    fi
    (cd "$src" && VITE_ALLOW_SEED=1 VITE_USE_FIREBASE_EMULATOR=true \
      npx vite build --outDir "$dir/dist" --emptyOutDir >&2)
    port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
    # Redirect the whole background group: a caller that captures our stdout
    # (run-steps.py) would otherwise wait for the server to exit.
    (cd "$src" && exec npx vite preview --outDir "$dir/dist" --host 127.0.0.1 --port "$port" --strictPort) \
      > "$dir/preview.log" 2>&1 < /dev/null &
    echo $! > "$dir/pid"
    echo "$port" > "$dir/port"
    up=""
    for _ in $(seq 150); do
      if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then up=1; break; fi
      sleep 0.2
    done
    if [ -z "$up" ]; then
      echo "vite preview did not answer on port $port:" >&2
      tail -20 "$dir/preview.log" >&2
      exit 1
    fi
    echo "http://127.0.0.1:$port"
    ;;
  url)
    dir="$APPS/$ref"
    if [ -f "$dir/port" ]; then echo "http://127.0.0.1:$(cat "$dir/port")"; fi
    ;;
  down)
    dir="$APPS/$ref"
    if [ -f "$dir/pid" ]; then kill "$(cat "$dir/pid")" 2>/dev/null || true; fi
    # npx starts vite as a child; stop that too.
    pkill -f "vite preview --outDir $dir/dist" 2>/dev/null || true
    rm -f "$dir/pid" "$dir/port"
    if [ -e "$dir/src/.git" ]; then git worktree remove --force "$dir/src" 2>/dev/null || true; fi
    ;;
esac
