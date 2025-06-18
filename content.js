// Content script for Temple Buddy

const ORG_ID_KEY = "desiredTempleOrgId";

// Listen for changes to the desired orgId in storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[ORG_ID_KEY]) {
    maybeSetTemple();
  }
});

// Run on load as well
maybeSetTemple();

function maybeSetTemple() {
  chrome.storage.local.get([ORG_ID_KEY], async (result) => {
    const desiredOrgId = result[ORG_ID_KEY];
    console.log("Desired orgId:", desiredOrgId);
    if (!desiredOrgId) return;

    // Get current orgId using the new API
    const currentOrgId = await getCurrentOrgId();
    console.log("Current orgId:", currentOrgId);
    if (currentOrgId === null) return;

    if (currentOrgId !== desiredOrgId) {
      // Set the temple to the desired orgId
      console.log(`Setting temple orgId to ${desiredOrgId}`);
      await setTempleOrgId(desiredOrgId);
      console.log("Temple orgId set successfully");
      // Wait a moment for the change to take effect, then reload
      setTimeout(() => window.location.reload(), 500);
    }
  });
}

async function getCurrentOrgId() {
  try {
    const response = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9"
      },
      credentials: "include",
      method: "GET"
    });
    if (!response.ok) return null;
    const data = await response.json();
    console.log("Current templeInfo data:", data);
    return data.templeOrgId;
  } catch (e) {
    console.error("Failed to get current orgId", e);
    return null;
  }
}

async function setTempleOrgId(orgId) {
  try {
    // Set the temple and get info in one step
    const infoRes = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/setTemple", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8"
      },
      referrer: "https://temple-online-scheduling.churchofjesuschrist.org/",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: JSON.stringify({ orgId }),
      method: "POST",
      mode: "cors",
      credentials: "include"
    });

    const info = await infoRes.json();

    console.log(`Temple orgId set to ${orgId}`);
  } catch (e) {
    console.error("Failed to set orgId", e);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TEMPLE_INFO") {
    getCurrentTempleInfo().then(info => sendResponse(info));
    return true; // Keep the message channel open for async response
  }
});

async function getCurrentTempleInfo() {
  try {
    const response = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9"
      },
      credentials: "include",
      method: "GET"
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      templeName: data.templeName,
      templeOrgId: data.templeOrgId
    };
  } catch (e) {
    return null;
  }
}

// Utility to get today's date in YYYY, M, D (month is 1-based)
function getTodayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(), // 0-based for API
    day: now.getDate()
  };
}

// Main function to fetch and display available appointments
async function showAvailableAppointments(dateObj) {
  // Show loading spinner modal
  showLoadingModal();

  // Get current temple info
  const templeInfo = await getCurrentTempleInfo();
  if (!templeInfo || !templeInfo.templeOrgId) {
    injectAppointmentsModal([], dateObj);
    removeLoadingModal();
    return;
  }

  const appointmentTypes = [
    "PROXY_BAPTISM",
    "PROXY_INITIATORY",
    "PROXY_ENDOWMENT",
    "PROXY_SEALING"
  ];

  const date = dateObj || new Date();
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-based for API
  const day = date.getDate();
  const results = [];

  for (const type of appointmentTypes) {
    const response = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeSchedule/getSessionInfo", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify({
        sessionYear: year,
        sessionMonth: month,
        sessionDay: day,
        appointmentType: type,
        templeOrgId: templeInfo.templeOrgId,
        isGuestConfirmation: false
      }),
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) continue;
    const data = await response.json();
    if (!data.sessionList) continue;

    for (const session of data.sessionList) {
      const { sessionTime, appointmentType, details } = session;
      const isRoomFull = !!details.roomFull;

      if (appointmentType === "PROXY_INITIATORY") {
        const maleSeats = typeof details.maleSeatsAvailable === "number" ? details.maleSeatsAvailable : 0;
        const femaleSeats = typeof details.femaleSeatsAvailable === "number" ? details.femaleSeatsAvailable : 0;
        if (!isRoomFull && (maleSeats > 0 || femaleSeats > 0)) {
          results.push({
            appointmentType,
            sessionTime,
            maleSeats,
            femaleSeats
          });
        }
      } else {
        const seatsAvailable = typeof details.seatsAvailable === "number" ? details.seatsAvailable : 0;
        if (!isRoomFull && seatsAvailable > 0) {
          results.push({
            appointmentType,
            sessionTime,
            seatsAvailable
          });
        }
      }
    }
  }

  // If inside an async function:
  await injectAppointmentsModal(results, dateObj);

  // If not inside an async function:
  injectAppointmentsModal(results, dateObj).then(() => { /* ... */ });

  removeLoadingModal();
}

