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
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/live\/replay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  media:
    /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/(?:media\/content\/)+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
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

async function checkBerrizUrl(url, tabId) {
  if (!isExtensionActive) {
    await browser.browserAction.setBadgeText({ text: "", tabId });
    return null;
  }

  try {
    // 提前檢查 cookies
    await getCookies();

    let mediaInfo = null;
    for (const [type, pattern] of Object.entries(URL_PATTERNS)) {
      const match = url.match(pattern);
      if (match) {
        const uuid = match[1];
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
        break;
      }
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

// 獲取媒體資訊
async function fetchMediaInfo({ uuid, apiEndpoint, titleEndpoint }) {
  if (!isExtensionActive) {
    console.log("Extension disabled, skipping fetchMediaInfo.");
    return;
  }

  try {
    // 獲取 cookie header
    const cookieHeader = await getCookies();

    // 發送 API 請求
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
      throw new Error(`API 請求失敗: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== "0000" || !data.data) {
      throw new Error("無效的 API 響應");
    }

    let title = uuid;
    if (titleEndpoint) {
      const titleResponse = await fetch(titleEndpoint, {
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/json",
        },
      });
      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        title = titleData.data?.title || uuid;
      }
    }

    const media =
      data.data.media?.live?.replay || data.data.vod || data.data.media;
    const playbackData = {
      isDrm: !!media.isDrm,
      hls: [],
      dash: [],
      hlsVariants: media.hls?.adaptationSet || [],
      timestamp: Date.now(),
      title,
    };

    if (!media.isDrm) {
      if (media.hls?.playbackUrl) playbackData.hls = [media.hls.playbackUrl];
      if (media.dash?.playbackUrl) playbackData.dash = [media.dash.playbackUrl];
    }

    updateCache(uuid, playbackData);
    console.log(`播放資料已更新 (${uuid}):`, playbackData);
  } catch (error) {
    handleFetchError(uuid, error);
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
  const errorEntry = {
    isDrm: null,
    hls: [],
    dash: [],
    error: {
      message: error.message || String(error),
      code: error.code || null,
      isMissingCookies: error.code === "MISSING_COOKIES",
      fanclubOnly: error.code === "FS_MD9010",
      stack: error.stack || null,
      missingCookies: error.missingCookies || null,
    },
    timestamp: Date.now(),
    title: uuid,
  };

  playbackCache.set(uuid, errorEntry);
  console.error(`獲取媒體資訊失敗 (${uuid}):`, error.message || error);
}

// 修改 checkBerrizUrl 函數
async function checkBerrizUrl(url, tabId) {
  if (!isExtensionActive) {
    await browser.browserAction.setBadgeText({ text: "", tabId });
    return null;
  }

  try {
    // 提前檢查 cookies
    await getCookies();

    let mediaInfo = null;
    for (const [type, pattern] of Object.entries(URL_PATTERNS)) {
      const match = url.match(pattern);
      if (match) {
        const uuid = match[1];
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
        break;
      }
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

// 初始化擴展
loadExtensionStateAndSetIcon();
