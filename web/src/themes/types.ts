// What a theme has to provide. Everything here is required on purpose: a theme
// that misses a token fails `tsc`, rather than rendering a transparent button.

export type NeutralStep = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';
export type BrandStep = '50' | '100' | '300' | '400' | '500' | '600' | '700';
export type FocusStep = '50' | '100' | '300' | '500' | '600' | '700';

/** Colours for one colour scheme (light or dark). */
export interface ThemeColors {
  pageBg: string;
  pageFg: string;
  /**
   * The ramp from lightest (50) to darkest (950) behind `chesscom-*` and
   * `ink-*`. Components pick high steps in dark mode and low steps in light
   * mode, so `pageBg` should sit near 900 in dark and near 50 in light.
   */
  neutral: Record<NeutralStep, string>;
  /** Primary actions: `green-*` and `accent-*`. */
  brand: Record<BrandStep, string>;
  /** Focus rings and the active nav item: `gold-*`. */
  focus: Record<FocusStep, string>;
  panel: string;
  /** The middle of the Home and Learn banners' gradient. */
  hero: string;
}

export type TextSize =
  | 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';

/** Everything that doesn't change between light and dark. */
export interface ThemeShape {
  fontSans: string;
  fontMono: string;
  /** Multiplies every corner radius: 1 keeps Tailwind's, 0 is square. */
  radiusScale: number;
  /** Size of unstyled body text. */
  bodySize: string;
  bodyLeading: string;
  /** Tailwind's `text-*`, as [font size, line height]. */
  text: Record<TextSize, [string, string]>;
  shadowSoft: string;
  shadowLift: string;
  shadowBoard: string;
  shadowGlow: string;
}

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** A pixel sprite per piece, one string per row and one character per pixel. */
export type PieceSprites = Record<PieceType, readonly string[]>;

/** Maps a sprite's pixel characters to colours for one side. */
export type PiecePalette = Record<string, string>;

/** Replaces the board's cburnett pieces, here and in the small piece icons. */
export type ThemePieces =
  | {
      kind: 'sprites';
      sprites: PieceSprites;
      palette: {
        light: { white: PiecePalette; black: PiecePalette };
        dark: { white: PiecePalette; black: PiecePalette };
      };
    }
  /** An image of 6 columns (see SHEET_COLUMNS in css.ts), white on top, black below. */
  | { kind: 'sheet'; url: string };

export interface Theme {
  /** Lowercase letters, digits and dashes. Stored on the profile, so don't rename it. */
  id: string;
  /** Shown as is in Settings: a theme's name is a name, not translated. */
  name: string;
  /** The small card in Settings. */
  preview: { page: string; surface: string; accent: string; boardLight: string; boardDark: string };
  colors: { light: ThemeColors; dark: ThemeColors };
  shape: ThemeShape;
  /** Sets the board's colours itself, so Settings hides the board picker. */
  ownsBoard?: boolean;
  pieces?: ThemePieces;
  /** Extra custom properties for the theme's own stylesheet, per scheme. */
  vars?: { light: Record<string, string>; dark: Record<string, string> };
}
