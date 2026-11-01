# Themes

A theme changes how the whole app looks. It sits beside the other two appearance settings: light, dark or auto still picks the colour scheme, and each theme defines both. The board picker still applies, unless the theme has its own board.

## Adding a theme

1. Copy `classic/` to `themes/<id>/` and change the `id`, `name` and values. `tsc` reports any token you leave out.
2. Add it to `THEMES` in `index.ts`:

   ```ts
   import ocean from './ocean';
   export const THEMES: readonly Theme[] = [classic, ...PIXEL_THEMES, heroes, ...JELLY_THEMES, ocean];
   ```

3. Run `npm test`. `themes.test.ts` checks every theme in the list, including that its text can be read.

That's all. The theme appears in Settings, and the server stores any valid `id` without changes. A profile whose theme no longer exists falls back to Classic.

Many themes only need colours. Add these only if yours needs them:

| Add | When | Example |
| --- | --- | --- |
| A stylesheet next to `index.ts`, imported from it | The shapes change, not only the values. Nest every rule in `:root[data-theme="<id>"]` so it can't affect other themes | `pixel/pixel.css` |
| `vars` | That stylesheet needs its own colours or images per theme or scheme | `--px-*` in `pixel/index.ts` |
| `credits` | The theme uses someone else's art or font. It's shown in Settings, because the notices file isn't in the running app. Add the license terms to `THIRD_PARTY_NOTICES.md` too | `pixel/index.ts` |
| `ownsBoard: true` | The theme draws the board itself, so Settings hides the board picker | Pixel, Heroes, Jelly |
| `pieces` | The theme has its own pieces: `sprites` as text, or an image `sheet` | `pixel/sprites.ts`, `jelly/assets/pieces-1.webp` |
| A font file or package, imported from the stylesheet or `index.ts` | The theme has its own font. Browsers only download it while the theme is active | `m6x11` in `pixel.css`, Nunito in `jelly/index.ts` |

If a font is only crisp at certain sizes, set the `text` sizes to match, and list the sizes components hard-code, as `pixel.css` does for `text-[11px]`.

Images used in a stylesheet or `vars` are downloaded only while their theme is active, as long as they stay outside the main bundle. `vite.config.ts` makes sure of that for everything in this folder.

## Adding a Pixel colour scheme

Add a `pixelTheme()` call to `PIXEL_THEMES` in `pixel/index.ts`, with an id starting `pixel-` and a palette for dark and light. The pieces, font and shapes are shared, and the board and piece colours come from the palette. `heroes/index.ts` shows how to start from a Pixel theme and swap the pieces and board.

## Adding a Jelly colour combination

Add a row to `RECIPES` in `jelly/index.ts`. Any piece sheet goes with any board, and the row sets the UI colours and buttons to match.

The images in `jelly/assets/` come from `scripts/extract-jelly-assets.py`, which lists which piece colour plays white on each sheet.

## How it works

- `tailwind.config.js` points the app's colours, type sizes, radii, shadows and fonts at CSS variables, so components use the same classes in every theme.
- `applyTheme()` writes the active theme's variables into one `<style>` and sets `data-theme` on `<html>`.
- The chosen theme is saved in `profiles.ui_theme`, and in `localStorage` so the login page and reloads start on it.
- Move classifications (`move-*`), Tailwind's own colours such as `amber-*`, and the hex colours in charts aren't themed, because their colours carry meaning.
