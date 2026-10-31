#!/bin/bash
# Runs a test script against the extension in a disposable headless GNOME Shell.
#
#   tests/run-headless.sh [output-dir] [script]
#
# Everything happens on a private D-Bus and in a throwaway home directory, so
# the running desktop, its settings and a real Spotify client are not touched.
# This never replaces the session's shell.

set -u

root=$(cd "$(dirname "$0")/.." && pwd)
output=${1:-$root/dist/test-output}
script=${2:-$root/tests/e2e.js}
uuid=spotify-oneui@ammarqaisar11a55.github.io
driver=spotify-oneui-test-driver@ammarqaisar11a55.github.io

mkdir -p "$output"
output=$(cd "$output" && pwd)

# The Wayland socket lives here and its path may not exceed 108 bytes.
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/so.XXXXXX")
trap 'rm -rf "$sandbox"' EXIT

mkdir -p "$sandbox"/{home,config,cache,data/gnome-shell/extensions,run,pack}
chmod 700 "$sandbox/run"

extensions=$sandbox/data/gnome-shell/extensions
cp -r "$root/tests/driver" "$extensions/$driver"

# Copies other installed extensions in, to check how the player sits with them.
# TEST_EXTRA_EXTENSIONS is a space separated list of uuids.
enabled="'$driver', '$uuid'"
for extra in ${TEST_EXTRA_EXTENSIONS:-}; do
    cp -r "$HOME/.local/share/gnome-shell/extensions/$extra" "$extensions/$extra" || exit 1
    enabled="$enabled, '$extra'"
done

export HOME=$sandbox/home
export XDG_CONFIG_HOME=$sandbox/config
export XDG_CACHE_HOME=$sandbox/cache
export XDG_DATA_HOME=$sandbox/data
export XDG_RUNTIME_DIR=$sandbox/run
export XDG_SESSION_TYPE=wayland
export GSETTINGS_BACKEND=keyfile
export GSETTINGS_SCHEMA_DIR=$extensions/$uuid/schemas:/usr/share/glib-2.0/schemas
unset WAYLAND_DISPLAY DISPLAY XDG_SESSION_ID DBUS_SESSION_BUS_ADDRESS

# Pack and install the way a user does, so that a missing file fails here.
gnome-extensions pack "$root" --force --out-dir="$sandbox/pack" \
    --extra-source=src --extra-source=icons || exit 1
gnome-extensions install --force "$sandbox/pack/$uuid.shell-extension.zip" || exit 1

gsettings set org.gnome.shell enabled-extensions "[$enabled]"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.desktop.interface color-scheme "${TEST_COLOR_SCHEME:-prefer-dark}"

export TEST_ROOT=$root TEST_OUTPUT=$output TEST_SCRIPT=$script
exec dbus-run-session -- bash -c '
    gnome-shell --headless --wayland --no-x11 --force-animations \
        --virtual-monitor "${TEST_MONITOR:-1600x1000}" \
        --wayland-display=test-0 > "$TEST_OUTPUT/shell.log" 2>&1 &
    shell=$!
    gjs -m "$TEST_SCRIPT"
    status=$?
    kill $shell 2>/dev/null
    wait $shell 2>/dev/null
    exit $status
'
