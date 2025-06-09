// Use browser or chrome namespace for cross-browser compatibility
const browserAPI = typeof chrome !== "undefined" ? chrome : browser;

console.log("Background.js loaded");

// Test fetching cookies for https://berriz.in (debugging)
browserAPI.cookies
  .getAll({ url: "https://berriz.in" })
  .then((cookies) => {
    console.log("All cookies for berriz.in:", cookies);
  })
  .catch((error) => {
    console.error("Failed to get cookies:", error);
  });

// Global playback cache (using Map) - maximum 50 entries
let playbackCache = new Map();

// Extension active state (default enabled)
let isExtensionActive = true;

// Load extension state from storage and update extension icon
async function loadExtensionStateAndSetIcon() {
  try {
    const storageData = await browserAPI.storage.local.get("isExtensionActive");
    if (storageData.isExtensionActive !== undefined) {
      isExtensionActive = storageData.isExtensionActive;
    }
    console.log("Initial extension active state:", isExtensionActive);
    updateExtensionIcon();
  } catch (error) {
    console.error("Error loading extension state:", error);
    isExtensionActive = true;
    updateExtensionIcon();
  }
}

// Update extension icon based on the active state
function updateExtensionIcon() {
  if (isExtensionActive) {
    // Active: use colored icons
    browserAPI.action.setIcon({
      path: {
        32: "assets/icons/berry32.png",
        128: "assets/icons/berry256.png",
      },
    });
    // Clear badge text
    browserAPI.action.setBadgeText({ text: "" });
  } else {
    // Inactive: use disabled (grayscale) icons
    browserAPI.action.setIcon({
      path: {
        32: "assets/icons/berry32_disabled.png",
        128: "assets/icons/berry256_disabled.png",
      },
    });
    browserAPI.action.setBadgeText({ text: "" });
  }
}

// Listen for messages from content script (extension status)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_EXTENSION_STATUS") {
    sendResponse({ isActive: isExtensionActive });
    return true;
  }
});

// Call on startup to load the extension state
loadExtensionStateAndSetIcon();

// Listen for tab updates - only if the extension is active
browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isExtensionActive) return;

  if (changeInfo.url) {
    console.log(`Tab updated: ${changeInfo.url}`);
    checkBerrizUrl(changeInfo.url, tabId);
  }
});

// Listen for storage changes to update the active state and icon dynamically
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_EXTENSION_STATUS") {
    sendResponse({ isActive: isExtensionActive });
    return true;
  }
});

// Check if URL matches Berriz pattern and fetch media info if necessary
function checkBerrizUrl(url, tabId) {
  if (!isExtensionActive) {
    // Ensure badge is cleared if extension is inactive
    browserAPI.action.setBadgeText({ text: "", tabId });
    return;
  }

  // Define regex patterns for live replay and media content
  const replayPattern =
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/live\/replay\/([0-9a-f-]{36})\/?$/i;
  const mediaPattern =
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/media\/content\/([0-9a-f-]{36})\/?$/i;

  let uuid = null;
  let apiEndpoint = null;
  let titleEndpoint = null;

  if (replayPattern.test(url)) {
    uuid = url.match(replayPattern)[1];
    apiEndpoint = `https://svc-api.berriz.in/service/v1/medias/live/replay/${uuid}/playback_area_context`;
    // live replay's title is usually already included in this endpoint
  } else if (mediaPattern.test(url)) {
    uuid = url.match(mediaPattern)[1];
    apiEndpoint = `https://svc-api.berriz.in/service/v1/medias/${uuid}/playback_info`;
    titleEndpoint = `https://svc-api.berriz.in/service/v1/medias/${uuid}/public_context`;
  }

  if (uuid && apiEndpoint) {
    browserAPI.action.setBadgeText({ text: "!", tabId });
    browserAPI.action.setBadgeBackgroundColor({ color: "#FF5252", tabId });
    // If the cache doesn't have the UUID or the cached data is older than 30 seconds, fetch media info
    if (!playbackCache.has(uuid)) {
      console.log(`Fetching media info for UUID: ${uuid}`);
      fetchMediaInfo(uuid, apiEndpoint, titleEndpoint);
    } else {
      const cachedEntry = playbackCache.get(uuid);
      if (Date.now() - cachedEntry.timestamp > 30000) {
        console.log(`Refreshing media info for UUID: ${uuid}`);
        fetchMediaInfo(uuid, apiEndpoint, titleEndpoint);
      }
    }
  } else {
    browserAPI.action.setBadgeText({ text: "", tabId });
  }
  return uuid;
}

// Handle messages from popup (get cache, clear cache, delete an item, etc.)
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPlaybackCache") {
    sendResponse({ cache: Array.from(playbackCache.entries()) });
  } else if (request.action === "clearPlaybackCache") {
    playbackCache.clear();
    console.log("Playback cache cleared");
    sendResponse({ success: true });
  } else if (request.action === "deletePlaybackCacheItem") {
    const uuidToDelete = request.uuid;
    if (playbackCache.has(uuidToDelete)) {
      playbackCache.delete(uuidToDelete);
      console.log(`Playback cache item deleted: ${uuidToDelete}`);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, message: "Item not found in cache." });
    }
  }
  return true; // Keep the message channel open for asynchronous responses
});

