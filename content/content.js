(function () {
  const BTN_ID = "snack-gh-commit-btn";
  const TOAST_ID = "snack-gh-toast";

  const ICON_IDLE =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 12.5V3M4.2 6.6 8 2.8l3.8 3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.3h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

  function findDocsAnchor() {
    return document.querySelector('a[href*="docs.expo.dev"]');
  }

  function findButtonWhere(matcher) {
    const test =
      typeof matcher === "string" ? (text) => text === matcher : (text) => matcher.test(text);
    const buttons = document.querySelectorAll("button");
    for (const b of buttons) {
      const text = b.textContent ? b.textContent.trim() : "";
      if (text && test(text)) return b;
    }
    return null;
  }

  const findDownloadButton = () => findButtonWhere(/download as zip/i);
  const findPrettierButton = () => findButtonWhere("Prettier");

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

    try {
      chrome.runtime.sendMessage({ type: "OPEN_POPUP" }, (res) => {
        setBusy(btn, false);
        if (chrome.runtime.lastError || !res || !res.ok) {
          showToast("Não consegui abrir o popup sozinha. Clica no ícone da extensão.", true);
        }
      });
    } catch {
      setBusy(btn, false);
      showToast("A extensão foi atualizada — recarregue esta página (F5) e tente de novo.", true);
    }
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const anchor = findDocsAnchor();
    const downloadBtn = findDownloadButton();
    if (!anchor || !downloadBtn) return;

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
      return;
    }
  });

  const observer = new MutationObserver(() => injectButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectButton();

  let tabHeld = false;

  function resetTabHeld() {
    tabHeld = false;
  }

  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Tab") {
        tabHeld = true;
        return;
      }
      if (!tabHeld || ev.repeat || ev.key.toLowerCase() !== "s") return;

      const btn = findPrettierButton();
      if (!btn || btn.disabled) {
        showToast("Não encontrei o botão do Prettier nessa aba.", true);
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      btn.click();
      showToast("Código formatado com o Prettier.");
    },
    true
  );

  document.addEventListener(
    "keyup",
    (ev) => {
      if (ev.key === "Tab") resetTabHeld();
    },
    true
  );

  window.addEventListener("blur", resetTabHeld);
})();
