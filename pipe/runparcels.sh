#!/bin/bash
cd /home/claude/wt/map/pipe
for i in 1 2 3 4 5 6; do
  python3 parcels.py -1 >> /tmp/claude-0/-home-claude/5fb060cb-f47e-5b67-8c27-2d877dcdaaff/scratchpad/parcels_full3.log 2>&1
  [ -f parcels.pkl ] && break
done
