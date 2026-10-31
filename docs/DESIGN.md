# Design system

How Samsung One UI 9's media player is translated into a GNOME Shell popup.
This document is the source of truth for tokens. St has no CSS variables, so
`stylesheet.css` repeats these values literally.

## What was taken from One UI 9

Reported changes in the One UI 9 media player, compared with One UI 8.5, and
how each one lands on the desktop:

| One UI 9 | This extension |
| --- | --- |
| Title, artist and album sit on top of the artwork | The artwork is a hero with track text over a soft scrim |
| Progress bar becomes a waveform | The seek bar is a waveform, filled in Spotify green |
| Previous, play/pause and next become circular buttons | Same, with play/pause the largest element in the popup |
| Shuffle and other secondary controls have no container | Shuffle and repeat are bare icons flanking the transport |
| The shared rounded container around the controls is gone | Controls sit directly on the surface |
| Bigger, bolder type and icons | Heavy title weight, generously sized glyphs |

Corner shape is deliberately not taken from reporting, because pre-release
coverage disagrees on it. Corners here follow One UI's long-standing soft style
and use a superellipse on the artwork.

Nothing proprietary is used. Samsung's fonts and icons are not bundled, and
every icon in `icons/` is drawn for this project.

## Principles

1. **The artwork is the interface.** Everything else is arranged around it.
2. **One loud element.** Only the play button is a solid accent. Green also
   marks progress and active toggles, and nothing else.
3. **Separation through surfaces, not lines.** Layers differ by tone. Borders
   exist only at the outer edge of the card.
4. **Concentric corners.** An inner radius equals the outer radius minus the
   padding between them.
5. **Quiet motion.** Animation confirms a change and then stops. Nothing moves
   while the popup is closed.

## Color

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `surface` | `#141517` | `#F3F4F6` | Card background |
| `surface-raised` | `#26272B` | `#FFFFFF` | Previous and next buttons |
| `surface-hover` | `#303136` | `#E9EAEE` | Hover on raised surfaces |
| `edge` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.06)` | Card border |
| `text` | `#F2F3F5` | `#17181B` | Primary text and icons |
| `text-muted` | `#A1A4AB` | `#5F636B` | Secondary text |
| `wave-idle` | `rgba(255,255,255,0.22)` | `rgba(0,0,0,0.18)` | Unplayed waveform |
| `accent` | `#1ED760` | `#1DB954` | Play button fill, active toggles, played waveform |
| `accent-toggle` | `#1ED760` | `#149C45` | Active shuffle and repeat, darker in light mode for contrast |
| `on-accent` | `#07130B` | `#07130B` | Glyph on the play button |

On the hero, text is always white over a black scrim in both themes, because it
sits on artwork and not on a theme surface. The scrim is rendered into the artwork
itself, because an overlay's circular corners cannot match the cover's superellipse.

The card also carries a tint sampled from the album art, at 14% in dark mode and
9% in light mode. It keeps the surface calm while tying it to the music.

## Shape

| Token | Value | Use |
| --- | --- | --- |
| `radius-card` | 32px | Popup card |
| `padding-card` | 8px | Card to hero |
| `radius-hero` | 24px | Hero artwork, `radius-card - padding-card` |
| `radius-thumb` | 18px | Compact artwork |
| `radius-pill` | full | Buttons and chips |

## Space

Spacing follows a 4px grid: 4, 8, 12, 16, 20, 24.

## Type

Text uses the desktop's interface font and scales with it, so sizes are in `em`.

| Role | Size | Weight |
| --- | --- | --- |
| Title | 1.5em, 1.2em in compact | 800 |
| Artist | 1em | 600 |
| Album | 0.86em | 500 |
| Time and status | 0.8em | 600, tabular figures |

## Controls

| Control | Size | Treatment |
| --- | --- | --- |
| Play/pause | 68px circle | Solid `accent` |
| Previous, next | 48px circle | `surface-raised` |
| Shuffle, repeat | 40px, no container | `text-muted`, `accent` when active |

Pressing any control scales it to 92%.

## Layouts

**Expanded** (336px wide): a 320px square hero holds the status chip and track
text, followed by the waveform, times and controls.

**Compact** (336px wide): 84px artwork beside the text, then the waveform, times
and controls. This layout is also used automatically when the screen is too
short for the hero, or when artwork is turned off.

## States

| State | Presentation |
| --- | --- |
| Playing | Green panel glyph, status chip reads Playing, waveform breathes gently |
| Paused | Muted panel glyph, status chip reads Paused, waveform still |
| Stopped | Spotify is running with no track: placeholder with an open action |
| Not running | Placeholder with an action that launches Spotify |
| No artwork | Dark surface with a music note, so hero text stays legible |

## Motion

| Moment | Animation | Duration |
| --- | --- | --- |
| Popup opens | Card scales from 96% and drops 8px, ease-out | 240ms |
| Popup closes | Fade | 150ms |
| Press | Scale to 92%, ease-out | 90ms |
| Play/pause | Icons cross-fade while scaling and turning slightly | 200ms |
| Track change | Artwork cross-fades, tint follows | 320ms |
| Playing | Waveform breathes, only while the popup is open | Continuous, capped at 30fps |

`Reduced` halves durations and stills the waveform. `Off` removes animation.
GNOME's own "Reduce Animation" setting is always respected.
