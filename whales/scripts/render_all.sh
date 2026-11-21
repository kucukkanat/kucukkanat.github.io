#!/bin/zsh
# Render turnaround stills + cruise MP4 for every built whale.
cd "${0:A:h}/.."
B=/Applications/Blender.app/Contents/MacOS/Blender
mkdir -p renders
for sp in blue sperm beluga humpback bowhead minke; do for st in A B; do
  $B -b out/blend/${sp}_$st.blend --python scripts/render_whale.py -- renders/${sp}_$st both 1280 > /dev/null 2>&1 && echo "done ${sp}_$st" || echo "FAILED ${sp}_$st"
done; done
echo ALL_RENDERS_DONE
