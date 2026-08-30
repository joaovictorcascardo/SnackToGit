const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

async function loadToken() {
  const { githubToken } = await chrome.storage.local.get("githubToken");
  if (githubToken) tokenInput.value = githubToken;
}

async function saveToken() {
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ githubToken: token });
  status.textContent = "Salvo.";
  setTimeout(() => (status.textContent = ""), 2000);
}

saveBtn.addEventListener("click", saveToken);
loadToken();

// Click a tutorial screenshot to open it full screen.
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || "";
  lightbox.hidden = false;
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.removeAttribute("src");
}

for (const img of document.querySelectorAll(".steps-visual img")) {
  img.tabIndex = 0;
  img.title = "Clique para ampliar";
  img.addEventListener("click", () => openLightbox(img.src, img.alt));
  img.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openLightbox(img.src, img.alt);
    }
  });
}

lightbox.addEventListener("click", closeLightbox);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !lightbox.hidden) closeLightbox();
});
