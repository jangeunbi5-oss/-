# Web Shot Cutter

Chrome Manifest V3 extension for capturing web pages as image files or PDF.

## Features

- Select an area on the current page and save it as PNG, JPEG, or PDF.
- Capture the currently visible page area and save it as PNG, JPEG, or PDF.
- Enter a cut count, scroll down by viewport height, capture each cut, stitch the cuts vertically, and save the result as one PDF.
- Uses generated PNG icons in Chrome extension sizes: 16, 32, 48, and 128 px.

## Load In Chrome

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select this folder: `WebShotCutterExtension`.
5. Test on a normal web page. Browser internal pages like `chrome://` cannot be captured.

## Icon Source

The icon was generated with Codex built-in image generation and resized according to Chrome extension icon guidance:

- 128x128: installation and Chrome Web Store use
- 48x48: extensions management page
- 16x16: extension page favicon
- 32x32: additional manifest example size used by Chrome when appropriate

Reference: https://developer.chrome.com/docs/extensions/reference/manifest/icons
