#!/usr/bin/env python3
"""Cuts JellyChess_Assets.zip into the files web/src/themes/jelly/assets uses.

The zip is from https://mightea.itch.io/jelly-chess-assets and is not in this
repository, because its terms prohibit redistributing the raw files.

Usage: extract-jelly-assets.py <folder with the unzipped PNGs>. Needs Pillow.

Each chess sheet is a 12x6 grid of 170.67px cells. Row 2 holds three pairs of
board squares (dark, then light), then the highlights. Rows 4 and 5 hold the two
piece colours, as rook, knight, bishop, queen, king, pawn.
"""
import sys
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'web/src/themes/jelly/assets'
CELL = 2048 / 12
SQUARE = 170

# Sheet number -> the row that plays white (the lighter colour), the row that
# plays black, and the name of each of its boards.
SETS = {
    1: (4, 5, ['lagoon', 'peach', 'bubblegum']),
    2: (5, 4, ['mint', 'sky', 'lilac']),
    3: (5, 4, ['grape', 'forest', 'midnight']),
}

# Wide buttons on ui_buttons_01.png: left, top, right, bottom.
BUTTONS = {
    'cyan': (5, 262, 250, 382), 'magenta': (262, 262, 506, 382), 'orange': (518, 262, 763, 382), 'ice': (775, 262, 1019, 382),
    'green': (5, 390, 250, 511), 'yellow': (262, 390, 506, 511), 'teal': (775, 390, 1019, 511),
    'slate': (775, 5, 1019, 125), 'purple': (775, 133, 1019, 253),
}


def cell(sheet, col, row, inset=0):
    box = (round(col * CELL) + inset, round(row * CELL) + inset, round((col + 1) * CELL) - inset, round((row + 1) * CELL) - inset)
    return sheet.crop(box).resize((SQUARE, SQUARE), Image.LANCZOS)


def square(sheet, col):
    # Squares have a soft transparent edge, which would show as seams on the board.
    return cell(sheet, col, 2, inset=3)


def save(image, name, quality=88):
    image.save(OUT / f'{name}.webp', quality=quality, alpha_quality=95, method=6)


def main(source):
    OUT.mkdir(parents=True, exist_ok=True)
    for number, (white_row, black_row, boards) in SETS.items():
        sheet = Image.open(source / f'chess_set_{number:02}.png').convert('RGBA')
        pieces = Image.new('RGBA', (SQUARE * 6, SQUARE * 2))
        for col in range(6):
            pieces.paste(cell(sheet, col, white_row), (col * SQUARE, 0))
            pieces.paste(cell(sheet, col, black_row), (col * SQUARE, SQUARE))
        save(pieces, f'pieces-{number}')
        for index, board in enumerate(boards):
            dark, light = square(sheet, index * 2), square(sheet, index * 2 + 1)
            tile = Image.new('RGBA', (SQUARE * 2, SQUARE * 2))
            tile.paste(light, (0, 0))
            tile.paste(dark, (SQUARE, 0))
            tile.paste(dark, (0, SQUARE))
            tile.paste(light, (SQUARE, SQUARE))
            save(tile, f'board-{board}')
        if number == 1:
            save(square(sheet, 6), 'square-last')
            save(square(sheet, 7), 'square-selected')
            save(square(sheet, 8), 'square-target')

    buttons = Image.open(source / 'ui_buttons_01.png').convert('RGBA')
    for name, box in BUTTONS.items():
        save(buttons.crop(box), f'button-{name}', quality=92)


if __name__ == '__main__':
    main(Path(sys.argv[1]))