// Fetch media information and update the cache
async function fetchMediaInfo(uuid, apiEndpoint, titleEndpoint) {
  if (!isExtensionActive) {
    console.log("Extension disabled, skipping fetchMediaInfo.");
    return;
  }
  try {
    // Retrieve necessary cookies using browserAPI.cookies
    const cookieNames = ["bz_a", "bz_r", "paccode", "pcid"];
    const cookies = await Promise.all(
      cookieNames.map(
        (name) =>
          new Promise((resolve) => {
            browserAPI.cookies.get(
              { url: "https://berriz.in", name },
              (cookie) => {
                if (browserAPI.runtime.lastError) {
                  console.error(
                    `Error getting cookie ${name}:`,
                    browserAPI.runtime.lastError
                  );
                  resolve(null);
                } else {
                  resolve(cookie);
                }
              }
            );
          })
      )
    );
    const cookieHeader = cookies
      .filter((cookie) => cookie)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    if (!cookieHeader) {
      throw new Error(
        "Required cookies not found. Please ensure you are logged into berriz.in."
      );
    }
    // Request playback information
    const response = await fetch(apiEndpoint, {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (response.status === 401)
      throw new Error("401 Unauthorized: Please refresh the page");
    if (!response.ok)
      throw new Error(`API request failed with status ${response.status}`);
    const data = await response.json();
    if (data.code === "FS_MD9010") {
      const err = new Error(data.code);
      err.code = data.code;
      err.type = "FANCLUB_ONLY";
      throw err;
    }
    if (data.code !== "0000" || !data.data)
      throw new Error("INVALID_API_RESPONSE");
    // Process the response (handles live replay and media)
    let media = null;
    let title = null;
    if (apiEndpoint.includes("live/replay")) {
      media = data.data.media?.live?.replay || data.data.media;
      title = data.data.media?.title || null;
    } else {
      media = data.data.vod || data.data.media;
    }
    if (!media) {
      console.error(`No valid media data found for UUID ${uuid}`);
      return; // Discard the response if no valid media (e.g. YouTube), do not update cache or notify popup
    }
    // If titleEndpoint is provided, try getting additional title information
    if (titleEndpoint) {
      try {
        const titleResponse = await fetch(titleEndpoint, {
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (titleResponse.status === 401) {
          throw new Error("401 Unauthorized: Please refresh the page");
        }
        if (titleResponse.ok) {
          const titleData = await titleResponse.json();
          if (titleData.code === "0000" && titleData.data?.media?.title) {
            title = titleData.data.media.title;
          }
        }
      } catch (titleError) {
        console.warn(
          `Failed to fetch title for UUID ${uuid}:`,
          titleError.message
        );
      }
    }
    // Attempt to decode the title (e.g. "\uD83C\uDF40" to 🍀)
    if (title) {
      try {
        title = decodeURIComponent(
          title.replace(/\\u[\dA-F]{4}/gi, (match) =>
            String.fromCharCode(parseInt(match.replace(/\\u/g, ""), 16))
          )
        );
      } catch (e) {
        console.warn(`Failed to decode title for UUID ${uuid}:`, e.message);
        title = null;
      }
    }
    // Assemble playback data (use uuid as fallback for title)
    const playbackData = {
      isDrm: !!media.isDrm,
      hls: [],
      dash: [],
      hlsVariants: media.hls?.adaptationSet || [],
      timestamp: Date.now(),
      title: title || uuid,
    };
    if (!media.isDrm && media.hls?.playbackUrl) {
      playbackData.hls = [media.hls.playbackUrl].filter((url) => url);
    }
    if (!media.isDrm && media.dash?.playbackUrl) {
      playbackData.dash = [media.dash.playbackUrl].filter((url) => url);
    }
    // Update the cache
    playbackCache.set(uuid, playbackData);
    if (playbackCache.size > 50) {
      while (playbackCache.size > 50) {
        const oldestEntry = Array.from(playbackCache.entries()).reduce(
          (oldest, current) =>
            current[1].timestamp < oldest[1].timestamp ? current : oldest
        );
        playbackCache.delete(oldestEntry[0]);
        console.log(`Removed oldest cache entry: ${oldestEntry[0]}`);
      }
    }
    console.log(`Playback data updated (${uuid}):`, playbackData);
  } catch (error) {
    const errorEntry = {
      isDrm: null,
      hls: [],
      dash: [],
      error: {
        message: error.message,
        code: error.code || null,
        type: error.type || null,
        stack: error.stack || null,
      },
      timestamp: Date.now(),
      title: uuid,
    };
    playbackCache.set(uuid, errorEntry);
    console.error(`Failed to fetch media info (${uuid}):`, error.message);
  }
}
