// End-to-end checks against the real extension in a headless shell, with the
// mock player on a private bus. Run through tests/run-headless.sh.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'spotify-oneui@ammarqaisar11a55.github.io';
const OUTPUT = GLib.getenv('TEST_OUTPUT');
const ROOT = GLib.getenv('TEST_ROOT');
const bus = Gio.DBus.session;

let passed = 0;
const failures = [];

function sleep(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function call(name, path, iface, method, parameters, replyType) {
    return new Promise((resolve, reject) => {
        bus.call(name, path, iface, method, parameters,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, 20000, null, (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

/* Runs an expression in the shell. It may await and must produce JSON. */
async function shell(code) {
    const wrapped = `(async () => JSON.stringify(await (async () => { ${code} })() ?? null))()`;
    const reply = await call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
        new GLib.Variant('(s)', [wrapped]), '(bs)');
    const [ok, text] = reply.deepUnpack();

    if (!ok)
        throw new Error(`Eval failed: ${text}\n${code}`);

    return JSON.parse(JSON.parse(text) ?? 'null');
}

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        print(`ok    ${name}`);
    } else {
        failures.push(name);
        print(`FAIL  ${name} ${detail}`);
    }
}

function equal(name, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    check(name, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let mock = null;

async function startMock(...args) {
    mock = Gio.Subprocess.new(['gjs', '-m', `${ROOT}/tests/mock-spotify.js`, ...args],
        Gio.SubprocessFlags.NONE);
    await sleep(1400);
}

async function stopMock() {
    mock.send_signal(9);
    mock = null;
    await sleep(500);
}

async function mockCalls() {
    const reply = await call('org.mpris.MediaPlayer2.spotify', '/org/spotifyoneui/MockControl',
        'org.spotifyoneui.MockControl', 'Calls', null, '(s)');
    return JSON.parse(reply.deepUnpack()[0]);
}

function clearCalls() {
    return call('org.mpris.MediaPlayer2.spotify', '/org/spotifyoneui/MockControl',
        'org.spotifyoneui.MockControl', 'ClearCalls', null, null);
}

function setArtUrl(url) {
    return call('org.mpris.MediaPlayer2.spotify', '/org/spotifyoneui/MockControl',
        'org.spotifyoneui.MockControl', 'SetArtUrl', new GLib.Variant('(s)', [url]), null);
}

function setMockEmpty() {
    return call('org.mpris.MediaPlayer2.spotify', '/org/spotifyoneui/MockControl',
        'org.spotifyoneui.MockControl', 'SetEmptyMetadata', null, null);
}

function mockPosition() {
    return call('org.mpris.MediaPlayer2.spotify', '/org/mpris/MediaPlayer2',
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']), '(v)')
        .then(reply => Number(reply.recursiveUnpack()[0]));
}

const openMenu = () => shell(`spotifyTest.indicator.menu.open(true);
    await new Promise(r => setTimeout(r, 420));`);
const closeMenu = () => shell(`spotifyTest.indicator.menu.close(true);
    await new Promise(r => setTimeout(r, 300));`);
const clickView = (actor, fraction = 0.5) =>
    shell(`await spotifyTest.click(spotifyTest.view.${actor}, ${fraction});`);
const setting = (kind, key, value) =>
    shell(`spotifyTest.settings().set_${kind}('${key}', ${JSON.stringify(value)});
        await new Promise(r => setTimeout(r, 450));`);
const viewText = label => shell(`return spotifyTest.view.${label}.text;`);
const viewVisible = actor => shell(`return spotifyTest.view.${actor}.visible;`);

async function screenshot(name, {keepPointer = false} = {}) {
    if (!keepPointer)
        await shell('await spotifyTest.parkPointer();');

    const {x, y, width, height, stageWidth, stageHeight} = await shell(
        `return {...spotifyTest.rect(spotifyTest.indicator.menu.box),
            stageWidth: global.stage.width, stageHeight: global.stage.height};`);
    const margin = 44;
    const left = Math.max(0, Math.floor(x - margin));
    const top = Math.max(0, Math.floor(y - margin));
    const right = Math.min(stageWidth, Math.ceil(x + width + margin));
    const bottom = Math.min(stageHeight, Math.ceil(y + height + margin));
    const path = `${OUTPUT}/${name}.png`;

    await call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'ScreenshotArea',
        new GLib.Variant('(iiiibs)', [left, top, right - left, bottom - top, false, path]), '(bs)');
}

async function waitForShell() {
    for (let i = 0; i < 80; i++) {
        try {
            await shell('return Main.layoutManager._startingUp === false;');
        } catch {
            // Not up yet, or the driver has not unlocked Eval.
            await sleep(250);
            continue;
        }

        const ready = await shell('return !!globalThis.spotifyTest?.indicator;').catch(() => false);
        if (ready)
            return;
        await sleep(250);
    }

    throw new Error('The shell never became ready');
}

async function testNotRunning() {
    equal('extension is active', await shell(
        `return Main.extensionManager.lookup('${UUID}').state;`), 1);
    equal('no extension error', await shell(
        `return Main.extensionManager.lookup('${UUID}').error ?? '';`), '');

    await shell('Main.overview.hide(); await new Promise(r => setTimeout(r, 600));');
    await openMenu();

    check('placeholder shows when Spotify is absent', await viewVisible('_placeholder'));
    check('player hides when Spotify is absent', !await viewVisible('_player'));
    await screenshot('not-running');
    await closeMenu();
}

async function testConnects() {
    await startMock();

    check('player shows once Spotify appears', await viewVisible('_player'));
    check('placeholder hides once Spotify appears', !await viewVisible('_placeholder'));
    equal('title comes from metadata', await viewText('_titleLabel'), 'Midnight City Lights');
    equal('artist comes from metadata', await viewText('_artistLabel'), 'Aurora Vale');
    equal('album comes from metadata', await viewText('_albumLabel'), 'Neon Horizons');
    equal('duration comes from metadata', await viewText('_durationLabel'), '3:34');
    equal('status reads Playing', await viewText('_statusLabel'), 'Playing');
    equal('panel shows the track', await shell('return spotifyTest.indicator._label.text;'),
        'Midnight City Lights · Aurora Vale');
    check('panel marks playback', await shell(
        `return spotifyTest.indicator.has_style_class_name('spotify-oneui-playing');`));

    await openMenu();
    await sleep(400);

    check('artwork was rendered', await shell(
        'return spotifyTest.view._artworkView._front.content !== null;'));
    check('progress position is ahead of the start',
        await shell('return spotifyTest.view._seekBar.value;') > 0.05);
    await screenshot('expanded-dark');
}

async function testControls() {
    await clearCalls();
    await clickView('_playButton');
    await sleep(200);
    equal('pause was sent', await mockCalls(), ['PlayPause']);
    equal('status reads Paused', await viewText('_statusLabel'), 'Paused');
    check('panel marks paused', await shell(
        `return spotifyTest.indicator.has_style_class_name('spotify-oneui-paused');`));
    equal('button now offers play', await shell(
        'return spotifyTest.view._playButton.accessible_name;'), 'Play');
    await screenshot('expanded-dark-paused');

    await clearCalls();
    await clickView('_playButton');
    await sleep(200);
    equal('play was sent', await mockCalls(), ['PlayPause']);

    await clearCalls();
    await clickView('_nextButton');
    await sleep(500);
    equal('next was sent', await mockCalls(), ['Next']);
    check('long title reached the label', (await viewText('_titleLabel')).startsWith('A Considerably'));
    equal('two artists are joined', await viewText('_artistLabel'),
        'The Long Names, Featuring Somebody Else Entirely');
    equal('hour long duration is formatted', await viewText('_durationLabel'), '1:23:45');
    equal('position restarts with the track',
        await shell('return Math.floor(spotifyTest.view._client.position / 1e6);'), 0);
    await sleep(500);
    await screenshot('expanded-dark-long-title');

    await clearCalls();
    await clickView('_previousButton');
    await sleep(500);
    equal('previous was sent', await mockCalls(), ['Previous']);
    equal('previous restored the title', await viewText('_titleLabel'), 'Midnight City Lights');

    await clearCalls();
    await clickView('_shuffleButton');
    await sleep(300);
    equal('shuffle was written', await mockCalls(), ['Shuffle true']);
    check('shuffle shows as active', await shell('return spotifyTest.view._shuffleButton.checked;'));
    await sleep(1100);
    check('shuffle stays offered when honored', await viewVisible('_shuffleButton'));

    await clearCalls();
    await clickView('_repeatButton');
    await sleep(1100);
    await clickView('_repeatButton');
    await sleep(1100);
    await clickView('_repeatButton');
    await sleep(1100);
    equal('repeat cycles through all states', await mockCalls(),
        ['LoopStatus Playlist', 'LoopStatus Track', 'LoopStatus None']);
    check('repeat stays offered when honored', await viewVisible('_repeatButton'));
    await clickView('_repeatButton');
    await sleep(1100);
    await clickView('_repeatButton');
    await sleep(1100);
    await screenshot('expanded-dark-toggles-on');
}

async function testSeeking() {
    const trackId = '/com/spotify/track/4uLU6hMCjMI75M1A2tKUQC';

    await clearCalls();
    await clickView('_seekBar', 0.5);
    await sleep(200);

    let calls = await mockCalls();
    check('click seeks with SetPosition', calls.length === 1 && calls[0].startsWith(`SetPosition ${trackId}`),
        JSON.stringify(calls));
    const clicked = Number(calls[0]?.split(' ')[2]) / 1e6;
    check('click lands near the middle', Math.abs(clicked - 107) < 8, `landed at ${clicked}`);
    check('mock position follows the click', Math.abs(await mockPosition() / 1e6 - 107) < 9);

    await clearCalls();
    const drag = await shell(
        'return spotifyTest.drag(spotifyTest.view._seekBar, 0.2, 0.75);');
    await sleep(200);
    check('dragging is tracked', drag.dragging);
    check('time previews during a drag', drag.elapsed.startsWith('2:3') || drag.elapsed.startsWith('2:4'),
        drag.elapsed);

    calls = await mockCalls();
    check('drag seeks once, on release', calls.length === 1, JSON.stringify(calls));
    const dragged = Number(calls[0]?.split(' ')[2]) / 1e6;
    check('drag lands near the release point', Math.abs(dragged - 160) < 8, `landed at ${dragged}`);

    await clearCalls();
    await shell('await spotifyTest.pressKey(spotifyTest.view._seekBar, 0xff51);');
    await sleep(450);
    calls = await mockCalls();
    check('left arrow seeks backward', calls.length === 1 && calls[0].startsWith('SetPosition'),
        JSON.stringify(calls));
}

async function testTrackEdgeCases() {
    await clearCalls();
    await clickView('_previousButton');
    await sleep(700);
    equal('track without artwork loads', await viewText('_titleLabel'), 'No Cover Here');
    check('album label hides when empty', !await viewVisible('_albumLabel'));
    check('fallback shows without artwork', await shell(
        'return spotifyTest.view._artworkView._front.content === null;'));
    await screenshot('expanded-dark-no-cover');
}

async function testArtworkSources() {
    const showsCover = () => shell('return spotifyTest.view._artworkView._front.content !== null;');
    const cached = () => shell(`
        const dir = imports.gi.GLib.build_filenamev(
            [imports.gi.GLib.get_user_cache_dir(), 'spotify-oneui', 'artwork']);
        const file = imports.gi.Gio.File.new_for_path(dir);
        if (!file.query_exists(null))
            return 0;
        const entries = file.enumerate_children('standard::name', 0, null);
        let count = 0;
        while (entries.next_file(null))
            count++;
        return count;`);

    await setArtUrl('http://example.com/cover.jpg');
    await sleep(600);
    check('plain http artwork falls back', !await showsCover());

    await setArtUrl(`file://${ROOT}/README-does-not-exist.jpg`);
    await sleep(600);
    check('missing artwork falls back', !await showsCover());

    await setArtUrl(`file://${ROOT}/metadata.json`);
    await sleep(600);
    check('undecodable artwork falls back', !await showsCover());

    const image = GLib.getenv('TEST_HTTPS_ART');
    if (!image) {
        print('skip  https artwork, TEST_HTTPS_ART is not set');
        return;
    }

    await setArtUrl(image);
    await sleep(3000);
    check('https artwork is downloaded and shown', await showsCover());
    equal('https artwork is cached on disk', await cached(), 1);

    await setArtUrl('');
    await sleep(500);
    await setArtUrl(image);
    await sleep(800);
    check('cached artwork shows again', await showsCover());
    equal('the cache does not duplicate entries', await cached(), 1);
}

async function testAppearance() {
    await clickView('_nextButton');
    await sleep(600);

    await setting('string', 'theme', 'light');
    check('light theme applies', await shell(
        `return spotifyTest.indicator.menu.actor.has_style_class_name('spotify-oneui-light');`));
    await screenshot('expanded-light');

    await setting('string', 'layout', 'compact');
    await sleep(600);
    check('compact hides the hero', !await viewVisible('_hero'));
    await screenshot('compact-light');

    await setting('string', 'theme', 'dark');
    await screenshot('compact-dark');

    await setting('boolean', 'show-artwork', false);
    check('artwork can be turned off in compact', !await viewVisible('_artworkView'));
    await setting('boolean', 'show-artwork', true);
    await sleep(500);
    check('artwork comes back in compact', await viewVisible('_artworkView'));

    await setting('string', 'theme', 'auto');
    check('auto follows the desktop', await shell(
        `return spotifyTest.indicator.menu.actor.has_style_class_name('spotify-oneui-dark');`));
    await shell(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'})
        .set_string('color-scheme', 'default');
        await new Promise(r => setTimeout(r, 450));`);
    check('auto reacts to a desktop change', await shell(
        `return spotifyTest.indicator.menu.actor.has_style_class_name('spotify-oneui-light');`));
    await shell(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'})
        .set_string('color-scheme', 'prefer-dark');
        await new Promise(r => setTimeout(r, 450));`);

    await setting('string', 'layout', 'expanded');
    await setting('boolean', 'show-artwork', false);
    await sleep(500);
    check('artwork can be turned off', !await viewVisible('_artworkView'));
    await screenshot('no-artwork-dark');
    await setting('boolean', 'show-artwork', true);
    await sleep(600);

    await setting('boolean', 'show-shuffle', false);
    check('shuffle control can be hidden', !await viewVisible('_shuffleButton'));
    await setting('boolean', 'show-shuffle', true);
    await setting('boolean', 'show-repeat', false);
    check('repeat control can be hidden', !await viewVisible('_repeatButton'));
    await setting('boolean', 'show-repeat', true);

    await setting('boolean', 'show-panel-track', false);
    check('panel text can be hidden', !await shell('return spotifyTest.indicator._label.visible;'));
    await setting('boolean', 'show-panel-track', true);
    await closeMenu();
}

async function testAnimationLevels() {
    await setting('string', 'animations', 'off');
    await shell('spotifyTest.indicator.menu.open(true);');
    await sleep(80);
    equal('no animation opens instantly', await shell(
        'return spotifyTest.indicator.menu.actor.opacity;'), 255);
    await closeMenu();

    await setting('string', 'animations', 'reduced');
    await openMenu();
    const before = await shell('return spotifyTest.view._seekBar._phase;');
    await sleep(300);
    equal('reduced keeps the waveform still',
        await shell('return spotifyTest.view._seekBar._phase;'), before);
    await closeMenu();

    await setting('string', 'animations', 'full');
    await openMenu();
    const phase = await shell('return spotifyTest.view._seekBar._phase;');
    await sleep(300);
    check('full motion breathes while open',
        await shell('return spotifyTest.view._seekBar._phase;') !== phase);
    await closeMenu();
    check('nothing ticks while closed',
        !await shell('return spotifyTest.view._timeline.is_playing();'));
}

async function testPanelPosition() {
    equal('indicator starts on the right',
        (await shell('return spotifyTest.panelBoxOf();')).box, 'right');
    await setting('string', 'panel-position', 'left');
    equal('indicator moves left', (await shell('return spotifyTest.panelBoxOf();')).box, 'left');
    await setting('string', 'panel-position', 'center');
    equal('indicator moves to the center',
        (await shell('return spotifyTest.panelBoxOf();')).box, 'center');
    await setting('string', 'panel-position', 'right');
    await setting('int', 'panel-index', 1);
    equal('indicator takes its order', await shell('return spotifyTest.panelBoxOf();'),
        {box: 'right', index: 1});
    await setting('int', 'panel-index', 0);
}

async function testDisconnect() {
    await openMenu();
    await stopMock();
    check('placeholder returns when Spotify exits', await viewVisible('_placeholder'));
    check('panel clears its status', !await shell(
        `return spotifyTest.indicator.has_style_class_name('spotify-oneui-playing');`));
    check('panel hides the track', !await shell('return spotifyTest.indicator._label.visible;'));
    check('view survives the exit', await shell('return spotifyTest.view !== null;'));

    await startMock();
    check('player recovers when Spotify returns', await viewVisible('_player'));
    equal('metadata recovers', await viewText('_titleLabel'), 'Midnight City Lights');

    await setMockEmpty();
    await sleep(300);
    check('idle placeholder shows with no track', await viewVisible('_placeholder'));
    equal('idle message is shown', await shell(
        'return spotifyTest.view._placeholder._title.text;'), 'Nothing playing');
    await screenshot('idle-dark');
    await closeMenu();
    await stopMock();
}

async function testLegacyClient() {
    await startMock('--legacy');
    await openMenu();
    await sleep(300);

    check('shuffle is offered before it is tried', await viewVisible('_shuffleButton'));
    await clickView('_shuffleButton');
    await sleep(1300);
    check('ignored shuffle disappears', !await viewVisible('_shuffleButton'));
    check('ignored shuffle does not stay active', !await shell(
        'return spotifyTest.view._client.shuffle;'));

    await clickView('_repeatButton');
    await sleep(1300);
    check('ignored repeat disappears', !await viewVisible('_repeatButton'));

    await clearCalls();
    await clickView('_seekBar', 0.5);
    await sleep(700);
    const [seekCall] = await mockCalls();
    check('invalid track ids fall back to a relative seek', seekCall?.startsWith('Seek '), seekCall);
    const position = await shell('return spotifyTest.view._client.position / 1e6;');
    check('seek holds without a Seeked signal', Math.abs(position - 107) < 9, `at ${position}`);
    await screenshot('legacy-client');

    await stopMock();
    await startMock();
    check('support is re-checked when Spotify restarts', await viewVisible('_shuffleButton'));
    await closeMenu();
}

async function testLifecycle() {
    const baseline = await shell('return spotifyTest.countOwnActors();');

    for (let i = 0; i < 5; i++) {
        await shell(`Main.extensionManager.disableExtension('${UUID}');
            await new Promise(r => setTimeout(r, 250));`);
        equal(`disable ${i + 1} leaves no actors`, await shell('return spotifyTest.countOwnActors();'), 0);
        await shell(`Main.extensionManager.enableExtension('${UUID}');
            await new Promise(r => setTimeout(r, 450));`);
    }

    equal('re-enable restores the same actors',
        await shell('return spotifyTest.countOwnActors();'), baseline);

    await openMenu();
    await shell(`Main.extensionManager.disableExtension('${UUID}');
        await new Promise(r => setTimeout(r, 300));`);
    equal('disable with the popup open is clean',
        await shell('return spotifyTest.countOwnActors();'), 0);
    await shell(`Main.extensionManager.enableExtension('${UUID}');
        await new Promise(r => setTimeout(r, 450));`);
    await stopMock();

    equal('extension survives the cycles', await shell(
        `return Main.extensionManager.lookup('${UUID}').state;`), 1);
}

async function testInteractionStates() {
    await shell('Main.overview.hide(); await new Promise(r => setTimeout(r, 600));');
    await startMock();
    await openMenu();
    await sleep(400);

    await shell('await spotifyTest.hover(spotifyTest.view._seekBar);');
    check('hovering reaches the seek bar', await shell('return spotifyTest.view._seekBar.hover;'));
    await screenshot('hover-seek', {keepPointer: true});

    await shell('await spotifyTest.hover(spotifyTest.view._nextButton);');
    check('hovering reaches a control', await shell('return spotifyTest.view._nextButton.hover;'));
    await screenshot('hover-next', {keepPointer: true});

    await shell(`spotifyTest.view._playButton.grab_key_focus();
        await new Promise(r => setTimeout(r, 200));`);
    await screenshot('focus-play');

    await clearCalls();
    await shell('await spotifyTest.pressKey(spotifyTest.view._playButton, 0x20);');
    await sleep(200);
    equal('space activates the focused control', await mockCalls(), ['PlayPause']);

    await closeMenu();
    await stopMock();
}

/* Tracks skipping faster than artwork can load, with memory measured around it. */
async function testRapidSkips() {
    const residentKb = () => shell(`
        const [, bytes] = imports.gi.GLib.file_get_contents('/proc/self/status');
        const text = new TextDecoder().decode(bytes);
        return Number(text.match(/VmRSS:\\s+(\\d+)/)[1]);`);

    await shell('Main.overview.hide(); await new Promise(r => setTimeout(r, 600));');
    await startMock();
    await openMenu();
    await sleep(600);

    const skip = (count, gap) => shell(`
        for (let i = 0; i < ${count}; i++) {
            spotifyTest.view._client.next();
            await new Promise(r => setTimeout(r, ${gap}));
        }`);

    await skip(10, 5);
    await sleep(1200);
    equal('rapid skips settle on the right track', await viewText('_titleLabel'),
        'A Considerably Longer Song Title That Cannot Possibly Fit On One Line');
    check('rapid skips settle on its artwork', await shell(
        'return spotifyTest.view._artworkView._front.content !== null;'));

    await skip(60, 60);
    await sleep(800);
    const before = await residentKb();
    await skip(300, 60);
    await sleep(1500);
    const after = await residentKb();

    print(`info  resident memory across 300 track changes: ${before} kB to ${after} kB`);
    check('memory stays bounded across 300 track changes', after - before < 60000,
        `grew by ${after - before} kB`);

    await closeMenu();
    await stopMock();
}

/* Needs a short monitor: TEST_MONITOR=1280x560 TEST_ONLY=testShortScreen */
async function testShortScreen() {
    await shell('Main.overview.hide(); await new Promise(r => setTimeout(r, 600));');
    await startMock();
    await openMenu();
    await sleep(500);

    check('short screens fall back to compact', !await viewVisible('_hero'));
    const {y, height} = await shell('return spotifyTest.rect(spotifyTest.indicator.menu.box);');
    check('popup fits on a short screen', y + height <= 560, `bottom at ${y + height}`);
    await screenshot('short-screen');
    await closeMenu();
    await stopMock();
}

/* Needs a large monitor: TEST_MONITOR=2560x1600 TEST_ONLY=testHiDpi */
async function testHiDpi() {
    const displayConfig = ['org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
        'org.gnome.Mutter.DisplayConfig'];

    await shell('Main.overview.hide(); await new Promise(r => setTimeout(r, 600));');

    const reply = await call(...displayConfig, 'GetCurrentState', null, null);
    const [serial, monitors] = reply.deepUnpack();
    const [[connector], modes] = monitors[0].deepUnpack?.() ?? monitors[0];
    const mode = modes.find(([id]) => id.includes('2560')) ?? modes[0];

    await call(...displayConfig, 'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [serial, 1,
            [[0, 0, 2, 0, true, [[connector, mode[0], {}]]]], {}]), null);
    await sleep(1500);

    equal('monitor runs at 2x', await shell('return global.display.get_monitor_scale(0);'), 2);

    await startMock();
    await openMenu();
    await sleep(600);

    equal('artwork renders at physical resolution', await shell(
        'return spotifyTest.view._artworkView._front.content.get_preferred_size().slice(1);'),
    [640, 640]);
    await screenshot('hidpi');
    await closeMenu();
    await stopMock();
}

/* Opens the real preferences app against the disposable shell. */
async function testPreferences() {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('WAYLAND_DISPLAY', 'test-0', true);
    launcher.setenv('GDK_BACKEND', 'wayland', true);

    const app = launcher.spawnv(['gjs', '-m', '/usr/share/gnome-shell/org.gnome.Shell.Extensions']);
    await sleep(1500);

    await call('org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
        'org.gnome.Shell.Extensions', 'OpenExtensionPrefs',
        new GLib.Variant('(ssa{sv})', [UUID, '', {}]), null);
    await sleep(3500);

    const windows = await shell(`return global.get_window_actors()
        .map(actor => actor.meta_window.get_title());`);
    check('preferences window opens', windows.includes('Spotify One UI Player'),
        JSON.stringify(windows));

    const area = await shell(`const actor = global.get_window_actors().find(
        a => a.meta_window.get_title() === 'Spotify One UI Player');
        const rect = actor.meta_window.get_frame_rect();
        return [rect.x, rect.y, rect.width, rect.height];`);
    await call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'ScreenshotArea',
        new GLib.Variant('(iiiibs)', [...area, false, `${OUTPUT}/preferences.png`]), '(bs)');

    app.send_signal(15);
    await sleep(300);
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 0;

(async () => {
    await waitForShell();

    const only = GLib.getenv('TEST_ONLY');
    const suites = {
        testNotRunning, testConnects, testControls, testSeeking, testTrackEdgeCases,
        testArtworkSources, testAppearance, testAnimationLevels, testPanelPosition,
        testDisconnect, testLegacyClient, testLifecycle, testInteractionStates,
        testRapidSkips, testPreferences,
    };
    const onRequest = {testShortScreen, testHiDpi};

    for (const [name, suite] of Object.entries({...suites, ...onRequest})) {
        if (only ? !only.split(',').includes(name) : name in onRequest)
            continue;

        print(`\n# ${name}`);
        try {
            await suite();
        } catch (error) {
            failures.push(name);
            print(`FAIL  ${name} threw: ${error.message}\n${error.stack}`);
        }
    }
})().catch(error => {
    failures.push('setup');
    print(`FAIL  setup: ${error.message}`);
}).finally(() => {
    mock?.send_signal(9);
    print(`\n${passed} passed, ${failures.length} failed`);
    exitCode = failures.length > 0 ? 1 : 0;
    loop.quit();
});

loop.run();
imports.system.exit(exitCode);
