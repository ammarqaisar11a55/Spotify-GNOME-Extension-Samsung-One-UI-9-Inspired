#!/usr/bin/env -S gjs -m
// A stand-in for the Spotify client on the session bus, used by the headless
// tests. It owns Spotify's real MPRIS name and speaks the real interface.
//
//   gjs -m tests/mock-spotify.js [--legacy]
//
// With --legacy it behaves like an old client: writes to Shuffle and LoopStatus
// are accepted and ignored, and Seeked is never emitted.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ROOT_XML = `<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
  </interface>
</node>`;

const PLAYER_XML = `<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek"><arg direction="in" name="Offset" type="x"/></method>
    <method name="SetPosition">
      <arg direction="in" name="TrackId" type="o"/>
      <arg direction="in" name="Position" type="x"/>
    </method>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

const CONTROL_XML = `<node>
  <interface name="org.spotifyoneui.MockControl">
    <method name="Calls"><arg direction="out" name="calls" type="s"/></method>
    <method name="ClearCalls"/>
    <method name="SetEmptyMetadata"/>
    <method name="SetArtUrl"><arg direction="in" name="url" type="s"/></method>
    <method name="Exit"/>
  </interface>
</node>`;

const legacy = ARGV.includes('--legacy');
const loop = new GLib.MainLoop(null, false);
const artDir = GLib.dir_make_tmp('spotify-oneui-art-XXXXXX');

/* Paints a smooth square cover, so that rounding and fades are easy to judge. */
function paintCover(name, [r1, g1, b1], [r2, g2, b2]) {
    const size = 640;
    const pixels = new Uint8Array(size * size * 3);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const t = (x + y) / (2 * size);
            const glow = Math.max(0, 1 - Math.hypot(x - 430, y - 210) / 330);
            const offset = (y * size + x) * 3;

            pixels[offset] = Math.min(255, r1 + (r2 - r1) * t + 120 * glow);
            pixels[offset + 1] = Math.min(255, g1 + (g2 - g1) * t + 90 * glow);
            pixels[offset + 2] = Math.min(255, b1 + (b2 - b1) * t + 60 * glow);
        }
    }

    const path = GLib.build_filenamev([artDir, `${name}.jpg`]);
    GdkPixbuf.Pixbuf
        .new_from_bytes(new GLib.Bytes(pixels), GdkPixbuf.Colorspace.RGB, false, 8,
            size, size, size * 3)
        .savev(path, 'jpeg', ['quality'], ['92']);

    return GLib.filename_to_uri(path, null);
}

const TRACKS = [
    {
        id: '/com/spotify/track/4uLU6hMCjMI75M1A2tKUQC',
        title: 'Midnight City Lights',
        artists: ['Aurora Vale'],
        album: 'Neon Horizons',
        length: 214_000_000,
        artUrl: paintCover('one', [52, 18, 110], [226, 60, 110]),
    },
    {
        id: '/com/spotify/track/7ouMYWpwJ422jRcDASZB7P',
        title: 'A Considerably Longer Song Title That Cannot Possibly Fit On One Line',
        artists: ['The Long Names', 'Featuring Somebody Else Entirely'],
        album: 'An Album With a Similarly Unreasonable Title, Deluxe Anniversary Edition',
        length: 5_025_000_000,
        artUrl: paintCover('two', [8, 86, 96], [120, 196, 120]),
    },
    {
        id: '/com/spotify/track/0VjIjW4GlUZAMYd2vXMi3b',
        title: 'No Cover Here',
        artists: ['Local File'],
        album: '',
        length: 93_000_000,
        artUrl: '',
    },
];

class Player {
    constructor() {
        this.calls = [];
        this.index = 0;
        this.empty = false;
        this._status = 'Playing';
        this._shuffle = false;
        this._loop = 'None';
        this._position = 12_000_000;
        this._sampledAt = GLib.get_monotonic_time();
    }

    _record(call) {
        this.calls.push(call);
    }

    get track() {
        return TRACKS[this.index];
    }

    _advance(step) {
        this.index = (this.index + step + TRACKS.length) % TRACKS.length;
        this._setPosition(0);
        this._notify('Metadata');
    }

    _setPosition(position) {
        this._position = position;
        this._sampledAt = GLib.get_monotonic_time();
    }

    _setStatus(status) {
        this._setPosition(this.Position);
        this._status = status;
        this._notify('PlaybackStatus');
    }

