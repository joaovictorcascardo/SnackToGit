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
