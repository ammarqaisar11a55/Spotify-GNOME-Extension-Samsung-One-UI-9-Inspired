import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import {ControlButton} from './controlButton.js';
import {loadIcon} from './icons.js';

const SWAP_DURATION = 200;
const HIDDEN_SCALE = 0.6;
const HIDDEN_ROTATION = 30;

/** The dominant control. Its two glyphs turn into each other on a state change. */
export const PlayPauseButton = GObject.registerClass(
class PlayPauseButton extends ControlButton {
    _init({motion}) {
        super._init({
            iconName: 'play',
            styleClass: 'spotify-oneui-play',
            accessibleName: 'Play',
            motion,
        });

        this._playing = false;
        this._playIcon = this._createGlyph('play');
        this._pauseIcon = this._createGlyph('pause');
        this._pauseIcon.opacity = 0;

        const stack = new St.Widget({layout_manager: new Clutter.BinLayout()});
        stack.add_child(this._playIcon);
        stack.add_child(this._pauseIcon);
        this.set_child(stack);
    }

    setPlaying(playing) {
        if (playing === this._playing)
            return;

        this._playing = playing;
        this.accessible_name = playing ? 'Pause' : 'Play';

        const [incoming, outgoing] = playing
            ? [this._pauseIcon, this._playIcon]
            : [this._playIcon, this._pauseIcon];
        const duration = this._motion.duration(SWAP_DURATION);
        const direction = playing ? 1 : -1;

        outgoing.ease({
            opacity: 0,
            scale_x: HIDDEN_SCALE,
            scale_y: HIDDEN_SCALE,
            rotation_angle_z: direction * HIDDEN_ROTATION,
            duration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });

        incoming.set({
            scale_x: HIDDEN_SCALE,
            scale_y: HIDDEN_SCALE,
            rotation_angle_z: -direction * HIDDEN_ROTATION,
        });
        incoming.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            rotation_angle_z: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    _createGlyph(iconName) {
        return new St.Icon({
            gicon: loadIcon(iconName),
            style_class: 'spotify-oneui-control-icon',
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }
});
