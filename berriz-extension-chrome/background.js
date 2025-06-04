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

let playbackCache = new Map();

// 新增: 擴展啟用狀態變數及初始化
let isExtensionActive = true; // 預設為啟用

// 載入擴展狀態並設定 icon
async function loadExtensionStateAndSetIcon() {
  const storageData = await browserAPI.storage.local.get("isExtensionActive");
  if (storageData.isExtensionActive !== undefined) {
    isExtensionActive = storageData.isExtensionActive;
  }
  console.log("Initial extension active state:", isExtensionActive);
  // 根據初始狀態設定 icon
  updateExtensionIcon();
}

// 更新擴展 icon 狀態的獨立函數
function updateExtensionIcon() {
  if (isExtensionActive) {
    // 如果啟用，使用彩色 icon
    browserAPI.action.setIcon({
      path: {
        32: "assets/icons/berry32.png",
        128: "assets/icons/berry256.png",
      },
    });
    // 清空徽章，避免禁用後恢復啟用時殘留舊徽章
    browserAPI.action.setBadgeText({ text: "" });
  } else {
    // 如果禁用，使用反黑 icon
    browserAPI.action.setIcon({
      path: {
        32: "assets/icons/berry32_disabled.png", // 假設你會有一個灰色的 32x32 icon
        128: "assets/icons/berry256_disabled.png", // 假設你會有一個灰色的 128x128 icon
      },
    });
    browserAPI.action.setBadgeText({ text: "" }); // 禁用時確保徽章為空
  }
}

// 首次載入時執行
loadExtensionStateAndSetIcon();

// 監聽 storage 變化，即時更新狀態和 icon
browserAPI.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.isExtensionActive !== undefined) {
    isExtensionActive = changes.isExtensionActive.newValue;
    console.log("Extension active state changed to:", isExtensionActive);
    updateExtensionIcon(); // 狀態改變時更新 icon
  }
});

// Listen for tab updates - 只在擴展啟用時才監聽 URL 變化
browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isExtensionActive) {
    // 如果擴展被禁用，則不做任何事情
    // browserAPI.action.setBadgeText({ text: "" }); // 此行由 updateExtensionIcon 處理
    return;
  }

  if (changeInfo.url) {
    console.log(`Tab updated: ${changeInfo.url}`);
    checkBerrizUrl(changeInfo.url, tabId);
  }
});

// Check if URL matches Berriz pattern
function checkBerrizUrl(url, tabId) {
  if (!isExtensionActive) {
    // 再次檢查，確保安全性
    browserAPI.action.setBadgeText({ text: "" }); // 確保徽章為空
    return;
  }

  const replayPattern =
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/live\/replay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const mediaPattern =
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/(?:media\/content\/)+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

  let uuid = null;
  let apiEndpoint = null;
  let titleEndpoint = null;

  if (replayPattern.test(url)) {
    uuid = url.match(replayPattern)[1];
    apiEndpoint = `https://svc-api.berriz.in/service/v1/medias/live/replay/${uuid}/playback_area_context`;
  } else if (mediaPattern.test(url)) {
    uuid = url.match(mediaPattern)[1];
    apiEndpoint = `https://svc-api.berriz.in/service/v1/medias/${uuid}/playback_info`;
    titleEndpoint = `https://svc-api.berriz.in/service/v1/medias/${uuid}/public_context`;
  }

  if (uuid && apiEndpoint) {
    // Use chrome.action instead of chrome.browserAction
    browserAPI.action.setBadgeText({ text: "!", tabId: tabId });
    browserAPI.action.setBadgeBackgroundColor({
      color: "#FF5252",
      tabId: tabId,
    });
    if (!playbackCache.has(uuid)) {
      console.log(`Fetching media info for UUID: ${uuid}`);
      fetchMediaInfo(uuid, apiEndpoint, titleEndpoint);
    }
  } else {
    browserAPI.action.setBadgeText({ text: "", tabId: tabId });
  }
}

// Handle messages from popup
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // getPlaybackCache 和 clearPlaybackCache 即使在禁用時也可以執行，
  // 因為它們只是管理快取數據，不涉及新的網路請求或監聽。
  // 但如果你希望禁用時徹底不讓這些操作發生，可以在這裡加上 isExtensionActive 判斷。

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
    return true; // Indicate that sendResponse will be called asynchronously
  }
});

// Fetch media info - 只在擴展啟用時才執行
async function fetchMediaInfo(uuid, apiEndpoint, titleEndpoint) {
  if (!isExtensionActive) {
    // 再次檢查，防止意外執行
    console.log("Extension disabled, skipping fetchMediaInfo.");
    return;
  }

  try {
    // Get required cookies
    const cookieNames = ["bz_a", "bz_r", "paccode", "pcid"];
    const cookies = await Promise.all(
      cookieNames.map((name) =>
        browserAPI.cookies.get({ url: "https://berriz.in", name })
      )
    );

    const cookieHeader = cookies
      .filter((cookie) => cookie)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    if (!cookieHeader) {
      throw new Error(
        "Required cookies (bz_a, bz_r, paccode, pcid) not found. Please ensure you are logged into berriz.in."
      );
    }

    // Fetch playback info
    const response = await fetch(apiEndpoint, {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (response.status === 401) {
      throw new Error("401 Unauthorized: Please refresh the page");
    }

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (data.code === "FS_MD9010") {
      const err = new Error(data.code);
      err.code = data.code;
      throw new Error(`This is FanClub only content.`);
    }

    if (data.code !== "0000" || !data.data) {
      throw new Error("INVALID_API_RESPONSE");
    }

    // Process response (supports live replay and media)
    let media = null;
    let title = null;
    if (apiEndpoint.includes("live/replay")) {
      media = data.data.media?.live?.replay || data.data.media;
      title = data.data.media?.title || null;
    } else {
      media = data.data.vod || data.data.media;
    }

    // Handle invalid media data
    if (!media) {
      console.error(`No valid media data found for UUID ${uuid}`);
      return;
    }

    // Fetch title if titleEndpoint exists
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

    // Decode title
    if (title) {
      try {
        title = decodeURIComponent(
          title.replace(/\\u[\dA-F]{4}/gi, (match) => {
            return String.fromCharCode(parseInt(match.replace(/\\u/g, ""), 16));
          })
        );
      } catch (e) {
        console.warn(`Failed to decode title for UUID ${uuid}:`, e.message);
        title = null;
      }
    }

    // Assemble playback data
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

    // Update cache
    playbackCache.set(uuid, playbackData);
    if (playbackCache.size > 50) {
      const oldestEntry = Array.from(playbackCache.entries()).reduce(
        (oldest, current) =>
          current[1].timestamp < oldest[1].timestamp ? current : oldest
      );
      playbackCache.delete(oldestEntry[0]);
      console.log(`Removed oldest cache entry: ${oldestEntry[0]}`);
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
