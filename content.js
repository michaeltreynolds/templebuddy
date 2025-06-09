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
    await fetch("https://temple-online-scheduling.churchofjesuschrist.org/api/templeInfo/setTemple", {
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
  // Get current temple info
  const templeInfo = await getCurrentTempleInfo();
  if (!templeInfo || !templeInfo.templeOrgId) return;

  const appointmentTypes = [
    "PROXY_BAPTISM",
    "PROXY_INITIATORY",
    "PROXY_ENDOWMENT",
    "PROXY_SEALING"
  ];

  // Use provided date or today
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

  // Create and inject the panel
  injectAppointmentsModal(results, date);
}

function injectAppointmentsModal(results, dateObj) {
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
    const newDate = new Date(year, month - 1, day); // local time, no timezone issues
    showAvailableAppointments(newDate);
  };
  dateRow.appendChild(dateLabel);
  dateRow.appendChild(dateInput);
  panel.appendChild(dateRow);

  const title = document.createElement("h2");
  title.textContent = "Available Appointments";
  title.style = "margin-top:0;font-size:1.2em;";
  panel.appendChild(title);

  if (results.length === 0) {
    const none = document.createElement("div");
    none.textContent = "No available appointments found for this date.";
    panel.appendChild(none);
  } else {
    const table = document.createElement("table");
    table.style = "width:100%;border-collapse:collapse;";
    table.innerHTML = `
      <tr>
        <th style="text-align:left;padding:4px;">Type</th>
        <th style="text-align:left;padding:4px;">Time</th>
        <th style="text-align:left;padding:4px;">Seats</th>
      </tr>
      ${results.map(r => {
        if (r.appointmentType === "PROXY_INITIATORY") {
          return `
            <tr>
              <td style="padding:4px;">Initiatory</td>
              <td style="padding:4px;">${r.sessionTime}</td>
              <td style="padding:0 4px;">
                <span style="background:#e3f0fb;color:#1a3a5d;padding:2px 8px;border-radius:4px;margin-right:4px;display:inline-block;min-width:32px;text-align:center;">
                  ${r.maleSeats}
                </span>
                <span style="background:#fde3ef;color:#a03a5d;padding:2px 8px;border-radius:4px;display:inline-block;min-width:32px;text-align:center;">
                  ${r.femaleSeats}
                </span>
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

