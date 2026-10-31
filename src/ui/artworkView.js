import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {loadIcon} from './icons.js';

const CROSSFADE_DURATION = 320;

/** Album art that cross-fades between covers and falls back to a music note. */
export const ArtworkView = GObject.registerClass(
class ArtworkView extends St.Widget {
    _init(motion) {
        super._init({
            style_class: 'spotify-oneui-artwork',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._motion = motion;

        const fallback = new St.Bin({
            style_class: 'spotify-oneui-artwork-fallback',
            x_expand: true,
            y_expand: true,
            child: new St.Icon({
                gicon: loadIcon('note'),
                style_class: 'spotify-oneui-artwork-note',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });
        this.add_child(fallback);

        this._front = this._createLayer();
        this._back = this._createLayer();
        this.add_child(this._back);
        this.add_child(this._front);
    }

    /**
     * @param {St.ImageContent|null} content - the cover, or null for the fallback
     */
    setContent(content) {
        const incoming = this._back;
        const outgoing = this._front;

        incoming.remove_all_transitions();
        outgoing.remove_all_transitions();

        this._front = incoming;
        this._back = outgoing;
        this.set_child_above_sibling(incoming, null);

        incoming.content = content;
        incoming.opacity = 0;

        incoming.ease({
            opacity: content ? 255 : 0,
            duration: this._motion.duration(CROSSFADE_DURATION),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        outgoing.ease({
            opacity: 0,
            duration: this._motion.duration(CROSSFADE_DURATION),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: isFinished => {
                if (isFinished)
                    outgoing.content = null;
            },
        });
    }

    _createLayer() {
        const layer = new St.Widget({
            x_expand: true,
            y_expand: true,
            opacity: 0,
            content_gravity: Clutter.ContentGravity.RESIZE_FILL,
        });
        layer.set_content_scaling_filters(
            Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);

        return layer;
    }
});
