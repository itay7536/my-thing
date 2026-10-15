const DEFAULTS = {
  ownerName: 'Joseph Rozenblum',
  ownerEmail: 'joseph.rozenblum@beagent.com',
  buttonLabel: 'J.R.',
  solveLabel: 'Marked solved by Joseph',
  autoApply: true
};

const ids = ['ownerName', 'ownerEmail', 'buttonLabel', 'solveLabel', 'autoApply'];

async function load() {
  const values = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element.type === 'checkbox') element.checked = Boolean(values[id]);
    else element.value = values[id] || '';
  }
}

function show(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  setTimeout(() => { if (status.textContent === message) status.textContent = ''; }, 2200);
}

document.getElementById('save').addEventListener('click', async () => {
  const settings = {
    ownerName: document.getElementById('ownerName').value.trim(),
    ownerEmail: document.getElementById('ownerEmail').value.trim().toLowerCase(),
    buttonLabel: document.getElementById('buttonLabel').value.trim() || 'ME',
    solveLabel: document.getElementById('solveLabel').value.trim() || 'Mark solved by me',
    autoApply: document.getElementById('autoApply').checked
  };
  if (!settings.ownerName) return show('Enter the exact HubSpot employee name.');
  await chrome.storage.sync.set(settings);
  show('Settings saved. Refresh HubSpot if it is already open.');
});

document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULTS);
  await load();
  show('Defaults restored.');
});


function initialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ME';
  return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('.') + '.';
}

async function detectFromHubSpot() {
  const button = document.getElementById('detect');
  const detected = document.getElementById('detected');
  button.disabled = true;
  button.textContent = 'Detecting...';
  detected.hidden = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://app-eu1.hubspot.com/')) {
      throw new Error('Open HubSpot in the active tab first.');
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'detectHubSpotAccount' });
    if (!response?.ok) throw new Error(response?.error || 'Could not read the HubSpot account menu.');

    const ownerName = response.name.trim();
    const ownerEmail = response.email.trim().toLowerCase();
    const firstName = ownerName.split(/\s+/)[0] || 'me';

    document.getElementById('ownerName').value = ownerName;
    document.getElementById('ownerEmail').value = ownerEmail;
    document.getElementById('buttonLabel').value = initialsFromName(ownerName);
    document.getElementById('solveLabel').value = `Marked solved by ${firstName}`;

    await chrome.storage.sync.set({
      ownerName,
      ownerEmail,
      buttonLabel: document.getElementById('buttonLabel').value,
      solveLabel: document.getElementById('solveLabel').value,
      autoApply: document.getElementById('autoApply').checked
    });

    detected.innerHTML = `<strong>${ownerName}</strong><br>${ownerEmail}`;
    detected.hidden = false;
    show('Account detected and saved.');
  } catch (error) {
    show(error.message || 'Detection failed.');
  } finally {
    button.disabled = false;
    button.textContent = 'Detect from HubSpot';
  }
}

document.getElementById('detect').addEventListener('click', detectFromHubSpot);

load().then(() => setTimeout(detectFromHubSpot, 150));
