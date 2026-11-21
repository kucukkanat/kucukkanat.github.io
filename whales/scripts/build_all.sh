#!/bin/zsh
# Rebuild all 12 sky whales (model, rig, animation, textures) -> whales/out/{blend,glb,textures}.  ~6 min.
cd "${0:A:h}/.."
B=/Applications/Blender.app/Contents/MacOS/Blender
for sp in ${@:-blue sperm beluga humpback bowhead minke}; do for st in A B; do
  $B -b --python scripts/build_whale2.py -- $sp $st . 2>&1 | grep -E "BUILT|Error|Traceback" || echo "FAILED ${sp}_$st"
done; done
