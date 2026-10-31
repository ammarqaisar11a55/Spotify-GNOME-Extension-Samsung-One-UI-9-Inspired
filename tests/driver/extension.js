// Installed only inside the disposable headless shell. It lets the test script
// reach the shell's Eval and Screenshot D-Bus methods and press real pointer
// buttons, so that the player is exercised through its actual input path.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'spotify-oneui@ammarqaisar11a55.github.io';

function sleep(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

class TestApi {
    constructor() {
        const seat = global.stage.context.get_backend().get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    }

    get player() {
        return Main.extensionManager.lookup(UUID);
    }

    get indicator() {
        return this.player?.stateObj?._indicator ?? null;
    }

    get view() {
        return this.indicator?._view ?? null;
    }

    _moveTo(x, y) {
        this._pointer.notify_absolute_motion(global.get_current_time(), x, y);
    }

    _button(state) {
        this._pointer.notify_button(global.get_current_time(), Clutter.BUTTON_PRIMARY, state);
    }

    _center(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();

        return [x + width / 2, y + height / 2];
    }

    async click(actor, xFraction = 0.5) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        const target = [x + width * xFraction, y + height / 2];

        this._moveTo(...target);
        await sleep(80);
        this._button(Clutter.ButtonState.PRESSED);
        await sleep(60);
        this._button(Clutter.ButtonState.RELEASED);
        await sleep(180);
    }

    async drag(actor, fromFraction, toFraction) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        const middle = y + height / 2;

        this._moveTo(x + width * fromFraction, middle);
        await sleep(80);
        this._button(Clutter.ButtonState.PRESSED);
        await sleep(60);

        for (let i = 1; i <= 8; i++) {
            const fraction = fromFraction + (toFraction - fromFraction) * i / 8;
            this._moveTo(x + width * fraction, middle);
            await sleep(16);
        }

        const dragging = this.view._seekBar.dragging;
        const elapsed = this.view._elapsedLabel.text;
        this._button(Clutter.ButtonState.RELEASED);
        await sleep(180);

        return {dragging, elapsed};
    }

    async hover(actor) {
        this._moveTo(...this._center(actor));
        await sleep(200);
    }

    async parkPointer() {
        this._moveTo(4, 900);
        await sleep(200);
    }

    async pressKey(actor, key) {
        actor.grab_key_focus();
        const seat = global.stage.context.get_backend().get_default_seat();
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

        keyboard.notify_keyval(global.get_current_time(), key, Clutter.KeyState.PRESSED);
        await sleep(40);
        keyboard.notify_keyval(global.get_current_time(), key, Clutter.KeyState.RELEASED);
        await sleep(120);
    }

    rect(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();

        return {x, y, width, height};
    }

    settings() {
        return this.player.stateObj._settings;
    }

    panelBoxOf() {
        const container = this.indicator.container;
        const parent = container.get_parent();

        return {
            box: [['left', Main.panel._leftBox], ['center', Main.panel._centerBox],
                ['right', Main.panel._rightBox]].find(([, box]) => box === parent)?.[0],
            index: parent.get_children().indexOf(container),
        };
    }

    countOwnActors() {
        const count = actor => {
            const own = actor.style_class?.includes('spotify-oneui') ? 1 : 0;
            return actor.get_children().reduce((sum, child) => sum + count(child), own);
        };

        return count(global.stage);
    }
}

export default class DriverExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true;
        globalThis.spotifyTest = new TestApi();
    }

    disable() {
        global.context.unsafe_mode = false;
        delete globalThis.spotifyTest;
    }
}
