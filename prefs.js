import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function createChoiceRow(settings, key, title, subtitle, choices) {
    const values = Object.keys(choices);
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(Object.values(choices)),
        selected: Math.max(values.indexOf(settings.get_string(key)), 0),
    });

    row.connect('notify::selected', () => {
        settings.set_string(key, values[row.selected]);
    });

    const changedId = settings.connect(`changed::${key}`, () => {
        row.selected = Math.max(values.indexOf(settings.get_string(key)), 0);
    });
    row.connect('destroy', () => settings.disconnect(changedId));

    return row;
}

function createSwitchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);

    return row;
}

function createGroup(title, rows) {
    const group = new Adw.PreferencesGroup({title});

    for (const row of rows)
        group.add(row);

    return group;
}

export default class SpotifyOneUIPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Bindings and handlers share the window's lifetime through this.
        window._settings = settings;
        window.set_default_size(560, 860);
        window.search_enabled = true;

        const page = new Adw.PreferencesPage({
            title: 'Player',
            icon_name: 'audio-x-generic-symbolic',
        });

        page.add(createGroup('Appearance', [
            createChoiceRow(settings, 'theme', 'Theme', 'Match the desktop or choose one', {
                auto: 'Automatic',
                dark: 'Dark',
                light: 'Light',
            }),
            createChoiceRow(settings, 'layout', 'Player size', 'Compact uses less of the screen', {
                expanded: 'Expanded',
                compact: 'Compact',
            }),
            createSwitchRow(settings, 'show-artwork', 'Album artwork',
                'Show the cover in the player'),
        ]));

        const positionIndex = new Adw.SpinRow({
            title: 'Order in section',
            subtitle: '0 places the indicator first',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 32,
                step_increment: 1,
                page_increment: 4,
            }),
        });
        settings.bind('panel-index', positionIndex, 'value', Gio.SettingsBindFlags.DEFAULT);

        page.add(createGroup('Top panel', [
            createSwitchRow(settings, 'show-panel-track', 'Track information',
                'Show the title and artist next to the icon'),
            createChoiceRow(settings, 'panel-position', 'Panel section',
                'Where the indicator sits in the top panel', {
                    left: 'Left',
                    center: 'Center',
                    right: 'Right',
                }),
            positionIndex,
        ]));

        page.add(createGroup('Controls', [
            createSwitchRow(settings, 'show-shuffle', 'Shuffle', 'Show the shuffle button'),
            createSwitchRow(settings, 'show-repeat', 'Repeat', 'Show the repeat button'),
        ]));

        page.add(createGroup('Motion', [
            createChoiceRow(settings, 'animations', 'Animations',
                'Reduced keeps transitions short and the waveform still', {
                    full: 'Full',
                    reduced: 'Reduced',
                    off: 'Off',
                }),
        ]));

        window.add(page);
    }
}
