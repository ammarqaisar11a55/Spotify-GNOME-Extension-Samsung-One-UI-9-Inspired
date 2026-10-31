import Shell from 'gi://Shell';

// Snap, distribution package and Flatpak, in that order.
const DESKTOP_IDS = [
    'spotify_spotify.desktop',
    'spotify.desktop',
    'com.spotify.Client.desktop',
];

/** @returns {Shell.App|null} the installed Spotify application, if any */
export function findSpotifyApp() {
    const appSystem = Shell.AppSystem.get_default();

    for (const id of DESKTOP_IDS) {
        const app = appSystem.lookup_app(id);
        if (app)
            return app;
    }

    return null;
}
