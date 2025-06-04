document.addEventListener("DOMContentLoaded", async () => {
  const video = document.getElementById("player");
  const errorDiv = document.getElementById("error");
  const titleElement = document.querySelector("title");
  const screenshotBtn = document.getElementById("screenshot-btn");
  const downloadBtn = document.getElementById("download-btn");
  const volumeSlider = document.getElementById("volume-slider");
  const statsInfo = document.getElementById("stats-info");

  let langData = {};
  const currentLang = getBrowserLanguage();
  await loadLanguage(currentLang);

  function renderUI(message = "") {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      element.textContent =
        key === "error" && message
          ? message
          : langData[key] || element.textContent;
    });
  }
  renderUI();

  if (typeof Plyr === "undefined") {
    renderUI(langData.plyr_not_loaded || "Plyr 未載入，請檢查擴展檔案");
    return;
  }

  const player = new Plyr(video, {
    controls: [
      "play-large",
      "play",
      "progress",
      "current-time",
      "mute",
      "volume",
      "captions",
      "settings",
      "pip",
      "airplay",
      "fullscreen",
    ],
    settings: ["quality", "speed", "captions"],
    quality: {
      default: "auto",
      options: ["auto", "1080", "720", "480", "360", "240"],
    },
    captions: { active: false },
    volume: 1,
    muted: false,
    autoplay: true,
    keyboard: {
      focused: true,
      global: false,
    },
    pip: true,
  });

  const urlParams = new URLSearchParams(window.location.search);
  const streamUrl = urlParams.get("url");

  if (!streamUrl) {
    renderUI(
      langData.no_stream_url ||
        "請提供串流網址，例如 ?url=https:example.com/stream.m3u8"
    );
    return;
  }

  video.addEventListener("canplay", () => {
    video
      .play()
      .catch((err) =>
        renderUI(langData.playback_failed || `播放失敗：${err.message}`)
      );
  });

  const canPlayHlsNatively =
    video.canPlayType("application/vnd.apple.mpegurl") !== "";

  if (streamUrl.endsWith(".m3u8")) {
    if (canPlayHlsNatively) {
      video.src = streamUrl;
    } else if (typeof Hls !== "undefined" && Hls.isSupported()) {
      const hls = new Hls({
        autoStartLoad: true,
        startLevel: -1,
        debug: false,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () =>
        player.play().catch(console.error)
      );
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          renderUI(langData.hls_error || `HLS 錯誤：${data.details}`);
        }
      });
    } else {
      renderUI(
        langData.hls_not_supported || "瀏覽器不支援 HLS 播放或 hls.js 未載入"
      );
    }
  } else if (streamUrl.endsWith(".mpd")) {
    if (typeof dashjs !== "undefined" && dashjs.MediaPlayer) {
      const dash = dashjs.MediaPlayer().create();
      dash.initialize(video, streamUrl, true);
      dash.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true } } },
      });
      dash.on(dashjs.MediaPlayer.events.ERROR, (e) => {
        renderUI(langData.dash_error || `DASH 錯誤：${e.error.message}`);
      });
    } else {
      renderUI(
        langData.dash_not_loaded || "dash.js 未正確載入，請檢查擴展檔案"
      );
    }
  } else {
    video.src = streamUrl;
    player
      .play()
      .catch((err) =>
        renderUI(langData.direct_play_failed || `直接播放失敗：${err.message}`)
      );
  }

  screenshotBtn.addEventListener("click", () => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `screenshot-${Date.now()}.png`;
      a.click();
    });
  });

  volumeSlider.addEventListener("input", (e) => {
    video.volume = parseFloat(e.target.value);
  });

  setInterval(() => {
    statsInfo.textContent = `Resolution: ${video.videoWidth}x${video.videoHeight}, Volume: ${video.volume}`;
  }, 1000);

  async function loadLanguage(lang) {
    try {
      const response = await fetch(
        chrome.runtime.getURL(`src/lang/${lang}.json`)
      );
      langData = await response.json();
      renderUI();
    } catch (error) {
      langData = {};
      renderUI();
    }
  }

  function getBrowserLanguage() {
    const lang = navigator.language.toLowerCase();
    const langMap = {
      en: "en",
      "zh-tw": "zh-tw",
      "zh-hk": "zh-tw",
      "zh-cn": "zh-cn",
      zh: "zh-cn",
      ja: "ja",
      ko: "ko",
    };
    return langMap[lang] || langMap[lang.split("-")[0]] || "en";
  }
});
