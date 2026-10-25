/* options.js — settings save/load */

const fields = ['serverUrl', 'owner', 'trackDefault', 'notify'];

function load() {
  chrome.storage.sync.get(fields, (cfg) => {
    document.getElementById('serverUrl').value = cfg.serverUrl || '';
    document.getElementById('owner').value = cfg.owner || '';
    document.getElementById('trackDefault').checked = cfg.trackDefault !== false;
    document.getElementById('notify').checked = cfg.notify !== false;
  });
}

document.getElementById('save').addEventListener('click', () => {
  let serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/+$/, '');
  const data = {
    serverUrl,
    owner: document.getElementById('owner').value.trim(),
    trackDefault: document.getElementById('trackDefault').checked,
    notify: document.getElementById('notify').checked,
  };
  chrome.storage.sync.set(data, () => {
    const s = document.getElementById('saved');
    s.classList.add('show');
    setTimeout(() => s.classList.remove('show'), 1500);
  });
});

load();
