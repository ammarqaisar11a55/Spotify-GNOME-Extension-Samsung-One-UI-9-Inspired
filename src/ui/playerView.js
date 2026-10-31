import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {findSpotifyApp} from '../spotifyApp.js';
import {PlaybackStatus} from '../spotifyClient.js';
import {ArtworkView} from './artworkView.js';
import {ControlButton} from './controlButton.js';
import {Placeholder} from './placeholder.js';
import {PlayPauseButton} from './playPauseButton.js';
import {SeekBar} from './seekBar.js';

// Must match .spotify-oneui-artwork and its corners in stylesheet.css.
const HERO_ARTWORK = {size: 320, radius: 24};
const COMPACT_ARTWORK = {size: 84, radius: 18};

// Below this logical height the hero would not fit on screen.
const MIN_HERO_WORK_AREA = 600;

const OPEN_DURATION = 240;
const OPEN_SCALE = 0.96;
const OPEN_OFFSET = -8;
const PAGE_DURATION = 180;

const FRAME_INTERVAL_US = GLib.USEC_PER_SEC / 30;
const STILL_FRAME_INTERVAL_US = GLib.USEC_PER_SEC / 4;
const RESYNC_INTERVAL_US = 5 * GLib.USEC_PER_SEC;
const BREATH_PERIOD_US = 2.4 * GLib.USEC_PER_SEC;

const DARK_TINT_ALPHA = 0.14;
const LIGHT_TINT_ALPHA = 0.09;

const REPEAT_ICONS = {None: 'repeat', Playlist: 'repeat', Track: 'repeat-one'};

const STATUS_LABELS = {
    [PlaybackStatus.PLAYING]: 'Playing',
    [PlaybackStatus.PAUSED]: 'Paused',
    [PlaybackStatus.STOPPED]: 'Stopped',
};

