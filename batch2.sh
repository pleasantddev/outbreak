#!/bin/bash
cd /home/claude/wt/perf
U="http://127.0.0.1:5217/?auto=1&t=12&w=clear&q=low"
for k in danfo jeep police; do
  MODES=ext,cockpit SEATS=0 timeout 800 python3 seat.py "$U" shots_review/cars $k 800 450 0 2>&1 | grep -E "^shot|rror" | cut -c1-200
done
echo DONE
