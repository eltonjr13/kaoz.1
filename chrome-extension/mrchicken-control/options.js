const appUrlInput = document.getElementById("appUrl");
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");
const saveButton = document.getElementById("save");

async function load() {
  const stored = await chrome.storage.sync.get({
    appUrl: "http://localhost:3000",
    token: ""
  });

  appUrlInput.value = stored.appUrl || "http://localhost:3000";
  tokenInput.value = stored.token || "";
}

async function save() {
  await chrome.storage.sync.set({
    appUrl: appUrlInput.value.trim().replace(/\/$/, ""),
    token: tokenInput.value.trim()
  });

  status.textContent = "Configuracao salva.";
  setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

saveButton.addEventListener("click", () => {
  void save();
});

void load();
