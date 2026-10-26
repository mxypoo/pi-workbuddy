#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ">>> [pi-workbuddy] 正在更新 WorkBuddy 核心协议 (Git Submodule)..."
git -C "$DIR" submodule update --remote --merge
echo ">>> 更新完成！当前 Submodule 最新 Commit:"
git -C "$DIR/vendor/dsh-connect-workbuddy" log -1 --pretty=format:"%h - %s (%cr)"
echo ""
