let userClickedBypassButton = false;
let resetBypassTimeoutId = null;

document.addEventListener("click", (event) => {
  const button = event.target.closest("button.size-34.relative.shrink-0");
  if (button) {
    userClickedBypassButton = true;
    console.log("使用者點擊了特定按鈕，設定跳過旗標");

    // 清除之前的定時器，避免重複解鎖
    if (resetBypassTimeoutId) {
      clearTimeout(resetBypassTimeoutId);
    }

    // 50ms 後重置旗標並重新嘗試執行判斷
    resetBypassTimeoutId = setTimeout(() => {
      userClickedBypassButton = false;
      resetBypassTimeoutId = null;
      console.log("跳過旗標自動重置，重新嘗試執行 tryDismissModal");
      tryDismissModal();
    }, 50);
  }
});

function tryDismissModal() {
  // 判斷通知是否展開（標題存在即代表展開）
  const isNotificationExpanded = !!document.querySelector(
    "div.border-WHITE100.flex.h-64.items-center.border-b.px-24 > h2.f-title-m-bold"
  );

  if (userClickedBypassButton || isNotificationExpanded) {
    console.log(
      "跳過 tryDismissModal：",
      `userClickedBypassButton=${userClickedBypassButton}, isNotificationExpanded=${isNotificationExpanded}`
    );
    // 不直接重置 userClickedBypassButton，留給定時器處理
    return;
  }

  // 偵測特定畫面存在就跳過
  if (
    document.querySelector(
      "div.absolute.inset-0.mx-auto.max-w-\\[1320px\\].px-20.pt-40.md\\:pt-25.md\\:px-30.lg\\:px-46"
    )
  ) {
    console.log("偵測到特定畫面，取消自動關閉 modal");
    return;
  }

  const modalLayer = document.querySelector(
    ".muscat-ui-modal-layer.bg-BLACK300.z-modal"
  );

  if (modalLayer) {
    // 多語言提示訊息
    const messages = {
      ko: "모달 창이 닫혔습니다",
      en: "Modal closed",
      ja: "モーダルを閉じました",
      "zh-CN": "弹窗已关闭",
      "zh-TW": "彈窗已關閉",
      default: "Modal closed",
    };

    const browserLang = navigator.language || navigator.userLanguage;
    const langCode = browserLang.split("-")[0];
    const notificationText =
      messages[browserLang] || messages[langCode] || messages["default"];

    // 注入通知樣式（只注入一次）
    if (!document.getElementById("berriz-extensive-notification-style")) {
      const style = document.createElement("style");
      style.id = "berriz-extensive-notification-style";
      style.textContent = `
        @keyframes berriz-notif-fade {
          0% { transform: translateY(8px); opacity: 0; }
          20% { transform: translateY(0); opacity: 1; }
          80% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-8px); opacity: 0; }
        }
        .berriz-extensive-notification {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #03C75A;
          color: white;
          padding: 10px 16px;
          border-radius: 4px;
          font-family: -apple-system, BlinkMacSystemFont,
                       'Segoe UI', Roboto, Helvetica, Arial,
                       sans-serif;
          font-size: 12px;
          font-weight: 500;
          z-index: 999999;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          animation: berriz-notif-fade 2s ease-in-out forwards;
          max-width: 240px;
          line-height: 1.4;
          pointer-events: none;
          backdrop-filter: blur(2px);
        }
      `;
      document.head.appendChild(style);
    }

    // 移除之前的通知元素，避免重複
    document
      .querySelectorAll(".berriz-extensive-notification")
      .forEach((el) => el.remove());

    // 新增通知元素
    const notification = document.createElement("div");
    notification.className = "berriz-extensive-notification";
    notification.textContent = notificationText;
    document.body.appendChild(notification);

    // 動畫結束後移除通知元素
    notification.addEventListener("animationend", () => notification.remove());

    // 嘗試關閉 modal
    const okButton = modalLayer.querySelector("button");
    if (okButton) {
      okButton.click();
    } else {
      modalLayer.remove();
    }
  }
}

// 啟動觀察邏輯
chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATUS" }, (response) => {
  if (chrome.runtime.lastError) {
    console.error("無法取得擴展狀態:", chrome.runtime.lastError);
    return;
  }

  if (response && response.isActive) {
    const startObserving = () => {
      tryDismissModal(); // 初次執行
      const observer = new MutationObserver(() => tryDismissModal());
      observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
      startObserving();
    } else {
      window.addEventListener("DOMContentLoaded", startObserving);
    }
  } else {
    console.log("擴展已停用，content.js 不執行功能");
  }
});
