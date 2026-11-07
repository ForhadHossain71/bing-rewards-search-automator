# Contributing

Thanks for taking the time to help improve Bing Rewards Search Automator.

## Ways to help

- **Report a bug** using the [bug report form](https://github.com/ForhadHossain71/bing-rewards-search-automator/issues/new?template=bug_report.yml).
- **Suggest a feature** using the [feature request form](https://github.com/ForhadHossain71/bing-rewards-search-automator/issues/new?template=feature_request.yml).
- **Send a pull request** for a fix or an improvement.

For security problems, do not open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Development setup

There is no build step. The extension is plain JavaScript, HTML and CSS.

1. Fork and clone the repository.
2. Open `edge://extensions` or `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked** on the project folder.
3. After changing a file, click the reload icon on the extension card. Reopen the popup to see popup changes.
4. To debug the service worker, click **service worker** (Inspect views) on the extension card.

Quick checks before you open a pull request:

```bash
node --check background.js
node --check popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

## Guidelines

- Keep the extension dependency-free and Manifest V3 compatible.
- Functions injected into pages with `chrome.scripting.executeScript` must stay self-contained: they cannot use variables or helpers from `background.js`.
- Do not add new permissions unless they are needed. Explain any new permission in the pull request.
- Match the existing code style: 2-space indentation, single quotes, semicolons.
- Test both the light and dark theme, and with **Reduce animations** on, when you change the popup.
- Keep each pull request focused on one change and describe how you tested it.

## Commit messages

Use short, clear messages in the imperative mood, for example `Fix cooldown timer after browser restart`.

## Questions

Open a [discussion issue](https://github.com/ForhadHossain71/bing-rewards-search-automator/issues) or message [@Forhad71 on Telegram](https://t.me/Forhad71).
