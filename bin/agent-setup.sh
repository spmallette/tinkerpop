#!/usr/bin/env bash
#
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
#

# Set up AI coding agent integration with TinkerPop's Agent Skills.
#
# TinkerPop provides two Agent Skills in .skills/:
#   tinker-dev    - Project development guidance (build, test, conventions)
#   tinker-review - Graph-based PR review
#
# Different AI coding tools discover skills in different directories. This script
# creates the necessary symlinks or shims so your tool can find both skills.
#
# Usage:
#   bin/agent-setup.sh <agent>
#   bin/agent-setup.sh --list
#   bin/agent-setup.sh --all
#
# Examples:
#   bin/agent-setup.sh claude       # Set up for Claude Code
#   bin/agent-setup.sh kiro         # Set up for Kiro
#   bin/agent-setup.sh --all        # Set up for all supported agents
#
# Supported agents:
#   claude    - Claude Code (.claude/skills/)
#   copilot   - GitHub Copilot (.github/skills/ and .agents/skills/)
#   cursor    - Cursor (.cursor/skills/)
#   codex     - OpenAI Codex (.codex/skills/)
#   junie     - JetBrains Junie (.junie/skills/)
#   kiro      - Kiro (.kiro/skills/)

set -uo pipefail

SKILLS=(
    "tinker-dev:.skills/tinker-dev"
    "tinker-review:.skills/tinker-review"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
skip() { echo -e "  ${YELLOW}○${NC} $1"; }
bad()  { echo -e "  ${RED}✗${NC} $1"; }

usage() {
    echo "Usage: bin/agent-setup.sh <agent|--list|--all>"
    echo ""
    echo "Agents: claude, copilot, cursor, codex, junie, kiro"
    echo ""
    echo "Options:"
    echo "  --list    List supported agents and their skill discovery paths"
    echo "  --all     Set up shims for all supported agents"
    echo "  --help    Show this message"
}

# Verify we're in the repo root
for entry in "${SKILLS[@]}"; do
    skill_dir="${entry#*:}"
    if [[ ! -d "$skill_dir" ]]; then
        bad "Cannot find $skill_dir — run this script from the TinkerPop repository root."
        exit 1
    fi
done

# Create a symlink from a tool's skill directory to one canonical skill
setup_symlink() {
    local tool_name="$1"
    local target_dir="$2"
    local skill_name="$3"
    local skill_dir="$4"

    mkdir -p "$target_dir"
    local link_path="$target_dir/$skill_name"

    if [[ -L "$link_path" ]]; then
        skip "$tool_name: symlink already exists at $link_path"
        return 0
    fi

    if [[ -e "$link_path" ]]; then
        bad "$tool_name: $link_path already exists and is not a symlink — skipping"
        return 1
    fi

    local rel_path
    rel_path=$(python3 -c "import os.path; print(os.path.relpath('$skill_dir', '$target_dir'))" 2>/dev/null)
    if [[ -z "$rel_path" ]]; then
        rel_path=$(perl -e 'use File::Spec; print File::Spec->abs2rel("'"$skill_dir"'", "'"$target_dir"'")' 2>/dev/null)
    fi
    if [[ -z "$rel_path" ]]; then
        bad "$tool_name: could not compute relative path (need python3 or perl)"
        return 1
    fi

    ln -s "$rel_path" "$link_path"
    ok "$tool_name: created symlink $link_path -> $rel_path"
}

# Symlink all skills into a given directory
setup_all_symlinks() {
    local tool_name="$1"
    local target_dir="$2"
    for entry in "${SKILLS[@]}"; do
        local skill_name="${entry%%:*}"
        local skill_dir="${entry#*:}"
        setup_symlink "$tool_name" "$target_dir" "$skill_name" "$skill_dir"
    done
}

# Kiro doesn't follow symlinks in .kiro/skills/, so we copy instead.
# See: https://github.com/kirodotdev/Kiro/issues (symlink support).
setup_kiro() {
    local any_copied=false
    for entry in "${SKILLS[@]}"; do
        local skill_name="${entry%%:*}"
        local skill_dir="${entry#*:}"
        local target_dir=".kiro/skills/$skill_name"

        if [[ -d "$target_dir" ]]; then
            rm -rf "$target_dir"
            skip "kiro: removed existing copy at $target_dir"
        fi

        mkdir -p ".kiro/skills"
        cp -r "$skill_dir" "$target_dir"
        ok "kiro: copied skill to $target_dir"
        any_copied=true
    done

    if [[ "$any_copied" == true ]]; then
        echo ""
        echo -e "  ${YELLOW}NOTE:${NC} Kiro uses copies, not symlinks. Re-run this script after"
        echo -e "        updating skills in .skills/ to sync the changes."
    fi
}

setup_agent() {
    local agent="$1"
    case "$agent" in
        claude)
            setup_all_symlinks "claude" ".claude/skills"
            ;;
        copilot)
            setup_all_symlinks "copilot (.github)" ".github/skills"
            setup_all_symlinks "copilot (.agents)" ".agents/skills"
            ;;
        cursor)
            setup_all_symlinks "cursor" ".cursor/skills"
            ;;
        codex)
            setup_all_symlinks "codex" ".codex/skills"
            ;;
        junie)
            setup_all_symlinks "junie" ".junie/skills"
            ;;
        kiro)
            setup_kiro
            ;;
        *)
            bad "Unknown agent: $agent"
            echo ""
            usage
            return 1
            ;;
    esac
}

list_agents() {
    echo "Supported agents and their skill discovery paths:"
    echo ""
    for entry in "${SKILLS[@]}"; do
        local skill_name="${entry%%:*}"
        local skill_dir="${entry#*:}"
        echo "  Skill: $skill_name (source: $skill_dir)"
        echo "    claude    .claude/skills/$skill_name/  -> symlink"
        echo "    copilot   .github/skills/$skill_name/  -> symlink"
        echo "              .agents/skills/$skill_name/  -> symlink"
        echo "    cursor    .cursor/skills/$skill_name/  -> symlink"
        echo "    codex     .codex/skills/$skill_name/   -> symlink"
        echo "    junie     .junie/skills/$skill_name/   -> symlink"
        echo "    kiro      .kiro/skills/$skill_name/    -> copy (re-run to sync)"
        echo ""
    done
}

# --- Main ---

if [[ $# -eq 0 ]]; then
    usage
    exit 1
fi

case "$1" in
    --help|-h)
        usage
        ;;
    --list)
        list_agents
        ;;
    --all)
        echo "Setting up all agent integrations..."
        echo ""
        for agent in claude copilot cursor codex junie kiro; do
            setup_agent "$agent"
        done
        echo ""
        echo "Done. Symlinked directories and generated files are gitignored."
        echo "Add them to .gitignore if they aren't already."
        ;;
    *)
        echo "Setting up $1..."
        echo ""
        setup_agent "$1"
        ;;
esac
