#!/bin/bash
# usage: shoot.sh name x z h pitch yaw [w h]
n=$1; W=${7:-960}; H=${8:-540}
python3 /home/claude/wt/map/wshot.py "http://127.0.0.1:5203/dev/world.html?x=$2&z=$3&h=$4&pitch=$5&yaw=$6&q=low&t=11" /home/claude/wt/map/shots_work/$n.png 6 400 $W $H > /home/claude/wt/map/shots_work/$n.log 2>&1
