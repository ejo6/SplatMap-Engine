(() => {
  const BUTTON_ID = "step-into-the-video-button";
  const observer = new MutationObserver(scheduleUpdate);
  let observedRoot;
  let updateScheduled = false;

  function watchId() {
    if (location.pathname !== "/watch") return null;
    const id = new URLSearchParams(location.search).get("v");
    return /^[A-Za-z0-9_-]{11}$/.test(id ?? "") ? id : null;
  }

  function likeControl(actions) {
    const segmented = actions.querySelector(
      "ytd-segmented-like-dislike-button-renderer, segmented-like-dislike-button-view-model",
    );
    if (segmented) return segmented.closest("ytd-menu-renderer > *") ?? segmented;

    return [...actions.querySelectorAll("button[aria-label], [role=button][aria-label]")]
      .find((button) => /^like(?:$|[\s.,:])/i.test(button.getAttribute("aria-label")));
  }

  function openViewer() {
    const id = watchId();
    if (!id) return;

    const video = document.querySelector("#movie_player video.html5-main-video, #movie_player video");
    video?.pause();
    const time = video?.currentTime;
    const url = new URL("/w/" + id, STEP_INSIDE_VIEWER_ORIGIN);
    url.searchParams.set("t", Number.isFinite(time) && time > 0 ? time.toFixed(3) : "0");
    window.open(url.href, "_blank", "noopener,noreferrer");
  }

  function update() {
    updateScheduled = false;
    const id = watchId();
    const watch = id && document.querySelector("ytd-watch-flexy:not([hidden])");
    const root = watch || document.querySelector("ytd-page-manager") || document.body;
    if (root !== observedRoot) {
      observer.disconnect();
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["video-id", "hidden"],
      });
      observedRoot = root;
    }

    const currentButton = document.getElementById(BUTTON_ID);
    const metadataMatches = watch && (!watch.getAttribute("video-id") || watch.getAttribute("video-id") === id);
    const actions = metadataMatches && watch.querySelector("#actions");
    const like = actions && likeControl(actions);
    if (!like) {
      currentButton?.remove();
      return;
    }
    if (like.nextElementSibling === currentButton && currentButton) return;

    const button = currentButton ?? document.createElement("button");
    if (!currentButton) {
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "Step inside";
      button.addEventListener("click", openViewer);
    }
    like.after(button);
  }

  function scheduleUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(update);
  }

  document.addEventListener("yt-navigate-finish", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  update();
})();
