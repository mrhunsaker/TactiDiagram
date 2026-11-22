# Packaging assets

- `icon.svg` - the application icon (source of truth). CI and the packaging
  scripts rasterize it to PNG (256x256) and Windows `.ico` formats.
- `icon.png` / `icon.ico` are generated artifacts; do not edit them by hand.

Generate them locally with ImageMagick on Linux/macOS:

```bash
convert -background none -density 300 icon.svg -resize 256x256 icon.png
```

On Windows (or in CI), the scripts handle it: `npm i --no-save sharp png-to-ico`
then `node scripts/win-icon.cjs`.