// Loading spinner modal
function showLoadingModal() {
  removeLoadingModal();
  const loadingModal = document.createElement("div");
  loadingModal.id = "templebuddy-loading-modal";
  loadingModal.style = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.18);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  loadingModal.innerHTML = `
    <div style="
      background: #fffbe7;
      border: 2px solid #e2c96f;
      border-radius: 10px;
      padding: 32px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 2px 16px #0002;
    ">
      <div style="
        width: 48px;
        height: 48px;
        border: 6px solid #e2c96f;
        border-top: 6px solid #b89c3c;
        border-radius: 50%;
        animation: templebuddy-spin 1s linear infinite;
        margin-bottom: 16px;
      "></div>
      <div style="color:#4b3c10;font-size:1.1em;">Loading appointments...</div>
    </div>
    <style>
      @keyframes templebuddy-spin {
        0% { transform: rotate(0deg);}
        100% { transform: rotate(360deg);}
      }
    </style>
  `;
  document.body.appendChild(loadingModal);
}

function removeLoadingModal() {
  const loadingModal = document.getElementById("templebuddy-loading-modal");
  if (loadingModal) loadingModal.remove();
}

async function injectAppointmentsModal(results, dateObj) {
  // Remove old modal if present
  const oldModal = document.getElementById("templebuddy-appointments-modal");
  if (oldModal) oldModal.remove();

  // Modal overlay
  const modal = document.createElement("div");
  modal.id = "templebuddy-appointments-modal";
  modal.style = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.35);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Modal content
  const panel = document.createElement("div");
  panel.style = `
    background: #fffbe7;
    border: 2px solid #e2c96f;
    padding: 16px;
    max-width: 600px;
    width: 90vw;
    max-height: 500px;
    height: 500px;
    font-family: Arial, sans-serif;
    font-size: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 16px #0004;
    overflow-y: auto;
    position: relative;
  `;

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.style = `
    position: absolute;
    top: 8px;
    right: 12px;
    width: 40px;
    height: 40px;
    background: transparent;
    border: none;
    font-size: 2em;
    cursor: pointer;
    color: #b89c3c;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    z-index: 10; /* Ensure it's above other content */
    pointer-events: auto;
    transition: background 0.2s, color 0.2s;
  `;
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = "#f3e5a6";
    closeBtn.style.color = "#7a5a00";
  };
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "#b89c3c";
  };
  closeBtn.onclick = () => modal.remove();
  panel.appendChild(closeBtn);

  // Date picker
  const dateRow = document.createElement("div");
  dateRow.style = "margin-bottom: 12px; display: flex; align-items: center; gap: 8px;";
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Date:";
  dateLabel.style = "font-weight: bold;";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.valueAsDate = dateObj || new Date();
  dateInput.style = "padding: 2px 6px; font-size: 1em; border-radius: 4px; border: 1px solid #e2c96f;";
  dateInput.onchange = () => {
    const [year, month, day] = dateInput.value.split('-').map(Number);
    const newDate = new Date(year, month - 1, day);
    showAvailableAppointments(newDate);
  };
  dateRow.appendChild(dateLabel);
  dateRow.appendChild(dateInput);

  // Add "View Next Day" link
  const nextDayLink = document.createElement("a");
  nextDayLink.href = "#";
  nextDayLink.textContent = "View Next Day →";
  nextDayLink.style = `
    margin-left: 12px;
    color: #4b3c10;
    text-decoration: underline;
    font-size: 1em;
    cursor: pointer;
    font-weight: 500;
  `;
  nextDayLink.onclick = (e) => {
    e.preventDefault();
    const current = dateInput.valueAsDate || new Date();
    const next = new Date(current);
    next.setDate(current.getDate() + 1);
    dateInput.valueAsDate = next;
    showAvailableAppointments(next);
  };
  dateRow.appendChild(nextDayLink);

  // --- Addable temples buttons ---
  if (templeCacheReady && cachedTemplesList.length > 0) {
    // Exclude already selected and current temple
    const currentTemple = await getCurrentTempleInfo();
    const addableTemples = cachedTemplesList
      .filter(t => !selectedTempleOrgIds.includes(t.orgId) && t.orgId !== currentTemple.templeOrgId)
      .sort((a, b) => a.name.localeCompare(b.name)) // or by distance if you want
      .slice(0, 3);

    // Container for vertical stacking
    const btnContainer = document.createElement("div");
    btnContainer.style = "display: flex; flex-direction: column; gap: 8px; margin-left: 16px;";

    addableTemples.forEach(t => {
      const btn = document.createElement("button");
      btn.style = `
        display: flex; align-items: center; border-radius: 999px; background: #e3f0fb;
        border: none; padding: 4px 14px 4px 4px; cursor: pointer; font-size: 0.97em;
        box-shadow: 0 1px 4px #0001; transition: background 0.2s;
        margin: 0;
      `;
      btn.innerHTML = `
        <img src="${t.imageUrl}" style="width:24px;height:24px;border-radius:50%;margin-right:8px;">
        <span style="font-weight:500;">${t.name}</span>
        <span style="margin-left:8px;font-size:1.2em;">＋</span>
      `;
      btn.onclick = async () => {
        showLoadingModal();
        addTempleToList(t.orgId);
        await renderAllTemplesAppointments(dateObj);
        removeLoadingModal();
      };
      btnContainer.appendChild(btn);
    });

    dateRow.appendChild(btnContainer);
  } else {
    // Show spinner and message while building cache
    const spinner = document.createElement("span");
    spinner.style = `
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 3px solid #e2c96f;
      border-top: 3px solid #b89c3c;
      border-radius: 50%;
      animation: templebuddy-spin 1s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    `;
    spinner.innerHTML = "&nbsp;";
    const msg = document.createElement("span");
    msg.style = "font-style: italic; color: #888; vertical-align: middle;";
    msg.textContent = "Building nearby temple cache...";
    dateRow.appendChild(spinner);
    dateRow.appendChild(msg);

    // Add keyframes for spinner animation
    const style = document.createElement("style");
    style.textContent = `
      @keyframes templebuddy-spin {
        0% { transform: rotate(0deg);}
        100% { transform: rotate(360deg);}
      }
    `;
    document.head.appendChild(style);
  }

  panel.appendChild(dateRow);

  // --- Render each selected temple's appointments ---
  for (const orgId of selectedTempleOrgIds) {
    const t = cachedTemplesList.find(temp => temp.orgId === orgId);
    if (!t) continue;

    // Header with image, name, and trash icon
    const heading = document.createElement("div");
    heading.style = "display:flex;align-items:center;margin-top:18px;margin-bottom:4px;";
    heading.innerHTML = `
      <img src="${t.imageUrl}" style="width:28px;height:28px;border-radius:50%;margin-right:8px;">
      <span style="font-size:1.08em;font-weight:bold;">${t.name}</span>
      <button style="margin-left:10px;background:none;border:none;cursor:pointer;font-size:1.2em;color:#a03a5d;" title="Remove temple">
        🗑️
      </button>
    `;
    heading.querySelector("button").onclick = async () => {
      removeTempleFromList(orgId);
      await renderAllTemplesAppointments(dateObj);
    };
    panel.appendChild(heading);

    // Appointments table
    const dateKey = dateObj.toDateString();
    let appointments = templeAppointmentsCache[`${orgId}_${dateKey}`];
    if (!appointments) {
      showLoadingModal();
      appointments = await fetchTempleAppointments(orgId, dateObj);
      templeAppointmentsCache[`${orgId}_${dateKey}`] = appointments;
      removeLoadingModal();
    }
    // Render appointments table for this temple (reuse your table code)
    const table = document.createElement("table");
    table.style = "width:100%;border-collapse:collapse;";
    table.innerHTML = `
      <tr>
        <th style="text-align:left;padding:4px;">Type</th>
        <th style="text-align:left;padding:4px;">Time</th>
        <th style="text-align:left;padding:4px;">Seats</th>
      </tr>
      ${appointments.map(r => {
        if (r.appointmentType === "PROXY_INITIATORY") {
          const maleBox = r.maleSeats > 0
            ? `<span style="background:#e3f0fb;color:#1a3a5d;padding:2px 8px;border-radius:4px;margin-right:4px;display:inline-block;min-width:32px;text-align:center;">
                  ${r.maleSeats}
                </span>`
            : "";
          const femaleBox = r.femaleSeats > 0
            ? `<span style="background:#fde3ef;color:#a03a5d;padding:2px 8px;border-radius:4px;display:inline-block;min-width:32px;text-align:center;">
                  ${r.femaleSeats}
                </span>`
            : "";
          return `
            <tr>
              <td style="padding:4px;">Initiatory</td>
              <td style="padding:4px;">${r.sessionTime}</td>
              <td style="padding:0 4px;">
                ${maleBox}${femaleBox}
              </td>
            </tr>
          `;
        } else {
          return `
            <tr>
              <td style="padding:4px;">${r.appointmentType.replace("PROXY_", "")}</td>
              <td style="padding:4px;">${r.sessionTime}</td>
              <td style="padding:4px;">${r.seatsAvailable}</td>
            </tr>
          `;
        }
      }).join("")}
    `;
    panel.appendChild(table);
  }

  modal.appendChild(panel);
  document.body.appendChild(modal);

  // Close modal on overlay click (but not when clicking inside the panel)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

