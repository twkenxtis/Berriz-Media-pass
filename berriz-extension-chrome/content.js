console.log("content.js loaded");

function tryDismissModal() {
  const modalLayer = document.querySelector(
    ".muscat-ui-modal-layer.bg-BLACK300.z-modal"
  );

  if (modalLayer) {
    // Localized messages
    const messages = {
      ko: "모달 창이 닫혔습니다",
      en: "Modal closed",
      ja: "モーダルを閉じました",
      "zh-CN": "彈窗已關閉",
      "zh-TW": "彈窗已關閉",
      default: "Modal closed",
    };

    const browserLang = navigator.language || navigator.userLanguage;
    const langCode = browserLang.split("-")[0];
    const notificationText =
      messages[browserLang] || messages[langCode] || messages["default"];

    // 若尚未注入 CSS 樣式，則動態插入
    if (!document.getElementById("berriz-notification-style")) {
      const style = document.createElement("style");
      style.id = "berriz-notification-style";
      style.textContent = `
        @keyframes berriz-notif-fade {
          0% { transform: translateY(8px); opacity: 0; }
          20% { transform: translateY(0); opacity: 1; }
          80% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-8px); opacity: 0; }
        }
        .berriz-notification {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #03C75A;
          color: white;
          padding: 10px 16px;
          border-radius: 4px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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

    // 移除現有的通知元素，避免重複出現
    document
      .querySelectorAll(".berriz-notification")
      .forEach((el) => el.remove());

    // 建立通知
    const notification = document.createElement("div");
    notification.className = "berriz-notification";
    notification.textContent = notificationText;
    document.body.appendChild(notification);
    notification.addEventListener("animationend", () => notification.remove());

    // 處理 modal：若找到按鈕則點擊，否則直接移除整個模態層
    const okButton = modalLayer.querySelector("button");
    if (okButton) {
      okButton.click();
    } else {
      modalLayer.remove();
    }
  }
}

function initialize() {
  tryDismissModal();
  const observer = new MutationObserver(() => tryDismissModal());
  observer.observe(document.body, { childList: true, subtree: true });
}

// 根據 document.readyState 判斷是否需等待 DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