    _notify(name) {
        const signatures = {Metadata: 'a{sv}', PlaybackStatus: 's', Shuffle: 'b', LoopStatus: 's'};
        this.dbus.emit_property_changed(name, new GLib.Variant(signatures[name], this[name]));
    }

    Next() {
        this._record('Next');
        this._advance(1);
    }

    Previous() {
        this._record('Previous');
        this._advance(-1);
    }

    Pause() {
        this._record('Pause');
        this._setStatus('Paused');
    }

    Play() {
        this._record('Play');
        this._setStatus('Playing');
    }

    PlayPause() {
        this._record('PlayPause');
        this._setStatus(this._status === 'Playing' ? 'Paused' : 'Playing');
    }

    Stop() {
        this._record('Stop');
        this._setStatus('Stopped');
    }

    Seek(offset) {
        this._record(`Seek ${offset}`);
        this._seekTo(this.Position + offset);
    }

    SetPosition(trackId, position) {
        this._record(`SetPosition ${trackId} ${position}`);
        if (trackId === this.track.id)
            this._seekTo(position);
    }

    _seekTo(position) {
        this._setPosition(Math.max(0, position));
        if (!legacy)
            this.dbus.emit_signal('Seeked', new GLib.Variant('(x)', [this._position]));
    }

    get PlaybackStatus() {
        return this._status;
    }

    get Rate() {
        return 1;
    }

    get Shuffle() {
        return this._shuffle;
    }

    set Shuffle(value) {
        this._record(`Shuffle ${value}`);
        if (legacy)
            return;

        this._shuffle = value;
        this._notify('Shuffle');
    }

    get LoopStatus() {
        return this._loop;
    }

    set LoopStatus(value) {
        this._record(`LoopStatus ${value}`);
        if (legacy)
            return;

        this._loop = value;
        this._notify('LoopStatus');
    }

    get Metadata() {
        if (this.empty)
            return {};

        const {id, title, artists, album, length, artUrl} = this.track;
        return {
            'mpris:trackid': new GLib.Variant('s', id),
            'mpris:length': new GLib.Variant('t', length),
            'mpris:artUrl': new GLib.Variant('s', artUrl),
            'xesam:title': new GLib.Variant('s', title),
            'xesam:artist': new GLib.Variant('as', artists),
            'xesam:album': new GLib.Variant('s', album),
            'xesam:url': new GLib.Variant('s', 'https://open.spotify.com/track/mock'),
        };
    }

    get Position() {
        if (this._status !== 'Playing')
            return this._position;

        return Math.round(this._position + GLib.get_monotonic_time() - this._sampledAt);
    }

    get CanGoNext() {
        return true;
    }

    get CanGoPrevious() {
        return true;
    }

    get CanPlay() {
        return true;
    }

    get CanPause() {
        return true;
    }

    get CanSeek() {
        return true;
    }

    get CanControl() {
        return true;
    }
}

const player = new Player();

const control = {
    Calls: () => JSON.stringify(player.calls),
    ClearCalls: () => {
        player.calls = [];
    },
    SetEmptyMetadata: () => {
        player.empty = true;
        player._notify('Metadata');
    },
    SetArtUrl: url => {
        player.track.artUrl = url;
        player._notify('Metadata');
    },
    Exit: () => loop.quit(),
};

const root = {
    Raise: () => player._record('Raise'),
    Quit: () => loop.quit(),
    CanQuit: true,
    CanRaise: true,
    Identity: 'Spotify',
};

Gio.bus_own_name(Gio.BusType.SESSION, 'org.mpris.MediaPlayer2.spotify',
    Gio.BusNameOwnerFlags.NONE,
    connection => {
        const path = '/org/mpris/MediaPlayer2';

        // Exported objects must stay referenced or they vanish when collected.
        root.dbus = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, root);
        root.dbus.export(connection, path);
        player.dbus = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);
        player.dbus.export(connection, path);
        control.dbus = Gio.DBusExportedObject.wrapJSObject(CONTROL_XML, control);
        control.dbus.export(connection, '/org/spotifyoneui/MockControl');
    },
    null,
    () => {
        printerr('Could not own the Spotify bus name');
        loop.quit();
    });

loop.run();

Gio.Subprocess.new(['rm', '-rf', artDir], Gio.SubprocessFlags.NONE);
