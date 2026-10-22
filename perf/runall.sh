#!/bin/bash
# runall.sh port prefix : probe the three tiers on three poses
PORT=$1; PFX=$2
cd /home/claude/wt/perf2
for q in low medium high; do
  flock /tmp/hl-browser.lock timeout 1500 python3 perf/probe.py "http://127.0.0.1:$PORT/?auto=1&q=$q" ${PFX}_$q 640 360 perf/poses3.json > /tmp/claude-0/probe_${PFX}_$q.log 2>&1
done
echo done > /tmp/claude-0/probe_${PFX}.done
