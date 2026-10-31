import St from 'gi://St';

const REDUCED_FACTOR = 0.5;

/** Resolves the user's animation preference into concrete durations. */
export class Motion {
    constructor(settings) {
        this._settings = settings;
    }

    get enabled() {
        return this._settings.get_string('animations') !== 'off';
    }

    get breathes() {
        return this._settings.get_string('animations') === 'full' &&
            St.Settings.get().enable_animations;
    }

    /**
     * @param {number} milliseconds - the duration at full motion
     * @returns {number} the duration to use
     */
    duration(milliseconds) {
        switch (this._settings.get_string('animations')) {
        case 'off':
            return 0;
        case 'reduced':
            return milliseconds * REDUCED_FACTOR;
        default:
            return milliseconds;
        }
    }
}
