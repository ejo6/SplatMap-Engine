# Chrome extension

Start the web app with `npm run dev` from `web/`. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repo's `extension/` directory.

The extension starts with `http://localhost:5173` as the viewer origin. Set the deployed HTTPS origin in `extension/config.js` when hosting is ready. Reload the unpacked extension and refresh YouTube after changing it.

In both YouTube themes, hover over **Step inside** and confirm the pill keeps its resting color. Tab to it to check the keyboard focus outline.

Play a YouTube watch page and click **Step inside** beside Like. Check that the new tab opens `/w/<videoId>?t=<seconds>` on the configured viewer origin. Navigate through ten videos using YouTube recommendations or browser history and confirm each watch page shows one button. The destination route can be checked independently of whether a packaged world exists.

The same local origin serves the landing page at `/`. Paste a watch, Shorts, or youtu.be link to open its viewer route. The placeholder gallery reads `web/public/gallery.json` using the PRD §9 fields (`youtubeId`, `title`, `thumb`, `credit`). Add entries once a world and its approved credit are ready.

To check the playback handoff, start a packaged YouTube video, let it reach 12 seconds, and click **Step inside**. The YouTube tab should pause. The viewer should start at the same moment, accounting for the package’s source-window offset. A time before that window starts at its beginning. A time at or beyond its end holds the last frame until you press play. Opening from the gallery starts normally at zero.
