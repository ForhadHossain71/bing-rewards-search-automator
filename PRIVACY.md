# Privacy Policy

_Last updated: 7 November 2026_

Bing Rewards Search Automator runs entirely in your browser. It has no server, no account system and no analytics.

## What the extension reads

- **Your Microsoft Rewards progress.** Your points balance, today's Bing search counter and today's activity progress are read from `rewards.bing.com`, using the session you are already signed in with.
- **Search topics.** Public trending topics from Google Trends and suggestions from Bing autocomplete are used to build search queries. These requests are sent without cookies.

## What the extension stores

All data is kept locally with `chrome.storage.local` (plus the theme choice in the popup's local storage):

- your settings (search count, pace, reminder schedule, theme),
- the state of the current run (points before and after, search progress),
- today's progress shown in the popup and reminder card,
- the list of queries already used today, so they are not repeated,
- how many reminders were shown today.

Nothing is synced to other devices, and removing the extension deletes this data.

## What the extension sends

- Bing searches go to `bing.com`, and Rewards pages are loaded from `rewards.bing.com`, exactly as when you use them yourself.
- Requests for trending topics go to `trends.google.com` and `bing.com` autocomplete.

The extension does **not** send your data to the developer or to any third party.

## Optional permission

If you turn on daily reminders, the extension asks for access to all sites. It is used only to show the reminder card on the page you are viewing. The extension does not read or collect content from those pages.

## Contact

Questions about privacy: Telegram [@Forhad71](https://t.me/Forhad71).
