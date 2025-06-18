const ORG_ID_KEY = "desiredTempleOrgId";
const templeDiv = document.getElementById("temple");
const statusDiv = document.getElementById("status");

chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const tab = tabs[0];
  if (
    tab &&
    tab.url &&
    tab.url.startsWith("https://temple-online-scheduling.churchofjesuschrist.org/")
  ) {
    chrome.tabs.sendMessage(tab.id, { type: "GET_TEMPLE_INFO" }, (response) => {
      if (!response || !response.templeName || !response.templeOrgId) {
        templeDiv.textContent = "Could not fetch temple info.";
        return;
      }
      const btn = document.createElement("button");
      btn.textContent = `Make ${response.templeName} your default temple!`;
      btn.onclick = () => {
        chrome.storage.local.set({ [ORG_ID_KEY]: response.templeOrgId }, () => {
          statusDiv.textContent = `${response.templeName} is now your default temple!`;
        });
      };
      templeDiv.appendChild(btn);
    });
  } else {
    templeDiv.innerHTML = `
      Please navigate to the <a href="https://temple-online-scheduling.churchofjesuschrist.org/" target="_blank" style="color:#b89c3c;text-decoration:underline;">temple scheduling page</a>.
    `;
    templeDiv.className = "error";
  }
});