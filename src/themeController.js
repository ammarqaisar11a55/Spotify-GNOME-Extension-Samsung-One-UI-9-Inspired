import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const DARK_CLASS = 'spotify-oneui-dark';
const LIGHT_CLASS = 'spotify-oneui-light';

/** Keeps an actor's theme class in step with the user's choice and the desktop. */
export const ThemeController = GObject.registerClass({
    Signals: {
        'changed': {},
    },
}, class ThemeController extends GObject.Object {
    _init(settings, actor) {
        super._init();

        this._settings = settings;
        this._actor = actor;
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._settings.connectObject('changed::theme', () => this._update(), this);
        this._desktop.connectObject('changed::color-scheme', () => this._update(), this);
        this._update();
    }

    get isDark() {
        const theme = this._settings.get_string('theme');

        return theme === 'auto'
            ? this._desktop.get_string('color-scheme') === 'prefer-dark'
            : theme === 'dark';
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._desktop.disconnectObject(this);
    }

    _update() {
        const dark = this.isDark;

        this._actor.remove_style_class_name(dark ? LIGHT_CLASS : DARK_CLASS);
        this._actor.add_style_class_name(dark ? DARK_CLASS : LIGHT_CLASS);
        this.emit('changed');
    }
});
