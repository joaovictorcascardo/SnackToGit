const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.local.get("githubToken", (data) => {
  if (data.githubToken) tokenInput.value = data.githubToken;
});

saveBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  chrome.storage.local.set({ githubToken: token }, () => {
    status.textContent = "Salvo.";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});
