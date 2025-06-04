document.addEventListener("DOMContentLoaded", async () => {
  const browserAPI = typeof chrome !== "undefined" ? chrome : browser;
  const statusDiv = document.getElementById("status");
  const errorDiv = document.getElementById("error");
  const mediaListDiv = document.getElementById("media-list");
  const clearListButton = document.getElementById("clear-list");
  const refreshContainer = document.getElementById("refresh-container");
  const refreshButton = document.getElementById("refresh-button");
  const mediaCountSpan = document.getElementById("media-count");
  const toggleExtensionActive = document.getElementById(
    "toggle-extension-active"
  );

  // Resolution map for 16:9
  const resolutionMap = [
    { width: 256, height: 144, label: "144p" },
    { width: 640, height: 360, label: "360p" },
    { width: 854, height: 480, label: "480p" },
    { width: 1280, height: 720, label: "720p" },
    { width: 1600, height: 900, label: "900p" },
    { width: 1706, height: 960, label: "960p" },
    { width: 1920, height: 1080, label: "1080p" },
    { width: 3840, height: 2160, label: "4K" },
    { width: 7680, height: 4320, label: "8K" },
  ];

  // Normalize resolution
  function normalizeResolution(width, height) {
    let w = parseInt(width);
    let h = parseInt(height);
    let isVertical = h > w;

    if (isVertical) {
      [w, h] = [h, w];
    }

    for (const res of resolutionMap) {
      const widthDiff = Math.abs(w - res.width) / res.width;
      const heightDiff = Math.abs(h - res.height) / res.height;
      if (widthDiff <= 0.1 && heightDiff <= 0.1) {
        return {
          width: res.width,
          height: res.height,
          label: res.label,
          isVertical,
        };
      }
    }

    return {
      width: isVertical ? h : w,
      height: isVertical ? w : h,
      label: `${w}x${h}`,
      isVertical,
    };
  }

  // Load language
  let langData = {};
  const currentLang = getBrowserLanguage();
  await loadLanguage(currentLang);

  function renderUI() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      element.textContent = langData[key] || element.textContent;
    });
  }
  renderUI();

  // 加載擴展啟用狀態並初始化開關
  const storageData = await browserAPI.storage.local.get("isExtensionActive");
  const isExtensionActive = storageData.isExtensionActive !== false; // 預設為啟用
  toggleExtensionActive.checked = isExtensionActive;

  // 監聽擴展啟用開關變化
  toggleExtensionActive.addEventListener("change", async () => {
    const newState = toggleExtensionActive.checked;
    await browserAPI.storage.local.set({ isExtensionActive: newState });
    console.log("Extension active state set to:", newState);

    if (newState) {
      showError(langData.extension_enabled || "Extension enabled.");
      // 立即嘗試刷新當前頁面，讓 background.js 重新檢查 URL
      browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          browserAPI.tabs.reload(tabs[0].id);
        }
      });
    } else {
      showError(langData.extension_disabled || "Extension disabled.");
    }
    // 不論啟用或禁用，都重新載入列表以反映狀態變化
    // 如果禁用，fetchAndRenderMediaList會顯示禁用訊息並清空列表
    fetchAndRenderMediaList();
  });

  // 如果擴展初始加載時為禁用狀態，則清空列表並顯示提示
  if (!isExtensionActive) {
    mediaListDiv.innerHTML = "";
    mediaCountSpan.classList.add("hidden");
    showError(
      langData.extension_disabled_message ||
        "Extension is currently disabled. Please enable it to fetch data."
    );
  }

  refreshButton.addEventListener("click", () => {
    browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        browserAPI.tabs.reload(tabs[0].id);
        showError(langData.page_reloaded || "Page reloaded");
        refreshContainer.classList.add("hidden");
      }
    });
  });

  clearListButton.addEventListener("click", async () => {
    await browserAPI.runtime.sendMessage({ action: "clearPlaybackCache" });
    mediaListDiv.innerHTML = "";
    mediaCountSpan.classList.add("hidden"); // 清空列表時隱藏計數
    showError(langData.cleared_list || "List cleared");
    console.log("Clear list button clicked");
  });

  // 獨立函數來獲取並渲染媒體列表，方便在狀態變化時重新呼叫
  async function fetchAndRenderMediaList() {
    // 在這裡不需要再次檢查 isExtensionActive，因為如果禁用，backgorund.js 不會更新 cache，
    // 且 popup.js 已經在加載時處理了禁用狀態的 UI 顯示。
    // 如果此處仍想顯示禁用訊息，可以這樣做：
    const storageData = await browserAPI.storage.local.get("isExtensionActive");
    const currentActiveState = storageData.isExtensionActive !== false;
    if (!currentActiveState) {
      mediaListDiv.innerHTML = "";
      mediaCountSpan.classList.add("hidden");
      showError(
        langData.extension_disabled_message ||
          "Extension is currently disabled. Please enable it to fetch data."
      );
      return;
    }

    browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        showError(langData.no_tab || "Unable to get current tab");
        return;
      }

      const url = tabs[0].url;
      const uuid = extractUuidFromUrl(url);
      browserAPI.runtime.sendMessage(
        { action: "getPlaybackCache" },
        (response) => {
          if (!response || !response.cache || response.cache.length === 0) {
            showError(langData.no_data || "No available playback data");
            mediaCountSpan.classList.add("hidden"); // 無數據時隱藏計數
            return;
          }

          statusDiv.classList.add("hidden");
          renderMediaList(response.cache, uuid);
        }
      );

      console.log(`Current tab URL: ${url}, UUID: ${uuid}`);
    });
  }

  // 頁面載入時觸發獲取和渲染
  fetchAndRenderMediaList();

  async function loadLanguage(lang) {
    try {
      const response = await fetch(
        browserAPI.runtime.getURL(`src/lang/${lang}.json`)
      );
      langData = await response.json();
      renderUI();
    } catch (error) {
      console.error("Failed to load language:", error);
      langData = {};
      showError(langData.lang_failed || "Failed to load language");
      renderUI();
    }
  }

  function getBrowserLanguage() {
    const lang = navigator.language.toLowerCase();
    const langMap = {
      en: "en",
      "zh-tw": "zh-tw",
      "zh-hk": "zh-tw", // 通常香港也會使用繁體中文
      "zh-cn": "zh-cn",
      zh: "zh-cn", // 簡體中文的通用 fallback
      ja: "ja",
      ko: "ko",
    };
    return langMap[lang] || langMap[lang.split("-")[0]] || "en";
  }

  function extractUuidFromUrl(url) {
    const urlPatterns = [
      /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/live\/replay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      /^https:\/\/berriz\.in\/[a-z]{2}\/[^/]+\/(?:media\/content\/)+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    ];
    for (const pattern of urlPatterns) {
      const match = url.match(pattern);
      if (match) {
        console.log("match", match);
        return match[1];
      }
    }
    return null;
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
    statusDiv.classList.add("hidden");
    if (message.toLowerCase().includes("401 unauthorized")) {
      refreshContainer.classList.remove("hidden");
    } else {
      refreshContainer.classList.add("hidden");
    }
    // 為了避免重複顯示，特別處理
    // setTimeout(() => {
    //     errorDiv.classList.add("hidden");
    //     refreshContainer.classList.add("hidden");
    // }, 5000);
  }

  function renderMediaList(cache, currentUuid) {
    mediaListDiv.innerHTML = "";
    const itemCount = cache.length;
    mediaCountSpan.textContent = `(${itemCount})`; // 更新總列表計數
    mediaCountSpan.classList.remove("hidden");

    if (itemCount === 0) {
      mediaCountSpan.classList.add("hidden");
      showError(langData.no_data || "No available playback data");
      return;
    }

    // 重新排序快取，讓當前頁面UUID的項目（如果有）在最前面
    const sortedCache = Array.from(cache).sort(([idA], [idB]) => {
      if (idA === currentUuid) return -1;
      if (idB === currentUuid) return 1;
      return 0;
    });

    sortedCache.forEach(([mediaId, data]) => {
      const mediaDiv = document.createElement("div");
      mediaDiv.className = "media-item";

      const header = document.createElement("header");
      header.className = "media-header";

      // 標題文本
      const headerText = document.createElement("span");
      headerText.textContent =
        data.title || `${langData.media_uuid || "Media UUID"}: ${mediaId}`;
      headerText.style.flexGrow = "1"; // 讓文本佔據大部分空間
      header.appendChild(headerText);

      // 新增單個列表項目刪除按鈕
      const deleteButton = document.createElement("button");
      deleteButton.className = "action-button delete-item";
      deleteButton.textContent = "✖"; // 使用叉號或更小的圖標
      deleteButton.title = langData.delete_item || "Delete this item"; // 提示文字
      deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation(); // 阻止事件冒泡到 header，防止展開/收起
        try {
          const response = await browserAPI.runtime.sendMessage({
            action: "deletePlaybackCacheItem",
            uuid: mediaId,
          });
          if (response.success) {
            // 從當前顯示的列表中移除該元素
            mediaDiv.remove();
            // 更新計數
            mediaCountSpan.textContent = `(${mediaListDiv.children.length})`;
            if (mediaListDiv.children.length === 0) {
              mediaCountSpan.classList.add("hidden");
              showError(langData.no_data || "No available playback data");
            }
            showError(langData.item_deleted || "Item deleted.");
          } else {
            showError(
              langData.delete_failed ||
                `Failed to delete item: ${response.message}`
            );
          }
        } catch (error) {
          console.error("Error deleting cache item:", error);
          showError(
            langData.delete_failed || `Failed to delete item: ${error.message}`
          );
        }
      });
      header.appendChild(deleteButton); // 將刪除按鈕添加到 header

      header.addEventListener("click", () => {
        const content = mediaDiv.querySelector(".media-content");
        content.classList.toggle("hidden");
        header.classList.toggle("collapsed");
      });
      mediaDiv.appendChild(header);

      const content = document.createElement("div");
      content.className = `media-content ${
        mediaId === currentUuid ? "" : "hidden"
      }`;
      if (data.error) {
        const errorP = document.createElement("p");
        errorP.className = "error";
        errorP.textContent = `${langData.error || "Error"}: ${
          data.error.message
        }`;
        content.appendChild(errorP);
        if (data.error.message.toLowerCase().includes("401 unauthorized")) {
          showError(data.error.message);
        }
      } else if (
        data.isDrm ||
        (data.hls.length === 0 && data.dash.length === 0)
      ) {
        const drmP = document.createElement("p");
        drmP.className = "warning";
        drmP.textContent =
          langData.drm_protected ||
          "This content is DRM protected or has no available playback URLs";
        content.appendChild(drmP);
      } else {
        const hlsSection = document.createElement("div");
        hlsSection.className = "stream-section";
        const hlsTitle = document.createElement("h3");
        hlsTitle.textContent = "HLS";
        hlsSection.appendChild(hlsTitle);

        if (data.hls.length > 0) {
          addStreamUrl(
            hlsSection,
            langData.master_hls || "Master HLS",
            data.hls[0]
          );
          if (data.hlsVariants && data.hlsVariants.length > 0) {
            const variantsDiv = document.createElement("div");
            variantsDiv.className = "variants hidden";
            const normalizedVariants = data.hlsVariants.map((variant) => {
              const res = normalizeResolution(variant.width, variant.height);
              return { ...variant, normalized: res };
            });

            normalizedVariants.forEach((variant) => {
              addStreamUrl(
                variantsDiv,
                variant.normalized.label,
                variant.playbackUrl
              );
            });
            hlsSection.appendChild(variantsDiv);

            const resolutions = normalizedVariants
              .map((v) => ({
                height: v.normalized.height,
                label: v.normalized.label,
              }))
              .sort((a, b) => b.height - a.height);

            const toggleButton = document.createElement("button");
            toggleButton.className = "toggle-variants";
            toggleButton.textContent = `${resolutions[0].label} - ${
              resolutions[resolutions.length - 1].label
            }`;
            toggleButton.addEventListener("click", () => {
              variantsDiv.classList.toggle("hidden");
            });
            hlsSection.appendChild(toggleButton);
          }
        } else {
          hlsSection.innerHTML += `<p>${
            langData.no_hls || "No available HLS URLs"
          }</p>`;
        }
        content.appendChild(hlsSection);

        const dashSection = document.createElement("div");
        dashSection.className = "stream-section";
        const dashTitle = document.createElement("h3");
        dashTitle.textContent = "DASH";
        dashSection.appendChild(dashTitle);
        if (data.dash && data.dash.length > 0) {
          data.dash.forEach((url, index) => {
            addStreamUrl(dashSection, `DASH ${index + 1}`, url);
          });
        } else {
          dashSection.innerHTML += `<p>${
            langData.no_data || "No data available"
          }</p>`;
        }
        content.appendChild(dashSection);
      }
      mediaDiv.appendChild(content);
      mediaListDiv.appendChild(mediaDiv);
    });
  }

  function addStreamUrl(container, label, url) {
    const urlDiv = document.createElement("div");
    urlDiv.className = "stream-url";

    const labelSpan = document.createElement("span");
    labelSpan.textContent = `${label}: `;
    urlDiv.appendChild(labelSpan);

    const urlLink = document.createElement("a");
    urlLink.href = url;
    urlLink.textContent = url;
    urlLink.target = "_blank";
    urlDiv.appendChild(urlLink);

    const copyButton = document.createElement("button");
    copyButton.className = "action-button copy";
    copyButton.textContent = langData.copy || "Copy";
    copyButton.addEventListener("click", () => {
      navigator.clipboard.writeText(url).then(() => {
        copyButton.textContent = langData.copied || "Copied";
        setTimeout(
          () => (copyButton.textContent = langData.copy || "Copy"),
          1000
        );
      });
    });
    urlDiv.appendChild(copyButton);

    const onlineButton = document.createElement("button");
    onlineButton.className = "action-button online";
    onlineButton.textContent = langData.online_play || "Online Play";
    onlineButton.addEventListener("click", () => {
      browserAPI.tabs.create({
        url: browserAPI.runtime.getURL(
          `src/player.html?url=${encodeURIComponent(url)}`
        ),
      });
    });
    urlDiv.appendChild(onlineButton);

    const potButton = document.createElement("button");
    potButton.className = "action-button potplayer";
    potButton.textContent = "PotPlayer";
    potButton.addEventListener("click", () => {
      const potUrl = `potplayer://${url}`;
      window.open(potUrl, "_blank");
    });
    urlDiv.appendChild(potButton);

    container.appendChild(urlDiv);
  }
});
