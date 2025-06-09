// Firefox 擴展背景腳本 (Manifest V2)

const CONFIG = {
  CACHE_SIZE: 7,
  CACHE_TIMEOUT: 30000, // 30 seconds
  API_BASE: "https://svc-api.berriz.in/service/v1/medias",
  REQUIRED_COOKIES: ["bz_a", "bz_r", "pacode", "pcid"], // Changed from paccode to pacode
};

// URL 匹配模式
const URL_PATTERNS = {
  replay:
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/live\/replay\/([0-9a-f-]{36})\/?$/i,
  media:
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/media\/content\/([0-9a-f-]{36})\/?$/i,
};

// 全局狀態
let isExtensionActive = true;
let playbackCache = new Map();

console.log("背景腳本已載入");

// 載入擴展狀態並更新圖標
async function loadExtensionStateAndSetIcon() {
  try {
    const storageData = await browser.storage.local.get("isExtensionActive");
    isExtensionActive = storageData.isExtensionActive ?? true;
    console.log("初始擴展狀態:", isExtensionActive);
    await updateExtensionIcon();
  } catch (error) {
    console.error("載入擴展狀態時出錯:", error);
    isExtensionActive = true;
    await updateExtensionIcon();
  }
}

// 更新擴展圖標
async function updateExtensionIcon() {
  const iconState = isExtensionActive ? "" : "_disabled";
  await browser.browserAction.setIcon({
    path: {
      32: `assets/icons/berry32${iconState}.png`,
      128: `assets/icons/berry256${iconState}.png`,
    },
  });
  await browser.browserAction.setBadgeText({ text: "" });
}

async function getCookies() {
  try {
    console.debug("Checking cookies for domain .berriz.in");

    // Try to get all cookies first to debug
    const allCookies = await browser.cookies.getAll({
      domain: "berriz.in",
    });
    console.debug(
      "Found cookies:",
      allCookies.map((c) => c.name)
    );

    // Get required cookies
    const cookies = await Promise.all(
      CONFIG.REQUIRED_COOKIES.map((name) =>
        browser.cookies.get({
          url: "https://berriz.in",
          name,
          firstPartyDomain: "",
        })
      )
    );

    // Filter and validate cookies
    const validCookies = cookies.filter(Boolean);
    if (validCookies.length !== CONFIG.REQUIRED_COOKIES.length) {
      const missingCookies = CONFIG.REQUIRED_COOKIES.filter(
        (name, index) => !cookies[index]
      );
      console.debug("Missing cookies:", missingCookies);
      console.debug(
        "Available cookies:",
        validCookies.map((c) => c.name)
      );

      const error = new Error(
        "Required cookies not found. Please ensure you are logged into berriz.in."
      );
      error.code = "MISSING_COOKIES";
      error.missingCookies = missingCookies;
      throw error;
    }

    const cookieHeader = validCookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    return cookieHeader;
  } catch (error) {
    console.error("Failed to get cookies:", error);
    throw error;
  }
}

