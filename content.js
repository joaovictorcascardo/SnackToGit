(function () {
  const BTN_ID = "snack-gh-commit-btn";
  const TOAST_ID = "snack-gh-toast";
  const STYLE_ID = "snack-gh-style";

  const ICON_IDLE =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 12.5V3M4.2 6.6 8 2.8l3.8 3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.3h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

  function findDocsAnchor() {
    return document.querySelector('a[href*="docs.expo.dev"]');
  }

  function findDownloadButton() {
    const buttons = document.querySelectorAll("button");
    for (const b of buttons) {
      if (b.textContent && /download as zip/i.test(b.textContent)) return b;
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .snack-gh-btn, .snack-gh-btn:disabled {
        background: #6b8e3f !important;
        border: 2px solid #14170f !important;
        border-radius: 9px !important;
        color: #fff !important;
        opacity: 1 !important;
        margin-left: 8px;
        display: inline-flex !important;
        align-items: center;
        gap: 6px;
        font-weight: 700 !important;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        box-shadow: 2.5px 2.5px 0 #14170f;
        transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.08s ease;
      }
      .snack-gh-btn:hover:not(:disabled) {
        background: #7fa64c !important;
        transform: translate(-1px, -1px);
        box-shadow: 3.5px 3.5px 0 #14170f;
      }
      .snack-gh-btn:active:not(:disabled) {
        transform: translate(1px, 1px);
        box-shadow: 0.5px 0.5px 0 #14170f;
      }
      .snack-gh-btn:disabled {
        background: #9fae8a !important;
        cursor: default;
      }
      .snack-gh-btn svg {
        display: block !important;
      }
      .snack-gh-btn .snack-gh-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .snack-gh-btn.snack-gh-busy .snack-gh-icon svg {
        animation: snack-gh-spin 0.8s linear infinite;
      }
      @keyframes snack-gh-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      #${TOAST_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 999999;
        padding: 10px 16px;
        background: #fffdf6;
        color: #14170f;
        border: 2.5px solid #14170f;
        border-radius: 10px;
        box-shadow: 4px 4px 0 #14170f;
        font: 700 12.5px "Poppins", -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        max-width: 300px;
      }
      #${TOAST_ID}.snack-gh-toast-error {
        background: #ffe4e0;
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(text, isError) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.classList.toggle("snack-gh-toast-error", !!isError);
    el.textContent = text;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.remove(), 4500);
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.classList.toggle("snack-gh-busy", busy);
  }

  async function onCommitClick(btn) {
    if (btn.disabled) return;
    setBusy(btn, true);

    chrome.runtime.sendMessage({ type: "OPEN_POPUP" }, (res) => {
      setBusy(btn, false);
      if (!res || !res.ok) {
        showToast("Não consegui abrir o popup sozinha. Clica no ícone da extensão.", true);
      }
    });
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const anchor = findDocsAnchor();
    const downloadBtn = findDownloadButton();
    if (!anchor || !downloadBtn) return;

    injectStyle();

    const btn = downloadBtn.cloneNode(true);
    btn.id = BTN_ID;
    btn.removeAttribute("disabled");
    btn.className = downloadBtn.className + " snack-gh-btn";

    const label = btn.querySelector("span span") || btn.querySelector("span");
    if (label) label.textContent = "Commitar";

    const svg = btn.querySelector("svg");
    if (svg) {
      const iconWrap = document.createElement("span");
      iconWrap.className = "snack-gh-icon";
      iconWrap.innerHTML = ICON_IDLE;
      svg.replaceWith(iconWrap);
    }

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onCommitClick(btn);
    });

    anchor.insertAdjacentElement("afterend", btn);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "TRIGGER_DOWNLOAD") {
      const downloadBtn = findDownloadButton();
      if (downloadBtn) {
        downloadBtn.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Botão de download não encontrado nessa aba." });
      }
    }
  });

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButton();
})();
