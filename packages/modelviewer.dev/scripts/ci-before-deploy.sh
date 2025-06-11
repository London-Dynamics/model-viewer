#!/bin/bash

##
# Copyright 2020 Google Inc. All Rights Reserved.
# Licensed under the Apache License, Version 2.0 (the 'License');
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an 'AS IS' BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
##

set -e
set -x

# Switch to the package root
pushd "$(dirname "$0")/.."

PACKAGE_ROOT=$(pwd)
DEPLOY_ROOT="$PACKAGE_ROOT/dist"

# Files and directories to include
DEPLOYABLE_STATIC_FILES=(
  index.html
  assets
  data
  docs
  examples
  lib
  styles
  ATTRIBUTIONS.md
  CNAME
  LICENSE
  README.md
  shared-assets/models/*.*
  shared-assets/models/twitter
  shared-assets/models/glTF-Sample-Assets/Models/AlphaBlendModeTest
  shared-assets/models/glTF-Sample-Assets/Models/AntiqueCamera
  shared-assets/models/glTF-Sample-Assets/Models/BoomBox
  shared-assets/models/glTF-Sample-Assets/Models/BoxTextured
  shared-assets/models/glTF-Sample-Assets/Models/BrainStem
  shared-assets/models/glTF-Sample-Assets/Models/Corset
  shared-assets/models/glTF-Sample-Assets/Models/Cube
  shared-assets/models/glTF-Sample-Assets/Models/DamagedHelmet
  shared-assets/models/glTF-Sample-Assets/Models/Duck
  shared-assets/models/glTF-Sample-Assets/Models/FlightHelmet
  shared-assets/models/glTF-Sample-Assets/Models/Lantern
  shared-assets/models/glTF-Sample-Assets/Models/MaterialsVariantsShoe
  shared-assets/models/glTF-Sample-Assets/Models/MetalRoughSpheresNoTextures
  shared-assets/models/glTF-Sample-Assets/Models/Suzanne
  shared-assets/models/glTF-Sample-Assets/Models/SpecGlossVsMetalRough
  shared-assets/models/glTF-Sample-Assets/Models/ToyCar
  shared-assets/models/glTF-Sample-Assets/Models/WaterBottle
  shared-assets/environments
  shared-assets/icons
)

# Dynamically add all HTML files from examples/ and docs/
mapfile -t FOUND_HTML_FILES < <(find examples docs -name '*.html')
DEPLOYABLE_STATIC_FILES+=( "${FOUND_HTML_FILES[@]}" )

function copyToDeployRoot {
  local src_path="$1"
  local dest_path="$DEPLOY_ROOT/$src_path"

  echo "📁 Copying: $src_path → $dest_path"

  if [ -d "$src_path" ]; then
    mkdir -p "$dest_path"
    cp -a "$src_path/." "$dest_path/"
  elif [ -f "$src_path" ]; then
    mkdir -p "$(dirname "$dest_path")"
    cp "$src_path" "$dest_path"
  else
    echo "❌ Path not found: $src_path"
    exit 1
  fi
}

# Prepare deploy root
mkdir -p "$DEPLOY_ROOT"
touch "$DEPLOY_ROOT/.nojekyll"

# Copy everything in the list
for static in "${DEPLOYABLE_STATIC_FILES[@]}"; do
  copyToDeployRoot "$static"
done

# Additional fidelity and space-opera files
mkdir -p "$DEPLOY_ROOT/fidelity"
mkdir -p "$DEPLOY_ROOT/editor/view"
mkdir -p "$DEPLOY_ROOT/vendor/@google/model-viewer/dist"
mkdir -p "$DEPLOY_ROOT/vendor/@google/model-viewer-effects/dist"
mkdir -p "$DEPLOY_ROOT/vendor/js-beautify"
mkdir -p "$DEPLOY_ROOT/vendor/web-animations-js"

cp examples/fidelity.html "$DEPLOY_ROOT/fidelity/index.html"
cp ../space-opera/editor/index.html "$DEPLOY_ROOT/editor/"
cp ../space-opera/editor/view/index.html "$DEPLOY_ROOT/editor/view/"
cp ../space-opera/dist/space-opera.js "$DEPLOY_ROOT/space-opera.js"
cp ../model-viewer/dist/* "$DEPLOY_ROOT/vendor/@google/model-viewer/dist/"
cp ../model-viewer-effects/dist/* "$DEPLOY_ROOT/vendor/@google/model-viewer-effects/dist/"
cp -r ../../node_modules/js-beautify/* "$DEPLOY_ROOT/vendor/js-beautify/"
cp -r ../../node_modules/web-animations-js/* "$DEPLOY_ROOT/vendor/web-animations-js/"

echo "📄 All HTML files in dist:"
find "$DEPLOY_ROOT" -name '*.html' | sort

FILES_TO_PATCH_WITH_MINIFIED_BUNDLE=($(find "$DEPLOY_ROOT" -type f -name '*.html'))

echo "🛠 Patching ${#FILES_TO_PATCH_WITH_MINIFIED_BUNDLE[@]} HTML files..."

for file_to_patch in "${FILES_TO_PATCH_WITH_MINIFIED_BUNDLE[@]}"; do
  echo "🔧 Patching: $file_to_patch"

  # Replace paths like ../../node_modules/... with vendor/
  sed -i.bak 's|\(\.\./\)*node_modules/|vendor/|g' "$file_to_patch"
  rm "$file_to_patch.bak"

  # Replace unminified JS with minified ones
  sed -i.bak 's|model-viewer\.js|model-viewer.min.js|g' "$file_to_patch"
  sed -i.bak 's|model-viewer-module\.js|model-viewer-module.min.js|g' "$file_to_patch"
  sed -i.bak 's|model-viewer-effects\.js|model-viewer-effects.min.js|g' "$file_to_patch"
  rm "$file_to_patch.bak"
done

echo "✅ Patch complete."

# Add a VERSION file with git info
git log -n 1 > "$DEPLOY_ROOT/VERSION"

echo "📁 Final deploy tree:"
find "$DEPLOY_ROOT" | sort

popd

set +e
set +x
