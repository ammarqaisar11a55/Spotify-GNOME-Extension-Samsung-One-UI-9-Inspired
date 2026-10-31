import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_FILES = 120;
const REQUEST_TIMEOUT_SECONDS = 15;

// Exponent of the superellipse that shapes the corners. 2 would be a circle.
const CORNER_EXPONENT = 2.6;
const SAMPLE_SIZE = 16;

// Older Spotify clients report a host that no longer serves images.
const LEGACY_IMAGE_HOST = 'https://open.spotify.com/image/';
const IMAGE_HOST = 'https://i.scdn.co/image/';

function normalizeUrl(url) {
    return url.startsWith(LEGACY_IMAGE_HOST)
        ? url.replace(LEGACY_IMAGE_HOST, IMAGE_HOST)
        : url;
}

function loadBytes(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_bytes_async(cancellable, (source, result) => {
            try {
                resolve(source.load_bytes_finish(result)[0]);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function decode(bytes, cancellable) {
    return new Promise((resolve, reject) => {
        const stream = Gio.MemoryInputStream.new_from_bytes(bytes);

        GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable, (_source, result) => {
            try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function roundCorners(pixels, rowstride, size, radius) {
    const end = size - 1;

    for (let y = 0; y < radius; y++) {
        for (let x = 0; x < radius; x++) {
            const dx = (radius - x - 0.5) / radius;
            const dy = (radius - y - 0.5) / radius;
            const distance = (dx ** CORNER_EXPONENT + dy ** CORNER_EXPONENT) ** (1 / CORNER_EXPONENT);
            const coverage = Math.clamp((1 - distance) * radius + 0.5, 0, 1);

            if (coverage === 1)
                continue;

            const alpha = Math.round(coverage * 255);
            pixels[y * rowstride + x * 4 + 3] = alpha;
            pixels[y * rowstride + (end - x) * 4 + 3] = alpha;
            pixels[(end - y) * rowstride + x * 4 + 3] = alpha;
            pixels[(end - y) * rowstride + (end - x) * 4 + 3] = alpha;
        }
    }
}

/**
 * Pixels are uploaded directly, not referenced from CSS, because St's texture
 * cache keeps every file it loads for a stylesheet for the life of the shell.
 */
function render(source, size, radius) {
    const width = source.get_width();
    const height = source.get_height();
    const side = Math.min(width, height);

    const square = source.new_subpixbuf(
        Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side);
    const pixbuf = square
        .scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR)
        .add_alpha(false, 0, 0, 0);

    const pixels = pixbuf.get_pixels();
    const rowstride = pixbuf.get_rowstride();
    roundCorners(pixels, rowstride, size, radius);

    const content = St.ImageContent.new_with_preferred_size(size, size);
    const coglContext = global.stage.context.get_backend().get_cogl_context();
    content.set_bytes(coglContext, new GLib.Bytes(pixels), Cogl.PixelFormat.RGBA_8888,
        size, size, rowstride);

    return content;
}

/* Average the image, favoring saturated pixels so the result has some color. */
function sampleColor(source) {
    const sample = source.scale_simple(SAMPLE_SIZE, SAMPLE_SIZE, GdkPixbuf.InterpType.BILINEAR);
    const pixels = sample.get_pixels();
    const rowstride = sample.get_rowstride();
    const channels = sample.get_n_channels();

    let red = 0, green = 0, blue = 0, total = 0;

    for (let y = 0; y < SAMPLE_SIZE; y++) {
        for (let x = 0; x < SAMPLE_SIZE; x++) {
            const offset = y * rowstride + x * channels;
            const [r, g, b] = pixels.subarray(offset, offset + 3);
            const max = Math.max(r, g, b);
            const saturation = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
            const weight = 0.02 + saturation ** 2;

            red += r * weight;
            green += g * weight;
            blue += b * weight;
            total += weight;
        }
    }

    return [red, green, blue].map(channel => Math.round(channel / total));
}

/** Fetches album art, caches it on disk and turns it into rounded textures. */
export class ArtworkLoader {
    constructor() {
        this._session = new Soup.Session({timeout: REQUEST_TIMEOUT_SECONDS});
        this._cacheDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'spotify-oneui', 'artwork']));
    }

    /**
     * @param {string} url - an https or file URL
     * @param {object} shape
     * @param {number} shape.size - the edge length in physical pixels
     * @param {number} shape.radius - the corner radius in physical pixels
     * @param {Gio.Cancellable} cancellable
     * @returns {Promise<{content: St.ImageContent, color: number[]}>}
     */
    async load(url, {size, radius}, cancellable) {
        const bytes = await this._fetch(normalizeUrl(url), cancellable);
        const source = await decode(bytes, cancellable);

        return {
            content: render(source, size, radius),
            color: sampleColor(source),
        };
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }

    _fetch(url, cancellable) {
        const scheme = GLib.uri_parse_scheme(url);

        if (scheme === 'file')
            return loadBytes(Gio.File.new_for_uri(url), cancellable);
        if (scheme === 'https')
            return this._fetchCached(url, cancellable);

        throw new Error(`Unsupported artwork URL: ${url}`);
    }

    async _fetchCached(url, cancellable) {
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        const file = this._cacheDir.get_child(name);

        try {
            return await loadBytes(file, cancellable);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw error;
        }

        const bytes = await this._download(url, cancellable);
        this._store(file, bytes).catch(error =>
            console.warn(`Could not cache artwork: ${error.message}`));

        return bytes;
    }

    _download(url, cancellable) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);

            this._session.send_and_read_async(message, GLib.PRIORITY_LOW, cancellable,
                (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);

                        if (message.get_status() !== Soup.Status.OK)
                            throw new Error(`HTTP ${message.get_status()}`);
                        if (bytes.get_size() > MAX_DOWNLOAD_BYTES)
                            throw new Error('Image is too large');

                        resolve(bytes);
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    async _store(file, bytes) {
        try {
            this._cacheDir.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw error;
        }

        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null, (source, result) => {
                    try {
                        source.replace_contents_finish(result);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
        });

        await this._prune();
    }

    async _prune() {
        const entries = await new Promise((resolve, reject) => {
            this._cacheDir.enumerate_children_async(
                'standard::name,time::modified', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW, null, (source, result) => {
                    try {
                        const enumerator = source.enumerate_children_finish(result);
                        enumerator.next_files_async(MAX_CACHED_FILES * 2, GLib.PRIORITY_LOW, null,
                            (_enumerator, filesResult) => {
                                try {
                                    resolve(enumerator.next_files_finish(filesResult));
                                } catch (error) {
                                    reject(error);
                                }
                            });
                    } catch (error) {
                        reject(error);
                    }
                });
        });

        entries
            .sort((a, b) => b.get_modification_date_time().to_unix() -
                a.get_modification_date_time().to_unix())
            .slice(MAX_CACHED_FILES)
            .forEach(info => this._cacheDir.get_child(info.get_name())
                .delete_async(GLib.PRIORITY_LOW, null, null));
    }
}
