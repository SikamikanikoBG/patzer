// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { applyTheme } from '../themes';
import { MoveGlyph } from './classification';

afterEach(() => { cleanup(); applyTheme('classic'); });

const draw = () => render(<svg><MoveGlyph kind="check" /></svg>).container;

describe('MoveGlyph', () => {
  it('uses the default drawing when a theme has none', () => {
    applyTheme('classic');
    expect(draw().querySelector('path')).toBeTruthy();
    expect(draw().querySelector('rect')).toBeNull();
  });

  it("uses the theme's own drawing when it has one", () => {
    applyTheme('pixel');
    expect(draw().querySelector('rect')).toBeTruthy();
  });

  it('a theme built from Pixel keeps its marks', () => {
    applyTheme('pixel-heroes');
    expect(draw().querySelector('rect')).toBeTruthy();
  });
});
