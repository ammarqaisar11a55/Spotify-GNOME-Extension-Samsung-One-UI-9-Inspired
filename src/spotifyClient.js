import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {PlaybackClock} from './playbackClock.js';

const BUS_NAME = 'org.mpris.MediaPlayer2.spotify';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

const CALL_TIMEOUT_MS = 2000;
const WRITE_CONFIRM_MS = 900;
const SEEK_CONFIRM_MS = 400;

// A client that reports 0 this far into a track is not reporting its position.
const STALE_POSITION_USEC = 3 * GLib.USEC_PER_SEC;

const LOOP_CYCLE = ['None', 'Playlist', 'Track'];
const WRITABLE_FIELDS = {Shuffle: 'shuffle', LoopStatus: 'loopStatus'};

export const PlaybackStatus = Object.freeze({
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    STOPPED: 'Stopped',
});

const EMPTY_TRACK = Object.freeze({
    id: '',
    title: '',
    artists: [],
    album: '',
    artUrl: '',
    length: 0,
});

function parseTrack(metadata = {}) {
    const artists = metadata['xesam:artist'] ?? [];

    return {
        id: String(metadata['mpris:trackid'] ?? ''),
        title: metadata['xesam:title'] ?? '',
        artists: Array.isArray(artists) ? artists : [artists],
        album: metadata['xesam:album'] ?? '',
        artUrl: metadata['mpris:artUrl'] ?? '',
        length: Number(metadata['mpris:length'] ?? 0),
    };
}

function isExpectedError(error) {
    return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ||
        error.matches?.(Gio.DBusError, Gio.DBusError.SERVICE_UNKNOWN) ||
        error.matches?.(Gio.DBusError, Gio.DBusError.NAME_HAS_NO_OWNER);
}

/**
 * The Spotify desktop client, reached over its MPRIS D-Bus interface.
 *
 * Spotify's MPRIS support has been incomplete across releases, so nothing here
 * assumes a feature works: a property has to be present to be offered, and a
 * write has to take effect to stay offered.
 */