// Update the button to always use today's date by default
function injectShowAppointmentsButton() {
  if (document.getElementById("templebuddy-show-appointments-btn")) return;

  const btn = document.createElement("button");
  btn.id = "templebuddy-show-appointments-btn";
  btn.textContent = "Show Available Appointments";
  btn.style = `
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 9998;
    background: #e2c96f;
    color: #4b3c10;
    border: none;
    border-radius: 6px;
    padding: 12px 20px;
    font-size: 16px;
    font-family: Arial, sans-serif;
    box-shadow: 0 2px 8px #0002;
    cursor: pointer;
    transition: background 0.2s;
  `;
  btn.onmouseenter = () => btn.style.background = "#f3e5a6";
  btn.onmouseleave = () => btn.style.background = "#e2c96f";
  btn.onclick = () => showAvailableAppointments(new Date());

  document.body.appendChild(btn);
}

// Inject the button when the page loads
injectShowAppointmentsButton();

// Temple Cache

const TEMPLES_CACHE_KEY = "templebuddy_temples_cache";
const TEMPLES_CACHE_TIMESTAMP_KEY = "templebuddy_temples_cache_timestamp";
const TEMPLES_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 1 week

const GOOGLE_GEOCODE_API_KEY = "AIzaSyATBWymi5uQHiIEvivOQXedZJeUBXUqaBg";