// 獲取媒體資訊
async function fetchMediaInfo({ uuid, apiEndpoint, titleEndpoint }) {
  if (!isExtensionActive) {
    console.log("Extension disabled, skipping fetchMediaInfo.");
    return;
  }

  try {
    const cookieHeader = await getCookies();
    const response = await fetch(apiEndpoint, {
      headers: {
        Cookie: cookieHeader,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    // 檢查 401 未授權錯誤
    if (response.status === 401) {
      throw new Error("401 Unauthorized: Please refresh the page");
    }
    // 檢查其他 HTTP 錯誤
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const data = await response.json();
    console.debug(`API 響應 (${uuid}):`, data);
    // 檢查粉絲俱樂部限制
    if (data.code === "FS_MD9010") {
      const err = new Error("FANCLUB_ONLY");
      err.code = data.code;
      err.type = "FANCLUB_ONLY";
      err.messages = {
        title: "fanclub_only", // 對應語言文件中的 key
        message: "fanclub_message", // 對應語言文件中的 key
      };
      throw err;
    }
    // 檢查一般 API 響應代碼
    if (data.code !== "0000" || !data.data) {
      throw new Error(`API response: ${data.code}`);
    }
    const media =
      data.data.media?.live?.replay || data.data.vod || data.data.media;
    if (!media) {
      return; // 直接返回，不更新快取
    }
    let resolvedTitle = uuid;
    if (titleEndpoint) {
      const titleResponse = await fetch(titleEndpoint, {
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
      });
      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        resolvedTitle = titleData.data?.title || uuid;
      }
    }

    let mediaTitle = data.data.media?.title || null;
    const playbackData = {
      isDrm: !!media.isDrm,
      hls: [],
      dash: [],
      hlsVariants: media.hls?.adaptationSet || [],
      timestamp: Date.now(),
      title: mediaTitle || resolvedTitle || "載入中...", // 使用更友好的預設值
    };

    if (!media.isDrm) {
      if (media.hls?.playbackUrl) playbackData.hls = [media.hls.playbackUrl];
      if (media.dash?.playbackUrl) playbackData.dash = [media.dash.playbackUrl];
    }

    updateCache(uuid, playbackData);
    console.log(`播放資料已更新 (${uuid}):`, playbackData);
  } catch (error) {
    handleFetchError(uuid, error);
    if (!error.message.includes("media is undefined")) {
      handleFetchError(uuid, error);
    } else {
      console.debug(`跳過(${uuid})可能是Youtube page`);
    }
  }
}

// 更新緩存
function updateCache(uuid, data) {
  playbackCache.set(uuid, data);

  if (playbackCache.size > CONFIG.CACHE_SIZE) {
    const oldestEntry = Array.from(playbackCache.entries()).reduce(
      (oldest, current) =>
        current[1].timestamp < oldest[1].timestamp ? current : oldest
    );
    playbackCache.delete(oldestEntry[0]);
    console.log(`已移除最舊的緩存項目: ${oldestEntry[0]}`);
  }
}

// 錯誤處理
function handleFetchError(uuid, error) {
  if (!langData || !langData.fanclub_only) {
    console.error("Language data not loaded yet.");
    return;
  }

  const errorEntry = {
    isDrm: null,
    hls: [],
    dash: [],
    error: {
      message: error.message || String(error),
      code: error.code || null,
      type: error.type || null,
      isMissingCookies: error.code === "MISSING_COOKIES",
      fanclubOnly:
        error.type === "FANCLUB_ONLY"
          ? {
              title: langData.fanclub_only.title,
              message: langData.fanclub_only.message,
            }
          : null,
      stack: error.stack || null,
      missingCookies: error.missingCookies || null,
    },
    timestamp: Date.now(),
    title: uuid,
  };

  playbackCache.set(uuid, errorEntry);

  // Log appropriate message based on error type
  if (error.type === "FANCLUB_ONLY") {
    console.error(`獲取媒體資訊失敗 (${uuid}): ${langData.fanclub_only.title}`);
  } else {
    console.error(`獲取媒體資訊失敗 (${uuid}):`, error.message || error);
  }

  // Create and update mediaDiv element
  const mediaDiv = document.createElement("div");
  mediaDiv.className = "media-item";
  mediaDiv.id = uuid; // Ensure mediaDiv's id matches the uuid
  if (uuid && mediaDiv.id === uuid) {
    mediaDiv.classList.add("current");
  }

  if (error.fanclubOnly) {
    const titleEl = document.createElement("h3");
    titleEl.textContent = error.fanclubOnly.title;

    const messageEl = document.createElement("p");
    messageEl.textContent = error.fanclubOnly.message;

    const errorContent = document.createElement("div");
    errorContent.className = "error-content";
    errorContent.appendChild(titleEl);
    errorContent.appendChild(messageEl);

    mediaDiv.appendChild(errorContent);
  } else {
    // Handle other errors
    mediaDiv.textContent = error.message || "未知錯誤";
  }

  // Append mediaDiv to the document
  document.body.appendChild(mediaDiv);
}

async function checkBerrizUrl(url, tabId) {
  console.log("[checkBerrizUrl] Called with URL:", url, "Tab ID:", tabId);

  if (!isExtensionActive) {
    console.log("[checkBerrizUrl] Extension is not active. Skipping.");
    await browser.browserAction.setBadgeText({ text: "", tabId });
    return null;
  }

  try {
    console.log("[checkBerrizUrl] Getting cookies...");
    await getCookies();
    console.log("[checkBerrizUrl] Cookies loaded.");

    let mediaInfo = null;
    for (const [type, pattern] of Object.entries(URL_PATTERNS)) {
      const match = url.match(pattern);
      console.log(
        `[checkBerrizUrl] Testing pattern for type '${type}':`,
        pattern
      );
      if (match) {
        const uuid = match[1];
        console.log(
          `[checkBerrizUrl] Match found! Type: ${type}, UUID: ${uuid}`
        );

        mediaInfo = {
          uuid,
          type,
          apiEndpoint: `${CONFIG.API_BASE}/${
            type === "replay" ? "live/replay/" : ""
          }${uuid}/${
            type === "replay" ? "playback_area_context" : "playback_info"
          }`,
          titleEndpoint:
            type === "media"
              ? `${CONFIG.API_BASE}/${uuid}/public_context`
              : null,
        };

        console.log("[checkBerrizUrl] Constructed mediaInfo:", mediaInfo);
        break;
      }
    }

    if (!mediaInfo) {
      console.log("[checkBerrizUrl] No matching URL pattern found.");
    }

    if (mediaInfo) {
      await browser.browserAction.setBadgeText({ text: "!", tabId });
      await browser.browserAction.setBadgeBackgroundColor({
        color: "#FF5252",
        tabId,
      });

      const cached = playbackCache.get(mediaInfo.uuid);
      if (!cached || Date.now() - cached.timestamp > CONFIG.CACHE_TIMEOUT) {
        console.log(`獲取媒體資訊，UUID: ${mediaInfo.uuid}`);
        await fetchMediaInfo(mediaInfo);

        // 如果需要獲取標題
        if (mediaInfo.titleEndpoint && (!cached || !cached.title)) {
          try {
            const cookieHeader = await getCookies();
            const titleResponse = await fetch(mediaInfo.titleEndpoint, {
              headers: {
                Cookie: cookieHeader,
                "Content-Type": "application/json",
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            });

            if (titleResponse.ok) {
              const titleData = await titleResponse.json();
              if (titleData.code === "0000" && titleData.data?.media?.title) {
                const title = titleData.data.media.title;
                // 嘗試解碼標題中的 Unicode
                try {
                  const decodedTitle = decodeURIComponent(
                    title.replace(/\\u[\dA-F]{4}/gi, (match) =>
                      String.fromCharCode(
                        parseInt(match.replace(/\\u/g, ""), 16)
                      )
                    )
                  );

                  // 更新快取中的標題
                  const currentCache = playbackCache.get(mediaInfo.uuid);
                  if (currentCache) {
                    currentCache.title = decodedTitle;
                    playbackCache.set(mediaInfo.uuid, currentCache);
                    console.log(
                      `標題已更新 (${mediaInfo.uuid}):`,
                      decodedTitle
                    );
                  }
                } catch (e) {
                  console.warn(`解碼標題失敗 (${mediaInfo.uuid}):`, e.message);
                }
              }
            }
          } catch (titleError) {
            console.warn(
              `獲取標題失敗 (${mediaInfo.uuid}):`,
              titleError.message
            );
          }
        }
      }
      return mediaInfo.uuid;
    }

    await browser.browserAction.setBadgeText({ text: "", tabId });
    return null;
  } catch (error) {
    if (error.code === "MISSING_COOKIES") {
      await browser.browserAction.setBadgeText({ text: "⚠", tabId });
      await browser.browserAction.setBadgeBackgroundColor({
        color: "#FFA500",
        tabId,
      });
    }
    throw error;
  }
}

// 事件監聽器
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    console.log(`標籤頁更新: ${changeInfo.url}`);
    checkBerrizUrl(changeInfo.url, tabId);
  }
});

browser.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.isExtensionActive !== undefined) {
    isExtensionActive = changes.isExtensionActive.newValue;
    console.log("擴展狀態已變更為:", isExtensionActive);
    updateExtensionIcon();
  }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "getPlaybackCache":
      sendResponse({ cache: Array.from(playbackCache.entries()) });
      break;
    case "clearPlaybackCache":
      playbackCache.clear();
      console.log("播放緩存已清除");
      sendResponse({ success: true });
      break;
    case "deletePlaybackCacheItem":
      const success = playbackCache.delete(request.uuid);
      console.log(`緩存項目 ${request.uuid} 刪除: ${success}`);
      sendResponse({
        success,
        message: success ? "項目已刪除" : "未找到項目",
      });
      break;
  }
  return true;
});

console.log("Background script loaded");

browser.cookies
  .getAll({ url: "https://berriz.in" })
  .then((cookies) => {
    console.log("All cookies for berriz.in:", cookies);
  })
  .catch((error) => {
    console.error("Failed to get cookies:", error);
  });

// 傳遞擴展狀態
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_EXTENSION_STATUS") {
    sendResponse({ isActive: isExtensionActive });
    return true;
  }
});

// 初始化擴展
loadExtensionStateAndSetIcon();
