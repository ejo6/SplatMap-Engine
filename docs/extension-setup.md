# Chrome extension

Start the web app with `npm run dev` from `web/`. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repo's `extension/` directory.

The extension starts with `http://localhost:5173` as the viewer origin. Set the deployed HTTPS origin in `extension/config.js` when hosting is ready. Reload the unpacked extension and refresh YouTube after changing it.

Play a YouTube watch page and click **Step inside** beside Like. Check that the new tab opens `/w/<videoId>?t=<seconds>` on the configured viewer origin. Navigate through ten videos using YouTube recommendations or browser history and confirm each watch page shows one button. The destination route can be checked independently of whether a packaged world exists.
