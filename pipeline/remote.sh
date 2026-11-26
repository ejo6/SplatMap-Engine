#!/usr/bin/env bash
# Laptop -> GPU box -> laptop in one command. Copies pipeline/ and config/ and the clip to the box, runs
# pipeline/run.py there (detached, so a dropped ssh doesn't kill it), streams its progress, then copies the
# packaged world into worlds/<id>/ and run.json + qa/ into work/<id>/.
#   pipeline/remote.sh <user@host:port> clip.mp4 [run.py args...]     e.g. --preset fast --set S4.steps=50000
#   pipeline/remote.sh <user@host:port> --id <id> [run.py args...]    re-run stages of a clip already on the box
# Env: GPU=<index> picks the GPU (CUDA_VISIBLE_DEVICES), SSH_OPTS="-i $HOME/.ssh/id_ed25519" extra ssh options.
set -euo pipefail
[ $# -ge 2 ] || { sed -n 2,7p "$0"; exit 1; }
TARGET=$1; shift
HOST=${TARGET%:*}; PORT=22; [[ $TARGET == *:* ]] && PORT=${TARGET##*:}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=/workspace; SSH="ssh -p $PORT ${SSH_OPTS:-} $HOST"; RSH="ssh -p $PORT ${SSH_OPTS:-}"

ARGS=()
if [ -f "$1" ]; then
  CLIP=$1; shift
  ID=$(basename "${CLIP%.*}")
  rsync -t -e "$RSH" "$CLIP" "$HOST:$W/uploads/"
  ARGS+=(--video "$W/uploads/$(basename "$CLIP")")
fi
ARGS+=("$@")
for ((i = 0; i < ${#ARGS[@]} - 1; i++)); do [ "${ARGS[i]}" = --id ] && ID=${ARGS[i+1]}; done
[ -n "${ID:-}" ] || { echo "give a clip file or --id"; exit 1; }

rsync -rlt --delete --exclude __pycache__ -e "$RSH" "$ROOT/pipeline" "$ROOT/config" "$HOST:$W/repo/"
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- pipeline config || echo -dirty)
OUT=$W/work/$ID
PID=$($SSH "mkdir -p $OUT && cd $W/repo && PIPELINE_COMMIT=$COMMIT ${GPU:+CUDA_VISIBLE_DEVICES=$GPU} nohup \
  $W/envs/recon/bin/python pipeline/run.py --work-root $W/work $(printf '%q ' "${ARGS[@]}") \
  > $OUT/run.out 2> $OUT/run.err < /dev/null & echo \$!")
echo "running on $HOST as pid $PID (log: $OUT/run.out, $OUT/run.err)"
$SSH "tail --pid=$PID -n +1 -f $OUT/run.out" || echo "lost the connection; the run continues on the box"

if $SSH "tail -1 $OUT/run.out" | grep -q '"error"'; then
  $SSH "tail -30 $OUT/run.err"
  exit 1
fi
mkdir -p "$ROOT/worlds" "$ROOT/work/$ID"
rsync -rlt -e "$RSH" --exclude world.spz "$HOST:$W/repo/worlds/$ID" "$ROOT/worlds/" || echo "no packaged world (S9a not run)"
rsync -rlt -e "$RSH" "$HOST:$OUT/run.json" "$HOST:$OUT/qa" "$ROOT/work/$ID/" 2>/dev/null || true
echo "done: worlds/$ID  (npm --prefix web run dev, then open http://localhost:5173/w/$ID)"
