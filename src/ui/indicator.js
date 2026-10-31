import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Motion} from '../motion.js';
import {PlaybackStatus} from '../spotifyClient.js';
import {ThemeController} from '../themeController.js';
import {loadIcon} from './icons.js';
import {PlayerView} from './playerView.js';

const STATUS_CLASSES = {
    [PlaybackStatus.PLAYING]: 'spotify-oneui-playing',
    [PlaybackStatus.PAUSED]: 'spotify-oneui-paused',
};

const FULL_OPACITY = 255;
const ABSENT_OPACITY = 140;

/** A popup that honors the animation preference when it opens and closes. */
class PlayerMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, motion) {
        super(sourceActor, 0.5, St.Side.TOP);

        this._motion = motion;
        this.actor.add_style_class_name('spotify-oneui-menu');
        this.box.add_style_class_name('spotify-oneui-card');
    }

    open(animate) {
        super.open(this._motion.enabled ? animate : PopupAnimation.NONE);
    }

    close(animate) {
        super.close(this._motion.enabled ? animate : PopupAnimation.NONE);
    }
}

/** The panel button, which owns the popup. */
export const SpotifyIndicator = GObject.registerClass(
class SpotifyIndicator extends PanelMenu.Button {
    _init({client, artwork, settings}) {
        super._init(0.5, 'Spotify');

        this._client = client;
        this._settings = settings;

        this.add_style_class_name('spotify-oneui-indicator');

        const box = new St.BoxLayout({style_class: 'spotify-oneui-indicator-box'});
        this._icon = new St.Icon({
            gicon: loadIcon('glyph'),
            style_class: 'system-status-icon spotify-oneui-indicator-icon',
        });
        this._label = new St.Label({
            style_class: 'spotify-oneui-indicator-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        const motion = new Motion(settings);
        this.setMenu(new PlayerMenu(this, motion));

        this._theme = new ThemeController(settings, this.menu.actor);

        this._view = new PlayerView({
            client,
            artwork,
            settings,
            motion,
            theme: this._theme,
        });
        this._view.connect('close-requested', () => this.menu.close());
        this.menu.box.add_child(this._view);

        this.menu.connect('open-state-changed', (_menu, open) => this._view.setOpen(open));

        client.connectObject('changed', () => this._sync(), this);
        settings.connectObject('changed::show-panel-track', () => this._sync(), this);
        this.connect('destroy', () => this._theme.destroy());

        this._sync();
    }

    _sync() {
        const {status, available, track} = this._client;

        for (const styleClass of Object.values(STATUS_CLASSES))
            this.remove_style_class_name(styleClass);
        if (available && STATUS_CLASSES[status])
            this.add_style_class_name(STATUS_CLASSES[status]);

        this._icon.opacity = available ? FULL_OPACITY : ABSENT_OPACITY;

        const artist = track.artists[0];
        const text = artist ? `${track.title} · ${artist}` : track.title;

        this._label.text = text;
        this._label.visible = this._settings.get_boolean('show-panel-track') &&
            available && text !== '';
    }
});
