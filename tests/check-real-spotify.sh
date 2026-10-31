#!/bin/bash
# Reports what the installed Spotify client really supports over MPRIS.
#
#   bash tests/check-real-spotify.sh
#
# Run this from a normal terminal with Spotify open and a track loaded. On snap
# installs, AppArmor refuses these calls from sandboxed callers, such as a
# terminal embedded in another confined application.
#
# It toggles Shuffle and LoopStatus and restores them, and seeks forward 10
# seconds and back, so you will hear a short jump. Nothing else changes.

dest=org.mpris.MediaPlayer2.spotify
path=/org/mpris/MediaPlayer2
iface=org.mpris.MediaPlayer2.Player

call() {
    gdbus call --session --dest "$dest" --object-path "$path" --method "$@" 2>&1
}

get() {
    call org.freedesktop.DBus.Properties.Get "$iface" "$1"
}

set_property() {
    call org.freedesktop.DBus.Properties.Set "$iface" "$1" "$2" > /dev/null
}

if ! get PlaybackStatus > /dev/null || [[ $(get PlaybackStatus) == Error* ]]; then
    echo "Could not reach Spotify: $(get PlaybackStatus)"
    exit 1
fi

echo "Status:   $(get PlaybackStatus)"
echo "Metadata: $(get Metadata)"
echo

for property in CanControl CanPlay CanPause CanSeek CanGoNext CanGoPrevious; do
    echo "$property: $(get "$property")"
done
echo

first=$(get Position)
sleep 2
second=$(get Position)
echo "Position: $first then $second"
[ "$first" != "$second" ] && echo "  PASS position is reported" \
    || echo "  CHECK position did not change, which is expected only while paused"

shuffle=$(get Shuffle)
echo
echo "Shuffle:  $shuffle"
if [[ $shuffle == *true* ]]; then opposite=false; else opposite=true; fi
set_property Shuffle "<$opposite>"
sleep 1.2
after=$(get Shuffle)
[[ $after == *$opposite* ]] && echo "  PASS shuffle writes work" \
    || echo "  FAIL shuffle write ignored, the player will hide this control"
[[ $shuffle == *true* ]] && restore=true || restore=false
set_property Shuffle "<$restore>"

loop=$(get LoopStatus)
echo
echo "Loop:     $loop"
if [[ $loop == *None* ]]; then opposite=Playlist; else opposite=None; fi
set_property LoopStatus "<'$opposite'>"
sleep 1.2
after=$(get LoopStatus)
[[ $after == *$opposite* ]] && echo "  PASS repeat writes work" \
    || echo "  FAIL repeat write ignored, the player will hide this control"
if [[ $loop == *Track* ]]; then restore=Track
elif [[ $loop == *Playlist* ]]; then restore=Playlist
else restore=None; fi
set_property LoopStatus "<'$restore'>"

echo
echo "Seeking forward 10 seconds, then back"
before=$(get Position | grep -oE '[0-9]{4,}' | head -1)
call "$iface.Seek" 10000000 > /dev/null
sleep 0.6
after=$(get Position | grep -oE '[0-9]{4,}' | head -1)
call "$iface.Seek" -- -10000000 > /dev/null
echo "  Position: ${before:-0} then ${after:-0}"
if [ "${after:-0}" -gt "${before:-0}" ]; then
    echo "  PASS seeking works"
else
    echo "  FAIL seeking had no effect"
fi

echo
echo "Watching signals for 3 seconds. Press play or pause in Spotify now."
timeout 3 gdbus monitor --session --dest "$dest" --object-path "$path" | grep -E 'PropertiesChanged|Seeked' | cut -c1-140
