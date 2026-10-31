import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {loadIcon} from './icons.js';

/** Stands in for the player when there is nothing to show. */
export const Placeholder = GObject.registerClass({
    Signals: {
        'action-activated': {},
    },
}, class Placeholder extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'spotify-oneui-placeholder',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(new St.Bin({
            style_class: 'spotify-oneui-placeholder-badge',
            x_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                gicon: loadIcon('glyph'),
                style_class: 'spotify-oneui-placeholder-icon',
            }),
        }));

        this._title = new St.Label({
            style_class: 'spotify-oneui-placeholder-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._title);

        this._body = new St.Label({
            style_class: 'spotify-oneui-placeholder-body',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._body.clutter_text.line_wrap = true;
        this.add_child(this._body);

        this._action = new St.Button({
            style_class: 'spotify-oneui-placeholder-action',
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._action.connect('clicked', () => this.emit('action-activated'));
        this.add_child(this._action);
    }

    /**
     * @param {object} state
     * @param {string} state.title
     * @param {string} state.body
     * @param {string|null} state.action - the button label, or null for no button
     */
    setState({title, body, action}) {
        this._title.text = title;
        this._body.text = body;
        this._action.label = action ?? '';
        this._action.visible = action !== null;
    }
});