// Utility: fetch temple IDs with online scheduling
async function fetchTempleOrgIds() {
  const res = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeConfig/findAllOnlineSchedulingStatuses", {
    headers: { "accept": "application/json, text/plain, */*" },
    credentials: "include",
    method: "GET"
  });
  if (!res.ok) throw new Error("Failed to fetch temple org IDs");
  const data = await res.json();
  return data.filter(t => t.onlineSchedulingAvailable).map(t => t.templeOrgId);
}

// Utility: fetch temple info by orgId
async function fetchTempleInfo(orgId) {
  const res = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/setTemple", {
    headers: {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json;charset=UTF-8"
    },
    referrer: "https://temple-online-scheduling.churchofjesuschrist.org/",
    referrerPolicy: "strict-origin-when-cross-origin",
    body: JSON.stringify({ orgId }),
    method: "POST",
    mode: "cors",
    credentials: "include"
  });
  if (!res.ok) throw new Error("Failed to fetch temple info");
  const data = await res.json();
  if (data.templeOrgId !== orgId) throw new Error("Temple info mismatch");
  return data;
}

// Utility: fetch temple image URL by orgId
async function fetchTempleImageUrl(orgId) {
  const res = await fetch(`https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/getTempleTitanImage/${orgId}`, {
    headers: { "accept": "application/json, text/plain, */*" },
    credentials: "include",
    method: "GET"
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url || null;
}

// Utility: geocode address to lat/lng
async function geocodeAddress(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_GEOCODE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to geocode address");
  const data = await res.json();
  if (data.status !== "OK" || !data.results.length) return { lat: null, lng: null };
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

// Utility: get cached temples
function getCachedTemples() {
  return new Promise(resolve => {
    chrome.storage.local.get([TEMPLES_CACHE_KEY, TEMPLES_CACHE_TIMESTAMP_KEY], result => {
      resolve({
        temples: result[TEMPLES_CACHE_KEY] || [],
        timestamp: result[TEMPLES_CACHE_TIMESTAMP_KEY] || 0
      });
    });
  });
}

// Utility: set cached temples
function setCachedTemples(temples) {
  const now = Date.now();
  return new Promise(resolve => {
    chrome.storage.local.set({
      [TEMPLES_CACHE_KEY]: temples,
      [TEMPLES_CACHE_TIMESTAMP_KEY]: now
    }, resolve);
  });
}

// Main: initialize and cache all temples (refresh if cache is old or missing)
async function initTemples(forceRefresh = false) {
  const { temples: cachedTemples, timestamp } = await getCachedTemples();
  const cachedById = {};
  for (const t of cachedTemples) {
    if (t && t.orgId && t.name && t.address && t.lat != null && t.lng != null) {
      cachedById[t.orgId] = t;
    }
  }

  // Always get the latest list of orgIds
  const orgIds = await fetchTempleOrgIds();
  const allTemples = [];

  // Save the original temple so we can restore it later
  let originalTempleOrgId = null;
  if (typeof getCurrentTempleInfo === "function") {
    try {
      const currentTemple = await getCurrentTempleInfo();
      originalTempleOrgId = currentTemple && currentTemple.templeOrgId;
    } catch (e) {
      // fallback: don't restore if we can't get it
    }
  }

  for (const orgId of orgIds) {
    let temple = cachedById[orgId];
    // If forceRefresh or missing/incomplete, fetch fresh
    if (
      forceRefresh ||
      !temple ||
      !temple.name ||
      !temple.address ||
      temple.lat == null ||
      temple.lng == null
    ) {
      try {
        // Fetch info for each temple using setTemple
        const infoRes = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/setTemple", {
          headers: {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json;charset=UTF-8"
          },
          referrer: "https://temple-online-scheduling.churchofjesuschrist.org/",
          referrerPolicy: "strict-origin-when-cross-origin",
          body: JSON.stringify({ orgId }),
          method: "POST",
          mode: "cors",
          credentials: "include"
        });
        if (!infoRes.ok) continue;
        const info = await infoRes.json();

        // Geocode address
        const { lat, lng } = await geocodeAddress(info.primaryAddress);

        // Get image
        const imageUrl = await fetchTempleImageUrl(orgId);

        temple = {
          orgId,
          name: info.templeName,
          address: info.primaryAddress,
          lat,
          lng,
          imageUrl
        };
      } catch (e) {
        console.warn("Failed to process temple", orgId, e);
        continue;
      }
    }
    allTemples.push(temple);
  }

  // Restore the user's original temple
  if (originalTempleOrgId) {
    await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/setTemple", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8"
      },
      referrer: "https://temple-online-scheduling.churchofjesuschrist.org/",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: JSON.stringify({ orgId: originalTempleOrgId }),
      method: "POST",
      mode: "cors",
      credentials: "include"
    });
  }

  // Remove any temples that are no longer in the orgIds list
  await setCachedTemples(allTemples);
  return allTemples;
}

