document.addEventListener("DOMContentLoaded", async () => {
  // DOM elements
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

  // Helper functions
  function showError(message) {
    // Check if message is an object containing error data
    if (
      typeof message === "object" &&
      message.error?.fanclubOnly &&
      message.error.messages
    ) {
      errorDiv.innerHTML = ""; // Clear existing content

      const titleEl = document.createElement("h3");
      titleEl.textContent = langData[message.error.messages.title];
      errorDiv.appendChild(titleEl);

      const messageEl = document.createElement("p");
      messageEl.textContent = langData[message.error.messages.message];
      errorDiv.appendChild(messageEl);

      errorDiv.classList.remove("hidden");
      statusDiv.classList.add("hidden");
      refreshContainer.classList.add("hidden");
    } else {
      // Original error handling
      errorDiv.textContent = message;
      errorDiv.classList.remove("hidden");
      statusDiv.classList.add("hidden");

      if (message.toLowerCase().includes("401 unauthorized")) {
        refreshContainer.classList.remove("hidden");
      } else {
        refreshContainer.classList.add("hidden");
      }

      setTimeout(() => {
        errorDiv.classList.add("hidden");
        refreshContainer.classList.add("hidden");
      }, 5000);
    }
  }
  function extractUuidFromUrl(url) {
    const match = url.match(/uuid=([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  }

  async function loadLanguage(lang) {
    try {
      const response = await fetch(
        browser.runtime.getURL(`src/lang/${lang}.json`)
      );
      if (!response.ok) {
        throw new Error("Language file not found");
      }
      langData = await response.json();
      renderUI();
    } catch (error) {
      console.error(`載入語言失敗 (${lang}):`, error);
      if (lang !== "en") {
        console.log("嘗試載入英文語言包...");
        await loadLanguage("en");
      } else {
        langData = {};
        showError(langData.lang_failed || "載入語言失敗");
        renderUI();
      }
    }
  }

  function renderUI() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      element.textContent = langData[key] || key;
    });
  }

  function getBrowserLanguage() {
    if (typeof browser !== "undefined" && browser.i18n?.getUILanguage) {
      return browser.i18n.getUILanguage().toLowerCase();
    }
    return navigator.language.toLowerCase();
  }

  // 在 DOMContentLoaded 事件監聽器中添加
  // ...existing DOM elements...

  // 載入擴展啟用狀態並初始化開關
  try {
    const storageData = await browser.storage.local.get("isExtensionActive");
    const isExtensionActive = storageData.isExtensionActive !== false;
    toggleExtensionActive.checked = isExtensionActive;

    // 監聽擴展啟用開關變化
    toggleExtensionActive.addEventListener("change", async () => {
      const newState = toggleExtensionActive.checked;
      await browser.storage.local.set({ isExtensionActive: newState });
      console.log("擴展狀態已設置為:", newState);

      if (newState) {
        showError(langData.extension_enabled || "擴展已啟用");
        // 立即刷新當前頁面
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs[0]) {
          await browser.tabs.reload(tabs[0].id);
        }
      } else {
        mediaListDiv.innerHTML = "";
        mediaCountSpan.classList.add("hidden");
        showError(langData.extension_disabled || "擴展已停用");
      }
      // 重新載入列表
      await fetchAndRenderMediaList();
    });
  } catch (error) {
    console.error("載入擴展狀態失敗:", error);
    showError(langData.status_load_failed || "載入狀態失敗");
  }

  // Stream URL handling
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
    copyButton.textContent = langData.copy || "複製";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyButton.textContent = langData.copied || "已複製";
        setTimeout(() => {
          copyButton.textContent = langData.copy || "複製";
        }, 1000);
      } catch (error) {
        console.error("複製失敗:", error);
        showError(langData.copy_failed || "複製失敗");
      }
    });
    urlDiv.appendChild(copyButton);

    const onlineButton = document.createElement("button");
    onlineButton.className = "action-button online";
    onlineButton.textContent = langData.online_play || "線上播放";
    onlineButton.addEventListener("click", async () => {
      try {
        if (!url) {
          throw new Error("無效的播放連結");
        }
        await browser.tabs.create({
          url: browser.runtime.getURL(
            `src/player.html?url=${encodeURIComponent(url)}`
          ),
        });
      } catch (error) {
        console.error("開啟播放器失敗:", error);
        showError(langData.player_failed || "開啟播放器失敗");
      }
    });
    urlDiv.appendChild(onlineButton); // Changed from appendChild to urlDiv.appendChild

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

  // Media list rendering
  function renderMediaList(cache, currentUuid) {
    mediaListDiv.innerHTML = "";
    mediaCountSpan.textContent = `(${cache.length})`;
    mediaCountSpan.classList.remove("hidden");

    cache.forEach(([mediaId, data]) => {
      const mediaDiv = document.createElement("div");
      mediaDiv.className = "media-item";
      if (currentUuid && mediaId === currentUuid) {
        mediaDiv.classList.add("current");
      }
      if (data.error) {
        // Handle fanclub error specifically
        if (data.error.fanclubOnly) {
          const titleEl = document.createElement("h3");
          titleEl.textContent = langData[data.error.fanclubOnly.title];

          const messageEl = document.createElement("p");
          messageEl.textContent = langData[data.error.fanclubOnly.message];

          const errorContent = document.createElement("div");
          errorContent.className = "error-content";
          errorContent.appendChild(titleEl);
          errorContent.appendChild(messageEl);

          mediaDiv.appendChild(errorContent);
        } else {
          // Handle other errors
          mediaDiv.textContent = data.error.message || "Unknown error";
        }
      }

      const header = document.createElement("header");
      header.className = "media-header";
      header.textContent =
        data.title || `${langData.media_uuid || "媒體 UUID"}: ${mediaId}`;
      header.addEventListener("click", () => {
        const content = mediaDiv.querySelector(".media-content");
        content.classList.toggle("hidden");
        header.classList.toggle("collapsed");
      });

      // Add delete button
      const deleteButton = document.createElement("button");
      deleteButton.className = "action-button delete-item";
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const response = await browser.runtime.sendMessage({
            action: "deletePlaybackCacheItem",
            uuid: mediaId,
          });
          if (response.success) {
            mediaDiv.remove();
            const remainingItems =
              mediaListDiv.querySelectorAll(".media-item").length;
            if (remainingItems === 0) {
              mediaCountSpan.classList.add("hidden");
              showError(langData.no_data || "沒有可用的播放數據");
            } else {
              mediaCountSpan.textContent = `(${remainingItems})`;
            }
          }
        } catch (error) {
          console.error("刪除項目失敗:", error);
          showError(langData.delete_failed || "刪除失敗");
        }
      });
      header.appendChild(deleteButton);
      mediaDiv.appendChild(header);

      const content = document.createElement("div");
      content.className = `media-content ${
        mediaId === currentUuid ? "" : "hidden"
      }`;

      if (data.error) {
        const errorP = document.createElement("p");
        errorP.className = "error";
        errorP.textContent = `${langData.error || "錯誤"}: ${
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
          langData.drm_protected || "此內容受 DRM 保護或沒有可用的播放連結";
        content.appendChild(drmP);
      } else {
        // HLS Section
        const hlsSection = document.createElement("div");
        hlsSection.className = "stream-section";
        const hlsTitle = document.createElement("h3");
        hlsTitle.textContent = "HLS";
        hlsSection.appendChild(hlsTitle);

        if (data.hls.length > 0) {
          addStreamUrl(
            hlsSection,
            langData.master_hls || "主要 HLS",
            data.hls[0]
          );

          if (data.hlsVariants && data.hlsVariants.length > 0) {
            const variantsDiv = document.createElement("div");
            variantsDiv.className = "variants hidden";

            // Sort variants by resolution
            const normalizedVariants = data.hlsVariants
              .map((variant) => ({
                original: variant,
                normalized: normalizeResolution(variant.width, variant.height),
              }))
              .sort((a, b) => b.normalized.height - a.normalized.height);

            normalizedVariants.forEach(({ original, normalized }) => {
              addStreamUrl(variantsDiv, normalized.label, original.playbackUrl);
            });

            const toggleButton = document.createElement("button");
            toggleButton.className = "toggle-variants";
            toggleButton.textContent = `${
              normalizedVariants[0].normalized.label
            } - ${
              normalizedVariants[normalizedVariants.length - 1].normalized.label
            }`;
            toggleButton.addEventListener("click", () => {
              variantsDiv.classList.toggle("hidden");
            });

            hlsSection.appendChild(toggleButton);
            hlsSection.appendChild(variantsDiv);
          }
        } else {
          const noHlsP = document.createElement("p");
          noHlsP.textContent = langData.no_hls || "沒有可用的 HLS 連結";
          hlsSection.appendChild(noHlsP);
        }
        content.appendChild(hlsSection);

        // DASH Section
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
          const noDashP = document.createElement("p");
          noDashP.textContent = langData.no_dash || "沒有可用的 DASH 連結";
          dashSection.appendChild(noDashP);
        }
        content.appendChild(dashSection);
      }

      mediaDiv.appendChild(content);
      mediaListDiv.appendChild(mediaDiv);
    });
  }

  // Event handlers
  // 清除列表按鈕事件
  clearListButton.addEventListener("click", async () => {
    try {
      await browser.runtime.sendMessage({ action: "clearPlaybackCache" });
      mediaListDiv.innerHTML = "";
      mediaCountSpan.classList.add("hidden");
      showError(langData.cleared_list || "列表已清除");
    } catch (error) {
      console.error("清除列表失敗:", error);
      showError(langData.clear_failed || "清除失敗");
    }
  });

  // 刷新按鈕事件
  refreshButton.addEventListener("click", async () => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]) {
        await browser.tabs.reload(tabs[0].id);
        showError(langData.page_reloaded || "頁面已重新載入");
        refreshContainer.classList.add("hidden");
      }
    } catch (error) {
      console.error("重新載入頁面失敗:", error);
      showError(langData.reload_failed || "重新載入失敗");
    }
  });

  // Data fetching
  async function fetchAndRenderMediaList() {
    try {
      const [storageData, tabs] = await Promise.all([
        browser.storage.local.get("isExtensionActive"),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);

      const currentActiveState = storageData.isExtensionActive !== false;

      if (!currentActiveState) {
        mediaListDiv.innerHTML = "";
        mediaCountSpan.classList.add("hidden");
        showError(
          langData.extension_disabled_message ||
            "擴展目前已停用。請啟用以獲取資料。"
        );
        return;
      }

      if (!tabs.length) {
        showError(langData.no_tab || "無法獲取當前標籤頁");
        return;
      }

      const url = tabs[0].url;
      const uuid = extractUuidFromUrl(url);
      const response = await browser.runtime.sendMessage({
        action: "getPlaybackCache",
      });

      if (!response || !response.cache || response.cache.length === 0) {
        showError(langData.no_data || "沒有可用的播放數據");
        mediaCountSpan.classList.add("hidden");
        return;
      }

      statusDiv.classList.add("hidden");
      renderMediaList(response.cache, uuid);
      console.log(`當前標籤頁 URL: ${url}, UUID: ${uuid}`);
    } catch (error) {
      console.error("獲取媒體列表失敗:", error);
      showError(langData.fetch_failed || "獲取數據失敗");
    }
  }

  // Initialization
  let langData = {};
  const currentLang = getBrowserLanguage();
  await loadLanguage(currentLang);
  await fetchAndRenderMediaList();
});
