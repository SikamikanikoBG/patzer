#!/usr/bin/env python3
"""Cuts Heroes3_Pieces.png into the sheet web/src/themes/heroes/assets uses.

Usage: extract-heroes-assets.py <path to Heroes3_Pieces.png>. Needs Pillow.

The source is Heroes Chess by Null Tale (https://nulltale.itch.io/heroes-chess),
CC BY 4.0. It has a palette strip and ground shapes on top, then a row of demons
and a row of knights, each pawn, knight, bishop, rook, queen, king. This drops
the top and arranges the pieces in the order a theme's sheet expects, each in an
equal cell, centred and standing on the bottom: rook, knight, bishop, queen,
king, pawn, with the knights (white) above the demons (black).
"""
import sys
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'web/src/themes/heroes/assets/pieces.png'
CELL = 46
FOOT = 1

# Left and right edge of each piece, and the rows of each side.
WHITE = (77, 121, [(8, 24), (32, 60), (69, 92), (98, 124), (128, 158), (162, 185)])
BLACK = (17, 58, [(7, 24), (34, 58), (73, 84), (99, 124), (128, 150), (160, 183)])
SOURCE_ORDER = 'pnbrqk'
SHEET_ORDER = 'rnbqkp'


def main(source):
    sheet = Image.open(source).convert('RGBA')
    out = Image.new('RGBA', (CELL * 6, CELL * 2))
    for row, (top, bottom, columns) in enumerate((WHITE, BLACK)):
        for column, piece in enumerate(SHEET_ORDER):
            left, right = columns[SOURCE_ORDER.index(piece)]
            sprite = sheet.crop((left, top, right + 1, bottom))
            sprite = sprite.crop(sprite.getbbox())
            x = column * CELL + (CELL - sprite.width) // 2
            y = row * CELL + CELL - FOOT - sprite.height
            out.paste(sprite, (x, y))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, optimize=True)


if __name__ == '__main__':
    main(Path(sys.argv[1]))