export const SpotifyClient = GObject.registerClass({
    Signals: {
        'changed': {},
        'seeked': {},
    },
}, class SpotifyClient extends GObject.Object {
    _init() {
        super._init();

        this._connection = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();
        this._clock = new PlaybackClock();
        this._signalIds = [];
        this._timeoutIds = new Set();
        this._pendingWrites = new Map();
        this._generation = 0;
        this._resetState();

        this._watchId = this._connection.watch_name(BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            (_connection, _name, owner) => this._onAppeared(owner),
            () => this._onVanished());
    }

    get position() {
        const position = this._clock.position;
        return this.track.length > 0 ? Math.min(position, this.track.length) : position;
    }

    get isPlaying() {
        return this.status === PlaybackStatus.PLAYING;
    }

    get supportsShuffle() {
        return this._supportsWrite('Shuffle');
    }

    get supportsRepeat() {
        return this._supportsWrite('LoopStatus');
    }

    get canSeekTrack() {
        return this.canSeek && this.canControl && this.track.length > 0;
    }

    playPause() {
        this._invoke('PlayPause');
    }

    next() {
        this._invoke('Next');
    }

    previous() {
        this._invoke('Previous');
    }

    seekTo(position) {
        const target = Math.round(Math.clamp(position, 0, this.track.length));
        const offset = target - Math.round(this._clock.position);

        this._clock.sync(target);
        this.emit('seeked');

        this._sendSeek(target, offset).catch(error => this._report(error));
    }

    toggleShuffle() {
        this._writeProperty('Shuffle', 'b', !this.shuffle);
    }

    cycleRepeat() {
        const index = LOOP_CYCLE.indexOf(this.loopStatus);
        this._writeProperty('LoopStatus', 's', LOOP_CYCLE[(index + 1) % LOOP_CYCLE.length]);
    }

    async refresh() {
        if (!this.available)
            return;

        const generation = this._generation;

        try {
            const reply = await this._call(PROPERTIES_IFACE, 'GetAll',
                new GLib.Variant('(s)', [PLAYER_IFACE]), '(a{sv})');

            if (generation === this._generation) {
                this._applyProperties(reply.recursiveUnpack()[0]);
                this.emit('changed');
            }
        } catch (error) {
            this._report(error);
        }
    }

    async refreshPosition() {
        if (!this.available)
            return;

        const generation = this._generation;

        try {
            const position = await this._getProperty('Position');

            if (generation === this._generation) {
                this._applyPosition(Number(position));
                this.emit('seeked');
            }
        } catch (error) {
            this._report(error);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._unsubscribe();

        for (const id of this._timeoutIds)
            GLib.source_remove(id);
        this._timeoutIds.clear();

        this._connection.unwatch_name(this._watchId);
        this._watchId = 0;
    }

    _resetState() {
        this.available = false;
        this.track = EMPTY_TRACK;
        this.status = PlaybackStatus.STOPPED;
        this.shuffle = false;
        this.loopStatus = 'None';
        this.canControl = false;
        this.canPlay = false;
        this.canPause = false;
        this.canGoNext = false;
        this.canGoPrevious = false;
        this.canSeek = false;

        this._hasWritable = new Set();
        this._ignoredWrites = new Set();
        this._pendingWrites.clear();

        this._clock.sync(0);
        this._clock.setRunning(false);
    }

    _onAppeared(owner) {
        this._generation++;
        this.available = true;
        this._subscribe(owner);
        this.refresh();
    }

    _onVanished() {
        this._generation++;
        this._unsubscribe();
        this._resetState();
        this.emit('changed');
    }

    _subscribe(owner) {
        this._unsubscribe();

        this._signalIds = [
            this._connection.signal_subscribe(owner, PROPERTIES_IFACE, 'PropertiesChanged',
                OBJECT_PATH, PLAYER_IFACE, Gio.DBusSignalFlags.NONE,
                (...args) => this._onPropertiesChanged(args[5])),
            this._connection.signal_subscribe(owner, PLAYER_IFACE, 'Seeked',
                OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
                (...args) => this._onSeeked(args[5])),
        ];
    }

    _unsubscribe() {
        for (const id of this._signalIds)
            this._connection.signal_unsubscribe(id);
        this._signalIds = [];
    }

    _onPropertiesChanged(parameters) {
        const [, changed, invalidated] = parameters.recursiveUnpack();

        this._applyProperties(changed);
        this.emit('changed');

        if (invalidated.length > 0)
            this.refresh();
    }

    _onSeeked(parameters) {
        const [position] = parameters.deepUnpack();

        this._clock.sync(Number(position));
        this.emit('seeked');
    }

    _applyProperties(properties) {
        if ('Metadata' in properties)
            this._applyMetadata(parseTrack(properties.Metadata));

        if ('PlaybackStatus' in properties) {
            this.status = properties.PlaybackStatus;
            this._clock.setRunning(this.isPlaying);
        }

        if ('Rate' in properties)
            this._clock.setRate(properties.Rate);

        for (const [name, field] of Object.entries(WRITABLE_FIELDS)) {
            if (!(name in properties))
                continue;

            this._hasWritable.add(name);
            if (!this._pendingWrites.has(name))
                this[field] = properties[name];
        }

        if ('CanControl' in properties)
            this.canControl = properties.CanControl;
        if ('CanPlay' in properties)
            this.canPlay = properties.CanPlay;
        if ('CanPause' in properties)
            this.canPause = properties.CanPause;
        if ('CanGoNext' in properties)
            this.canGoNext = properties.CanGoNext;
        if ('CanGoPrevious' in properties)
            this.canGoPrevious = properties.CanGoPrevious;
        if ('CanSeek' in properties)
            this.canSeek = properties.CanSeek;

        if ('Position' in properties)
            this._applyPosition(Number(properties.Position));
    }

    _applyMetadata(track) {
        const trackChanged = track.id !== this.track.id;
        this.track = track;

        if (trackChanged) {
            this._clock.sync(0);
            this.refreshPosition();
        }
    }

    _applyPosition(position) {
        const stale = position === 0 && this.isPlaying &&
            this._clock.position > STALE_POSITION_USEC;

        if (!stale)
            this._clock.sync(position);
    }

    async _sendSeek(target, offset) {
        const generation = this._generation;

        if (GLib.Variant.is_object_path(this.track.id)) {
            await this._call(PLAYER_IFACE, 'SetPosition',
                new GLib.Variant('(ox)', [this.track.id, target]));
        } else {
            await this._call(PLAYER_IFACE, 'Seek', new GLib.Variant('(x)', [offset]));
        }

        // Not every client emits Seeked, so read back where playback landed.
        await this._delay(SEEK_CONFIRM_MS);
        if (generation === this._generation)
            await this.refreshPosition();
    }

    _supportsWrite(name) {
        return this.canControl && this._hasWritable.has(name) &&
            !this._ignoredWrites.has(name);
    }

    async _writeProperty(name, signature, value) {
        const field = WRITABLE_FIELDS[name];
        const generation = this._generation;
        const token = Symbol(name);

        this._pendingWrites.set(name, token);
        this[field] = value;
        this.emit('changed');

        let actual = null;
        try {
            await this._call(PROPERTIES_IFACE, 'Set', new GLib.Variant('(ssv)',
                [PLAYER_IFACE, name, new GLib.Variant(signature, value)]));
            await this._delay(WRITE_CONFIRM_MS);

            if (this._pendingWrites.get(name) === token)
                actual = await this._getProperty(name);
        } catch (error) {
            this._report(error);
        }

        if (generation !== this._generation || this._pendingWrites.get(name) !== token)
            return;

        this._pendingWrites.delete(name);

        if (actual !== value) {
            // The client accepted the call and did nothing, so a control for
            // this property would be a lie. Stop offering it for this session.
            console.warn(`Spotify ignored a write to ${name}, hiding its control`);
            this._ignoredWrites.add(name);
            this[field] = actual ?? this[field];
            this.emit('changed');
        }
    }

    async _getProperty(name) {
        const reply = await this._call(PROPERTIES_IFACE, 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, name]), '(v)');

        return reply.recursiveUnpack()[0];
    }

    _invoke(method) {
        this._call(PLAYER_IFACE, method, null).catch(error => this._report(error));
    }

    _call(iface, method, parameters, replyType = null) {
        return new Promise((resolve, reject) => {
            this._connection.call(BUS_NAME, OBJECT_PATH, iface, method, parameters,
                replyType ? new GLib.VariantType(replyType) : null,
                Gio.DBusCallFlags.NO_AUTO_START, CALL_TIMEOUT_MS, this._cancellable,
                (connection, result) => {
                    try {
                        resolve(connection.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    _delay(milliseconds) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
                this._timeoutIds.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.add(id);
        });
    }

    _report(error) {
        if (!isExpectedError(error))
            console.warn(`Spotify MPRIS call failed: ${error.message}`);
    }
});
