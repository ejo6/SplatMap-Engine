(() => {
  const BUTTON_ID = "step-into-the-video-button";
  const observer = new MutationObserver(scheduleUpdate);
  const sizes = new ResizeObserver(scheduleUpdate);
  let observedLike;
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
    if (segmented) return segmented;

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
      sizes.disconnect();
      observedLike = null;
      currentButton?.remove();
      return;
    }
    // The menu can also contain Share and Save. Anchor to the pill's own row item.
    const item = like.closest("#top-level-buttons-computed > *") ?? like;
    const pill = like.querySelector("button, [role=button]") ?? like;

    const button = currentButton ?? document.createElement("button");
    if (!currentButton) {
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "Step inside";
      button.addEventListener("click", openViewer);
    }
    if (item.nextElementSibling !== button) item.after(button);
    if (observedLike !== pill || !currentButton) {
      sizes.disconnect();
      sizes.observe(pill);
      sizes.observe(item.parentElement);
      observedLike = pill;
    }

    // Look exactly like YouTube's own text pill in this row (Share, Save...): copy its classes, minus the icon
    // modifiers (our pill has no icon), and the spacing YouTube gives its row item. Fall back to the Like pill.
    const ytButton = [...item.parentElement.querySelectorAll("button")]
      .find((b) => b !== button && !item.contains(b) && b.textContent.trim());
    if (ytButton) {
      const classes = [...ytButton.classList].filter((c) => !/--icon/.test(c)).join(" ");
      if (button.className !== classes) button.className = classes;
      const ytItem = ytButton.closest("#top-level-buttons-computed > *") ?? ytButton;
      button.style.marginLeft = getComputedStyle(ytItem).marginLeft;
      button.style.height = "";
    }

    // YouTube wrappers can have a baseline or padding offset. Centre on the visible control.
    const target = (ytButton ?? pill).getBoundingClientRect();
    if (!target.height) return;
    if (!ytButton) {
      button.style.height = target.height + "px";
      button.style.marginLeft = "8px";
    }
    const rect = button.getBoundingClientRect();
    const shift = target.top + target.height / 2 - rect.top - rect.height / 2;
    if (Math.abs(shift) > 0.1) {
      const offset = parseFloat(button.style.top) || 0;
      button.style.top = (offset + shift) + "px";
    }
  }

  function scheduleUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(update);
  }

  document.addEventListener("yt-navigate-finish", scheduleUpdate);
  window.addEventListener("popstate", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  update();
})();