function formatTime(microseconds) {
    const total = Math.floor(microseconds / GLib.USEC_PER_SEC);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = String(total % 60).padStart(2, '0');

    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${minutes}:${seconds}`;
}

function createLabel(styleClass) {
    const label = new St.Label({style_class: styleClass, x_expand: true});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    return label;
}

/** The content of the popup: the player, or a placeholder when it has no track. */
export const PlayerView = GObject.registerClass({
    Signals: {
        'close-requested': {},
    },
}, class PlayerView extends St.Widget {
    _init({client, artwork, settings, motion, theme}) {
        super._init({
            style_class: 'spotify-oneui-root',
            layout_manager: new Clutter.BinLayout(),
            pivot_point: new Graphene.Point({x: 0.5, y: 0}),
        });

        this._client = client;
        this._artworkLoader = artwork;
        this._settings = settings;
        this._motion = motion;
        this._theme = theme;

        this._open = false;
        this._artworkKey = null;
        this._artworkCancellable = null;
        this._tintColor = null;
        this._lastFrameTime = 0;
        this._lastResyncTime = 0;

        this._tint = new St.Widget({
            style_class: 'spotify-oneui-tint',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._tint);

        this._buildPlayer();

        this._placeholder = new Placeholder();
        this._placeholder.connect('action-activated', () => this._openSpotify());
        this.add_child(this._placeholder);

        this._timeline = new Clutter.Timeline({
            actor: this,
            duration: 1000,
            repeat_count: -1,
        });
        this._timeline.connect('new-frame', () => this._onFrame());

        this._client.connectObject(
            'changed', () => this._sync(),
            'seeked', () => this._syncProgress(),
            this);
        this._settings.connectObject('changed', (_settings, key) => this._onSettingChanged(key), this);
        this._theme.connectObject('changed', () => this._applyTint(), this);
        this.connect('destroy', () => this._onDestroy());

        this._applyLayout();
        this._sync();
    }

    setOpen(open) {
        this._open = open;

        if (open) {
            this._client.refresh();
            this._client.refreshPosition();
            this._applyLayout();
            this._syncProgress();
            this._playEntrance();
        }

        this._updateTicking();
    }

    _buildPlayer() {
        this._player = new St.BoxLayout({
            style_class: 'spotify-oneui-player',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this.add_child(this._player);

        this._buildTrackSection();
        this._buildProgressSection();
        this._buildControls();
    }

    _buildTrackSection() {
        this._artworkView = new ArtworkView(this._motion);

        this._scrim = new St.Widget({
            style_class: 'spotify-oneui-scrim',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.END,
        });

        this._statusLabel = new St.Label({style_class: 'spotify-oneui-status'});
        this._statusLabel.y_align = Clutter.ActorAlign.START;
        this._statusLabel.x_align = Clutter.ActorAlign.START;

        this._openButton = new ControlButton({
            iconName: 'open',
            styleClass: 'spotify-oneui-open',
            accessibleName: 'Open Spotify',
            motion: this._motion,
        });
        this._openButton.connect('clicked', () => this._openSpotify());

        this._titleLabel = createLabel('spotify-oneui-title');
        this._artistLabel = createLabel('spotify-oneui-artist');
        this._albumLabel = createLabel('spotify-oneui-album');

        this._info = new St.BoxLayout({
            style_class: 'spotify-oneui-info',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this._info.add_child(this._titleLabel);
        this._info.add_child(this._artistLabel);
        this._info.add_child(this._albumLabel);

        this._hero = new St.Widget({
            style_class: 'spotify-oneui-hero',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._row = new St.BoxLayout({
            style_class: 'spotify-oneui-row',
            x_expand: true,
        });

        this._player.add_child(this._hero);
        this._player.add_child(this._row);
    }

    _buildProgressSection() {
        this._seekBar = new SeekBar();
        this._seekBar.connect('seek-requested', (_bar, value) => {
            this._client.seekTo(value * this._client.track.length);
        });
        this._seekBar.connect('notify::value', () => {
            if (this._seekBar.dragging)
                this._showTimes(this._seekBar.value * this._client.track.length);
        });

        this._elapsedLabel = new St.Label({
            style_class: 'spotify-oneui-time',
            x_expand: true,
        });
        this._durationLabel = new St.Label({style_class: 'spotify-oneui-time'});

        const times = new St.BoxLayout({
            style_class: 'spotify-oneui-times',
            x_expand: true,
        });
        times.add_child(this._elapsedLabel);
        times.add_child(this._durationLabel);

        const section = new St.BoxLayout({
            style_class: 'spotify-oneui-progress',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        section.add_child(this._seekBar);
        section.add_child(times);
        this._player.add_child(section);
    }

    _buildControls() {
        this._shuffleButton = new ControlButton({
            iconName: 'shuffle',
            styleClass: 'spotify-oneui-toggle',
            accessibleName: 'Shuffle',
            motion: this._motion,
        });
        this._shuffleButton.connect('clicked', () => this._client.toggleShuffle());

        this._previousButton = new ControlButton({
            iconName: 'previous',
            styleClass: 'spotify-oneui-transport',
            accessibleName: 'Previous track',
            motion: this._motion,
        });
        this._previousButton.connect('clicked', () => this._client.previous());

        this._playButton = new PlayPauseButton({motion: this._motion});
        this._playButton.connect('clicked', () => this._client.playPause());

        this._nextButton = new ControlButton({
            iconName: 'next',
            styleClass: 'spotify-oneui-transport',
            accessibleName: 'Next track',
            motion: this._motion,
        });
        this._nextButton.connect('clicked', () => this._client.next());

        this._repeatButton = new ControlButton({
            iconName: 'repeat',
            styleClass: 'spotify-oneui-toggle',
            accessibleName: 'Repeat',
            motion: this._motion,
        });
        this._repeatButton.connect('clicked', () => this._client.cycleRepeat());

        const controls = new St.BoxLayout({
            style_class: 'spotify-oneui-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        controls.add_child(this._shuffleButton);
        controls.add_child(this._previousButton);
        controls.add_child(this._playButton);
        controls.add_child(this._nextButton);
        controls.add_child(this._repeatButton);
        this._player.add_child(controls);
    }

    _useHero() {
        const showArtwork = this._settings.get_boolean('show-artwork');
        const expanded = this._settings.get_string('layout') === 'expanded';

        if (!showArtwork || !expanded)
            return false;

        const {primaryIndex} = Main.layoutManager;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(primaryIndex);
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);

        return workArea.height / scaleFactor >= MIN_HERO_WORK_AREA;
    }

    _applyLayout() {
        const hero = this._useHero();

        if (hero === this._heroActive && this._artworkView.get_parent())
            return;
        this._heroActive = hero;

        for (const actor of [this._artworkView, this._scrim, this._statusLabel,
            this._openButton, this._info])
            actor.get_parent()?.remove_child(actor);
        this._column?.destroy();
        this._column = null;

        this.remove_style_class_name(hero ? 'spotify-oneui-compact' : 'spotify-oneui-expanded');
        this.add_style_class_name(hero ? 'spotify-oneui-expanded' : 'spotify-oneui-compact');

        this._hero.visible = hero;
        this._row.visible = !hero;
        this._artworkView.visible = this._settings.get_boolean('show-artwork');

        if (hero) {
            this._hero.add_child(this._artworkView);
            this._hero.add_child(this._scrim);
            this._hero.add_child(this._info);
            this._hero.add_child(this._statusLabel);
            this._hero.add_child(this._openButton);
        } else {
            this._column = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._column.add_child(this._statusLabel);
            this._column.add_child(this._info);

            this._row.add_child(this._artworkView);
            this._row.add_child(this._column);
            this._row.add_child(this._openButton);
        }

        this._syncArtwork();
    }

    _sync() {
        const {available, track} = this._client;
        const hasTrack = available && (track.id !== '' || track.title !== '');

        this._showPage(hasTrack ? this._player : this._placeholder);

        if (hasTrack)
            this._syncPlayer();
        else
            this._syncPlaceholder();

        this._syncArtwork();
        this._updateTicking();
    }

    _showPage(page) {
        const other = page === this._player ? this._placeholder : this._player;

        if (page.visible && !other.visible)
            return;

        other.hide();
        page.opacity = 0;
        page.show();
        page.ease({
            opacity: 255,
            duration: this._motion.duration(PAGE_DURATION),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _syncPlaceholder() {
        const app = findSpotifyApp();

        if (this._client.available) {
            this._placeholder.setState({
                title: 'Nothing playing',
                body: 'Start something in Spotify and it will appear here.',
                action: 'Open Spotify',
            });
        } else if (app) {
            this._placeholder.setState({
                title: 'Spotify isn’t running',
                body: 'Open Spotify to see and control what’s playing.',
                action: 'Open Spotify',
            });
        } else {
            this._placeholder.setState({
                title: 'Spotify isn’t installed',
                body: 'Install the Spotify desktop app to use this player.',
                action: null,
            });
        }
    }

    _syncPlayer() {
        const client = this._client;
        const {track} = client;

        this._setText(this._titleLabel, track.title || 'Unknown title');
        this._setText(this._artistLabel, track.artists.join(', '));
        this._setText(this._albumLabel, track.album);
        this._statusLabel.text = STATUS_LABELS[client.status] ?? client.status;

        this._seekBar.setTrack(track.id);
        this._seekBar.reactive = client.canSeekTrack;
        this._seekBar.can_focus = client.canSeekTrack;
        this._durationLabel.text = track.length > 0 ? formatTime(track.length) : '';

        this._playButton.setPlaying(client.isPlaying);
        this._playButton.reactive = client.canControl && (client.canPlay || client.canPause);
        this._previousButton.reactive = client.canControl && client.canGoPrevious;
        this._nextButton.reactive = client.canControl && client.canGoNext;

        this._shuffleButton.visible = client.supportsShuffle &&
            this._settings.get_boolean('show-shuffle');
        this._shuffleButton.checked = client.shuffle;

        this._repeatButton.visible = client.supportsRepeat &&
            this._settings.get_boolean('show-repeat');
        this._repeatButton.checked = client.loopStatus !== 'None';
        this._repeatButton.setIconName(REPEAT_ICONS[client.loopStatus] ?? 'repeat');

        this._syncProgress();
    }

    _setText(label, text) {
        label.text = text;
        label.visible = text !== '';
    }

    _syncProgress() {
        const {position, track} = this._client;

        this._seekBar.setProgress(track.length > 0 ? position / track.length : 0);

        if (!this._seekBar.dragging)
            this._showTimes(position);
    }

    _showTimes(position) {
        const text = formatTime(position);

        if (this._elapsedLabel.text !== text)
            this._elapsedLabel.text = text;
    }

    _syncArtwork() {
        const {track} = this._client;
        const showArtwork = this._settings.get_boolean('show-artwork');
        const shape = this._heroActive ? HERO_ARTWORK : COMPACT_ARTWORK;
        const url = showArtwork ? track.artUrl : '';
        const scale = this._getRenderScale();
        const key = `${url}@${shape.size}x${scale}`;

        if (key === this._artworkKey)
            return;
        this._artworkKey = key;

        this._artworkCancellable?.cancel();
        this._artworkCancellable = null;

        if (url === '') {
            this._showArtwork(null, null);
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._artworkCancellable = cancellable;

        this._artworkLoader.load(url, {
            size: Math.ceil(shape.size * scale),
            radius: Math.ceil(shape.radius * scale),
        }, cancellable).then(({content, color}) => {
            if (!cancellable.is_cancelled())
                this._showArtwork(content, color);
        }).catch(error => {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            console.warn(`Could not load artwork: ${error.message}`);
            if (!cancellable.is_cancelled())
                this._showArtwork(null, null);
        });
    }

    _showArtwork(content, color) {
        this._artworkView.setContent(content);
        this._tintColor = color;
        this._applyTint();
    }

    _getRenderScale() {
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const monitorScale = global.display.get_monitor_scale(Main.layoutManager.primaryIndex);

        return Math.max(scaleFactor, monitorScale);
    }

    _applyTint() {
        if (!this._tintColor) {
            this._tint.style = null;
            return;
        }

        const [red, green, blue] = this._tintColor;
        const alpha = this._theme.isDark ? DARK_TINT_ALPHA : LIGHT_TINT_ALPHA;

        this._tint.style = `background-color: rgba(${red}, ${green}, ${blue}, ${alpha});`;
    }

    _onSettingChanged(key) {
        switch (key) {
        case 'layout':
        case 'show-artwork':
            this._applyLayout();
            this._syncArtwork();
            break;
        case 'show-shuffle':
        case 'show-repeat':
            this._sync();
            break;
        case 'animations':
            this._updateTicking();
            break;
        }
    }

    _updateTicking() {
        const tick = this._open && this._client.isPlaying;

        if (tick && !this._timeline.is_playing())
            this._timeline.start();
        else if (!tick && this._timeline.is_playing())
            this._timeline.stop();
    }

    _onFrame() {
        const now = GLib.get_monotonic_time();
        const breathes = this._motion.breathes;
        const interval = breathes ? FRAME_INTERVAL_US : STILL_FRAME_INTERVAL_US;

        if (now - this._lastFrameTime < interval)
            return;
        this._lastFrameTime = now;

        if (breathes)
            this._seekBar.setPhase((now / BREATH_PERIOD_US) * 2 * Math.PI);

        this._syncProgress();

        // Position changes made inside Spotify are not always signaled.
        if (now - this._lastResyncTime >= RESYNC_INTERVAL_US) {
            this._lastResyncTime = now;
            this._client.refreshPosition();
        }
    }

    _playEntrance() {
        this.remove_all_transitions();

        if (!this._motion.enabled)
            return;

        this.set({
            scale_x: OPEN_SCALE,
            scale_y: OPEN_SCALE,
            translation_y: OPEN_OFFSET,
        });
        this.ease({
            scale_x: 1,
            scale_y: 1,
            translation_y: 0,
            duration: this._motion.duration(OPEN_DURATION),
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
        });
    }

    _openSpotify() {
        const app = findSpotifyApp();

        if (app)
            app.activate();

        this.emit('close-requested');
    }

    _onDestroy() {
        this._artworkCancellable?.cancel();
        this._timeline.stop();
        this._timeline = null;
    }
});
