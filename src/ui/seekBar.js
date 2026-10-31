import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const SAMPLE_COUNT = 64;
const MIN_AMPLITUDE = 0.14;
const BREATH_DEPTH = 0.16;
const BREATH_SPREAD = 0.55;
const SEEK_DEBOUNCE_MS = 220;

/* Maps a track to a stable shape, so each song keeps its own silhouette. */
function shapeForTrack(trackId) {
    let hash = 2166136261;
    for (let i = 0; i < trackId.length; i++)
        hash = Math.imul(hash ^ trackId.charCodeAt(i), 16777619);

    const random = () => {
        hash = Math.imul(hash ^ (hash >>> 15), 2246822519);
        hash = Math.imul(hash ^ (hash >>> 13), 3266489917);
        return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
    };

    let level = random();
    return Array.from({length: SAMPLE_COUNT}, () => {
        level += (random() - level) * 0.72;
        return MIN_AMPLITUDE + (1 - MIN_AMPLITUDE) * level;
    });
}

/**
 * A slider drawn as a waveform. MPRIS exposes no audio data, so the shape is
 * decorative: it is derived from the track id, not from the sound.
 */
export const SeekBar = GObject.registerClass({
    Signals: {
        'seek-requested': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class SeekBar extends Slider {
    _init() {
        super._init(0);

        this.add_style_class_name('spotify-oneui-seek');

        this._shape = shapeForTrack('');
        this._phase = 0;
        this._dragging = false;
        this._settingProgress = false;
        this._debounceId = 0;
        this._barWidth = 0;
        this._barGap = 0;

        this.connect('notify::hover', () => this.queue_repaint());
        this.connect('notify::value', () => this._onValueChanged());
        this.connect('drag-begin', () => {
            this._dragging = true;
            this.queue_repaint();
        });
        this.connect('drag-end', () => {
            this._dragging = false;
            this.queue_repaint();
            this.emit('seek-requested', this.value);
        });
        this.connect('destroy', () => this._clearDebounce());
    }

    get dragging() {
        return this._dragging;
    }

    setTrack(trackId) {
        this._shape = shapeForTrack(trackId);
        this.queue_repaint();
    }

    setProgress(progress) {
        if (this._dragging)
            return;

        this._settingProgress = true;
        this.value = progress;
        this._settingProgress = false;
    }

    setPhase(phase) {
        this._phase = phase;
        this.queue_repaint();
    }

    vfunc_style_changed() {
        super.vfunc_style_changed();

        const themeNode = this.get_theme_node();
        this._barWidth = themeNode.get_length('-seek-bar-width');
        this._barGap = themeNode.get_length('-seek-bar-gap');
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const themeNode = this.get_theme_node();
        const [width, height] = this.get_surface_size();
        const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;

        const progress = this.value * width;
        const edge = rtl ? width - progress : progress;
        const [playedStart, idleStart] = rtl ? [edge, 0] : [0, edge];

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(this._barWidth);

        cr.save();
        cr.rectangle(idleStart, 0, width - progress, height);
        cr.clip();
        this._traceBars(cr, width, height);
        cr.setSourceColor(themeNode.get_color('-barlevel-background-color'));
        cr.stroke();
        cr.restore();

        cr.save();
        cr.rectangle(playedStart, 0, progress, height);
        cr.clip();
        this._traceBars(cr, width, height);
        cr.setSourceColor(themeNode.get_color('-barlevel-active-background-color'));
        cr.stroke();
        cr.restore();

        if (this.hover || this._dragging) {
            const inset = this._barWidth / 2;

            cr.setLineWidth(this._barWidth);
            cr.moveTo(Math.clamp(edge, inset, width - inset), inset);
            cr.lineTo(Math.clamp(edge, inset, width - inset), height - inset);
            cr.setSourceColor(themeNode.get_foreground_color());
            cr.stroke();
        }

        cr.$dispose();
    }

    _traceBars(cr, width, height) {
        const pitch = this._barWidth + this._barGap;
        const count = Math.floor((width + this._barGap) / pitch);
        const offset = (width - (count * pitch - this._barGap)) / 2;
        const middle = height / 2;
        const usable = height - this._barWidth;

        for (let i = 0; i < count; i++) {
            const sample = this._shape[Math.floor(i * SAMPLE_COUNT / count)];
            const breath = 1 + BREATH_DEPTH * Math.sin(this._phase + i * BREATH_SPREAD);
            const half = Math.min(sample * breath, 1) * usable / 2;
            const x = offset + i * pitch + this._barWidth / 2;

            cr.moveTo(x, middle - half);
            cr.lineTo(x, middle + half);
        }
    }

    _onValueChanged() {
        if (this._settingProgress || this._dragging)
            return;

        // Scrolling and arrow keys step many times in a row, send only the last.
        this._clearDebounce();
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEEK_DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this.emit('seek-requested', this.value);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearDebounce() {
        if (this._debounceId)
            GLib.source_remove(this._debounceId);
        this._debounceId = 0;
    }
});
