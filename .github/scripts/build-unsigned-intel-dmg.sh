#!/bin/bash
set -euo pipefail

# dmg-builder 的 CUSTOM_DMGBUILD_PATH 接口传入设置文件、卷名和产物路径。
if [[ $# != 4 || "$1" != -s || "$4" != */LING-*-mac-x64.dmg ]]; then
  echo "Expected: -s settings.json <volume-name> <LING-*-mac-x64.dmg>" >&2
  exit 1
fi

bundle="$(jq -er '
  [.contents[] | select((.type // "file") == "file" and (.path | endswith("/LING.app"))) | .path]
  | if length == 1 then .[0] else error("Expected exactly one LING.app") end
' "$2")"
test -d "$bundle/Contents"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
ditto "$bundle" "$staging/LING.app"
ln -s /Applications "$staging/Applications"

# 从目录一次生成只读镜像，避免在 CI 上挂载、写入和弹出临时卷。
hdiutil create -fs 'HFS+' -format UDZO -volname "$3" -srcfolder "$staging" "$4"
