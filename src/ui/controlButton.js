import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import {loadIcon} from './icons.js';

const PRESSED_SCALE = 0.92;
const PRESS_DURATION = 90;

/** A round player control that sinks slightly when pressed. */
export const ControlButton = GObject.registerClass(
class ControlButton extends St.Button {
    _init({iconName, styleClass, accessibleName, motion}) {
        super._init({
            style_class: `spotify-oneui-control ${styleClass}`,
            accessible_name: accessibleName,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });

        this._motion = motion;
        this._icon = new St.Icon({
            gicon: loadIcon(iconName),
            style_class: 'spotify-oneui-control-icon',
        });
        this.set_child(this._icon);

        this.connect('notify::pressed', () => this._animatePress());
    }

    setIconName(iconName) {
        this._icon.gicon = loadIcon(iconName);
    }

    _animatePress() {
        const scale = this.pressed ? PRESSED_SCALE : 1;

        this.ease({
            scale_x: scale,
            scale_y: scale,
            duration: this._motion.duration(PRESS_DURATION),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
});
