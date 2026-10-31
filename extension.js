import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ArtworkLoader} from './src/artwork.js';
import {SpotifyClient} from './src/spotifyClient.js';
import {SpotifyIndicator} from './src/ui/indicator.js';

export default class SpotifyOneUIExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._client = new SpotifyClient();
        this._artwork = new ArtworkLoader();

        this._settings.connectObject(
            'changed::panel-position', () => this._placeIndicator(),
            'changed::panel-index', () => this._placeIndicator(),
            this);

        this._placeIndicator();
    }

    disable() {
        this._settings.disconnectObject(this);

        this._indicator?.destroy();
        this._indicator = null;

        this._artwork.destroy();
        this._artwork = null;

        this._client.destroy();
        this._client = null;

        this._settings = null;
    }

    /* The panel has no API for moving a status item, so it is created again. */
    _placeIndicator() {
        this._indicator?.destroy();

        this._indicator = new SpotifyIndicator({
            client: this._client,
            artwork: this._artwork,
            settings: this._settings,
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator,
            this._settings.get_int('panel-index'),
            this._settings.get_string('panel-position'));
    }
}
