// 跨浏览器兼容的 API 选择
const browserAPI = typeof browser !== "undefined" ? browser : chrome;
const actionAPI = browserAPI.action || browserAPI.browserAction;

console.log("Background.js loaded");

// 初始化扩展状态
let isExtensionActive = true;
let playbackCache = new Map();

// 加载扩展状态并设置图标
async function loadExtensionStateAndSetIcon() {
  try {
    const storageData = await new Promise((resolve) => {
      browserAPI.storage.local.get("isExtensionActive", resolve);
    });

    isExtensionActive =
      storageData.isExtensionActive !== undefined
        ? storageData.isExtensionActive
        : true;

    console.log("Initial extension active state:", isExtensionActive);
    updateExtensionIcon();
  } catch (error) {
    console.error("Error loading extension state:", error);
    isExtensionActive = true;
    updateExtensionIcon();
  }
}

// 更新扩展图标状态
function updateExtensionIcon() {
  const iconPaths = {
    active: {
      32: "assets/icons/berry32.png",
      128: "assets/icons/berry256.png",
    },
    inactive: {
      32: "assets/icons/berry32_disabled.png",
      128: "assets/icons/berry256_disabled.png",
    },
  };

  const iconSet = isExtensionActive ? iconPaths.active : iconPaths.inactive;

  actionAPI.setIcon({ path: iconSet });
  actionAPI.setBadgeText({ text: "" });
}

// 测试获取 cookies (调试用)
function testCookies() {
  if (browserAPI.cookies.getAll) {
    // Firefox 风格
    browserAPI.cookies
      .getAll({ url: "https://berriz.in" })
      .then((cookies) => console.log("All cookies for berriz.in:", cookies))
      .catch((error) => console.error("Failed to get cookies:", error));
  } else {
    // Chrome 风格
    browserAPI.cookies.getAll({ url: "https://berriz.in" }, (cookies) => {
      if (browserAPI.runtime.lastError) {
        console.error("Failed to get cookies:", browserAPI.runtime.lastError);
      } else {
        console.log("All cookies for berriz.in:", cookies);
      }
    });
  }
}

// 初始化
loadExtensionStateAndSetIcon();
testCookies();

// 监听存储变化
browserAPI.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.isExtensionActive !== undefined) {
    isExtensionActive = changes.isExtensionActive.newValue;
    console.log("Extension active state changed to:", isExtensionActive);
    updateExtensionIcon();
  }
});

// 监听标签页更新
browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isExtensionActive) return;

  if (changeInfo.url) {
    console.log(`Tab updated: ${changeInfo.url}`);
    checkBerrizUrl(changeInfo.url, tabId);
  }
});

// 检查 Berriz URL
function checkBerrizUrl(url, tabId) {
  if (!isExtensionActive) {
    actionAPI.setBadgeText({ text: "", tabId });
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
    actionAPI.setBadgeText({ text: "!", tabId });
    actionAPI.setBadgeBackgroundColor({ color: "#FF5252", tabId });

    if (!playbackCache.has(uuid)) {
      console.log(`Fetching media info for UUID: ${uuid}`);
      fetchMediaInfo(uuid, apiEndpoint, titleEndpoint);
    }
  } else {
    actionAPI.setBadgeText({ text: "", tabId });
  }
}

// 处理消息
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
  return true; // 保持消息端口开放以支持异步响应
});

// 获取媒体信息
async function fetchMediaInfo(uuid, apiEndpoint, titleEndpoint) {
  if (!isExtensionActive) {
    console.log("Extension disabled, skipping fetchMediaInfo.");
    return;
  }

  try {
    // 获取 cookies
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

    // 获取播放信息
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

    // 处理响应
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
      return;
    }

    // 获取标题（如果需要）
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

    // 解码标题
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

    // 组装播放数据
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

    // 更新缓存
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