// Helper: Euclidean distance (approx, for small distances)
function distance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const toRad = x => x * Math.PI / 180;
  const R = 6371; // Earth's radius in kilometers. Use 3958.8 for miles

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

// Main: get N closest temples to a given templeOrgId (excluding itself)
async function getNearbyTemples(currentTempleOrgId, count = 3) {
  const { temples } = await getCachedTemples();
  const current = temples.find(t => t.orgId === currentTempleOrgId || t.orgId === Number(currentTempleOrgId));
  if (!current || current.lat == null || current.lng == null) return [];

  // Sort by distance, exclude self
  const sorted = temples
    .filter(t => t.orgId !== currentTempleOrgId && t.lat != null && t.lng != null)
    .map(t => ({
      ...t,
      _dist: distance(current.lat, current.lng, t.lat, t.lng)
    }))
    .sort((a, b) => a._dist - b._dist); // ascending: closest first

  return sorted.slice(0, count);
}

// Exported API
window.templeBuddyTemples = {
  initTemples,
  getNearbyTemples
};

let selectedTempleOrgIds = [];
let templeAppointmentsCache = {}; // key: `${orgId}_${dateString}` -> results

async function fetchTempleAppointments(templeOrgId, dateObj) {
  const appointmentTypes = [
    "PROXY_BAPTISM",
    "PROXY_INITIATORY",
    "PROXY_ENDOWMENT",
    "PROXY_SEALING"
  ];
  const date = dateObj || new Date();
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const results = [];

  for (const type of appointmentTypes) {
    const response = await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeSchedule/getSessionInfo", {
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify({
        sessionYear: year,
        sessionMonth: month,
        sessionDay: day,
        appointmentType: type,
        templeOrgId,
        isGuestConfirmation: false
      }),
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) continue;
    const data = await response.json();
    if (!data.sessionList) continue;

    for (const session of data.sessionList) {
      const { sessionTime, appointmentType, details } = session;
      const isRoomFull = !!details.roomFull;

      if (appointmentType === "PROXY_INITIATORY") {
        const maleSeats = typeof details.maleSeatsAvailable === "number" ? details.maleSeatsAvailable : 0;
        const femaleSeats = typeof details.femaleSeatsAvailable === "number" ? details.femaleSeatsAvailable : 0;
        if (!isRoomFull && (maleSeats > 0 || femaleSeats > 0)) {
          results.push({
            appointmentType,
            sessionTime,
            maleSeats,
            femaleSeats
          });
        }
      } else {
        const seatsAvailable = typeof details.seatsAvailable === "number" ? details.seatsAvailable : 0;
        if (!isRoomFull && seatsAvailable > 0) {
          results.push({
            appointmentType,
            sessionTime,
            seatsAvailable
          });
        }
      }
    }
  }
  return results;
}

// Global variable to track when temples are loaded
let templeCacheReady = false;
let cachedTemplesList = [];

(async () => {
  cachedTemplesList = await window.templeBuddyTemples.initTemples();
  templeCacheReady = true;
})();

function addTempleToList(orgId) {
  if (!selectedTempleOrgIds.includes(orgId)) {
    selectedTempleOrgIds.push(orgId);
  }
}

function removeTempleFromList(orgId) {
  selectedTempleOrgIds = selectedTempleOrgIds.filter(id => id !== orgId);
}

// Helper to re-render modal with current state
async function renderAllTemplesAppointments(dateObj) {
  const oldModal = document.getElementById("templebuddy-appointments-modal");
  if (oldModal) oldModal.remove();
  await injectAppointmentsModal([], dateObj);
}

