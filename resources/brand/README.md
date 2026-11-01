# zfront logo kit

Source of truth: the Logos asset group in the zfront Night Shift design system. These are the same files, plus `zfront-favicon.ico` (16/32/48 px) and `png/` app icons (180/192/512 px) rendered from `zfront-favicon.svg` and `zfront-app-icon.svg`. The client loads them from here (favicon, wordmark, loading screen, PWA manifest); `resources/public/favicon.ico` and `apple-touch-icon.png` are root-URL copies of the ico and the 180px icon.

The zfront logo: **Hazard Z**. The Z's diagonal is a strip of hazard tape: solid top and bottom bars, a diagonal band cut by 45° gaps. In the wordmark the N's diagonal carries the same tape, so the two letters with diagonals are the two taped letters. One colour only: `signal-400` on `ink-900`, or `ink-900` on `signal-400`.

## Files

| File                           | Use                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `zfront-lockup-horizontal.svg` | Symbol + wordmark side by side. Headers, store and social banners, anywhere wide.                                |
| `zfront-lockup-stacked.svg`    | Symbol over wordmark. Loading and "game starting" screens, splash, square social art.                            |
| `zfront-wordmark.svg`          | The word on its own. Main menu (with HazardStripe under it), page footers, press.                                |
| `zfront-symbol.svg`            | The Z on its own, 48px and up: app icon art, the loading screen, store icons.                                    |
| `zfront-symbol-24.svg`         | Small cut, 24–47px: in-game HUD corner, menu header on phone, notifications. Bigger slats, one fewer gap.        |
| `zfront-symbol-16.svg`         | Smallest cut, 16–23px. Two gaps only.                                                                            |
| `zfront-favicon.svg`           | Browser tab: the 16px cut in `signal-400` on an `ink-900` square.                                                |
| `zfront-app-icon.svg`          | Home-screen and PWA icon, 512 × 512: the symbol at 60% on `ink-900`, safe inside round and rounded-square masks. |
| `zfront-app-icon-yellow.svg`   | Same on `signal-400`, for places where a dark icon disappears.                                                   |

Every file comes in `signal-400` (no suffix, for dark grounds) and `ink-900` (`-black`, for `signal-400` grounds). The favicon and app icons carry their own ground.

## Clear space

**X = a quarter of the cap height** of the wordmark (for the symbol on its own: a quarter of its height). Keep X clear on every side of any version: no text, controls, borders, stripes or map detail inside it. On the main menu the HazardStripe sits X below the wordmark, the one element allowed that close.

## Sizes

- **Wordmark:** cap height at least 28px (about 95px wide), so the gaps in the Z and N stay a pixel or wider. On the main menu it takes the `wordmark` style's size: the logo's cap height is 0.8 × the font size, so 224px tall on desktop and 102px on phone.
- **Symbol:** `zfront-symbol.svg` from 48px, `-24` from 24 to 47px, `-16` from 16 to 23px. Don't use the large file small or a small cut large.
- **Lockups:** horizontal at least 28px tall; stacked at least 96px tall.

## Grounds

- `signal-400` logo on `ink-900`, on `tile-fill`, or on the map backdrop only where the backdrop is darkened as MapBackdrop does it.
- `ink-900` logo on `signal-400` (the action strip, yellow panels).
- Nothing else: not `cream-100`, not `amber-500`, never red, never two colours at once, never on the Daylight game map without a `tile-fill` tile under it.

## Don't

- Don't type ZFRONT in Big Shoulders Stencil as a stand-in. The placeholder wordmark is retired; use the files.
- Don't add slats to other letters, change the slat count, colour the slats, or fill the gaps.
- Don't stretch, rotate, outline, add shadows or glows, or put the logo inside the hazard stripe.
- Don't add red. Red stays for zombies and danger.
- Don't put "© OpenFront and Contributors" in the logo. It stays in the Footer on every menu screen and on the loading screen, beside the logo, never part of it.

## Construction

- **Symbol:** a 192-unit square. Bars 40 units tall; the band runs at 45° from the top bar's right end to the bottom bar's left end; the top bar has the system's top-right cut (26 units). Gaps are 10 units wide, slats 13, at 45° across the band. Gaps are only cut where they fit whole, so the band joins each bar as a solid wedge with no notches. The small cuts thicken the bars and slats so the gaps stay at least 1.5px.
- **Wordmark:** outlines of Big Shoulders Stencil Display 900 (SIL Open Font License), tracking −0.01em. The Z keeps the font's steeper diagonal with its slats leaning `\`; the N is redrawn with a straight diagonal and slats leaning `/`, the same direction as HazardStripe. Both use slats 80 and gaps 60 units on a 1600-unit cap height.
- **Lockups:** horizontal: symbol at cap height, half a cap height from the word. Stacked: symbol at 1.5 × cap height, 0.4 × cap height above the word, centred.
