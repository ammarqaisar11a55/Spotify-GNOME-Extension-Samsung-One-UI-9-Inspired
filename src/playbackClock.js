import GLib from 'gi://GLib';

/**
 * MPRIS never signals the position while a track plays, so it is interpolated
 * from the last known sample. All times are in microseconds.
 */
export class PlaybackClock {
    constructor() {
        this._position = 0;
        this._sampledAt = GLib.get_monotonic_time();
        this._running = false;
        this._rate = 1;
    }

    get position() {
        if (!this._running)
            return this._position;

        const elapsed = GLib.get_monotonic_time() - this._sampledAt;
        return this._position + elapsed * this._rate;
    }

    sync(position) {
        this._position = position;
        this._sampledAt = GLib.get_monotonic_time();
    }

    setRunning(running) {
        if (running === this._running)
            return;

        this.sync(this.position);
        this._running = running;
    }

    setRate(rate) {
        if (rate === this._rate)
            return;

        this.sync(this.position);
        this._rate = rate;
    }
}
