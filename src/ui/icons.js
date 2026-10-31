import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * @param {string} name - an icon from the extension's icons directory
 * @returns {Gio.Icon} a symbolic icon that takes on the actor's text color
 */
export function loadIcon(name) {
    const {path} = Extension.lookupByURL(import.meta.url);

    return Gio.icon_new_for_string(`${path}/icons/spotify-oneui-${name}-symbolic.svg`);
}
