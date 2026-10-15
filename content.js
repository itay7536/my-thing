(() => {
  const OWNER_FIELD = '[data-test-id="hs_pipeline_stage-hubspot_owner_id"]';
  const DEFAULTS = {
    ownerName: 'Joseph Rozenblum',
    ownerEmail: 'joseph.rozenblum@beagent.com',
    buttonLabel: 'J.R.',
    solveLabel: 'Marked solved by Joseph',
    autoApply: true
  };
  let settings = { ...DEFAULTS };

  // Hide legacy status-pair rows even if an older script injects one after this
  // extension has already created the current pair. CSS avoids mutation loops.
  const compatibilityStyle = document.createElement('style');
  compatibilityStyle.id = 'employee-macros-v95-compatibility';
  compatibilityStyle.textContent = `
    .travelor-status-split,
    .employee-awaiting-split:not(.employee-awaiting-split-v93) {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(compatibilityStyle);

  chrome.storage.sync.get(DEFAULTS).then(value => { settings = value; scan(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    document.querySelectorAll('.employee-owner-shortcut,.employee-solve-shortcut').forEach(e => e.remove());
    scan();
  });

  const text = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = e => {
    if (!e?.isConnected) return false;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };

  function activate(e) {
    if (!e) return;
    e.scrollIntoView({ block: 'nearest' });
    e.focus?.();
    const r = e.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, composed:true, view:window, button:0,
      clientX:r.left+r.width/2, clientY:r.top+r.height/2 };
    if (window.PointerEvent) e.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:1 }));
    e.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons:1 }));
    e.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons:0 }));
    if (window.PointerEvent) e.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:0 }));
    HTMLElement.prototype.click.call(e);
  }

  function waitFor(getter, timeout=10000) {
    return new Promise(resolve => {
      const end = Date.now() + timeout;
      const check = () => {
        const found = getter();
        if (found) return resolve(found);
        if (Date.now() >= end) return resolve(null);
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function openPopupFor(trigger) {
    for (const id of [trigger?.getAttribute('aria-owns'), trigger?.getAttribute('data-popover-id')]) {
      const node = id && document.getElementById(id);
      if (node) return node;
    }
    return [...document.querySelectorAll('[data-open-complete="true"], [data-floating-ui-focusable], [role="listbox"].Select-menu')]
      .filter(visible).at(-1) || null;
  }

  function findConfiguredOwner(root) {
    if (!root) return null;
    const exact = [...root.querySelectorAll('button[title]')].find(button => {
      if (button.getAttribute('title') !== settings.ownerName) return false;
      if (!settings.ownerEmail) return true;
      const option = button.closest('[role="option"]') || button.parentElement?.parentElement;
      return text(option).toLowerCase().includes(settings.ownerEmail.toLowerCase());
    });
    return exact || null;
  }

  async function selectConfiguredOwner(trigger) {
    activate(trigger);
    let owner = await waitFor(() => findConfiguredOwner(openPopupFor(trigger)), 3500);
    if (!owner) {
      activate(trigger);
      owner = await waitFor(() => findConfiguredOwner(openPopupFor(trigger)), 6500);
    }
    if (!owner) return false;
    activate(owner);
    return true;
  }

  function makeBlueButton(label, cls, title) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.className = cls; b.title = title;
    Object.assign(b.style, { display:'inline-flex', alignItems:'center', justifyContent:'center',
      padding:'7px 11px', border:'1px solid #0066cc', borderRadius:'4px', background:'#0b74de',
      color:'#fff', cursor:'pointer', fontWeight:'700', whiteSpace:'nowrap', flex:'0 0 auto' });
    b.addEventListener('mousedown', e => e.preventDefault());
    return b;
  }

  function addOwnerButton(field) {
    const trigger = field.querySelector('button[data-dropdown="true"]');
    if (!trigger || field.querySelector('.employee-owner-shortcut')) return;
    const wrapper = trigger.parentElement;
    if (!wrapper) return;
    wrapper.style.cssText += ';display:flex!important;align-items:center!important;width:100%!important';
    const b = makeBlueButton(settings.buttonLabel || 'ME', 'employee-owner-shortcut', `Select ${settings.ownerName}`);
    b.style.marginRight = '8px';
    trigger.style.flex = '1 1 auto';
    b.onclick = async e => {
      e.preventDefault(); e.stopPropagation(); b.disabled = true; const original = b.textContent; b.textContent = '...';
      const ok = await selectConfiguredOwner(trigger);
      b.textContent = ok ? 'Selected' : 'Not found';
      setTimeout(() => { b.textContent=original; b.disabled=false; }, 1200);
    };
    trigger.insertAdjacentElement('beforebegin', b);
  }

  function findStatusTrigger() {
    const knownStatuses = new Set([
      'Open', 'ON-SPOT', 'Ready for Finance Handoff', 'IATA Flights Handoff',
      'Waiting for Finance', 'Waiting IATA Flights',
      'Finance Completed - Needs Service Update', 'Awaiting Agent Reply',
      'Awaiting Supplier Reply', 'Website request received',
      'Post-Solved Reply Review', 'Document sent to Agent',
      'OPEN - REPLY FROM IATA TASK', 'Solved'
    ]);

    return [...document.querySelectorAll(
      'button[data-dropdown="true"][data-button-use="control"], ' +
      'button[data-dropdown="true"][data-transitional-component="Select"]'
    )].find(button => {
      if (!visible(button)) return false;
      const valueText = text(button);
      return knownStatuses.has(valueText) ||
        [...knownStatuses].some(status => valueText === status || valueText.endsWith(status));
    }) || null;
  }

  async function chooseSolved(trigger) {
    activate(trigger);
    let solved = await waitFor(() => openPopupFor(trigger)?.querySelector('button[title="Solved"], [data-option-value="4"] button'), 5000);
    if (!solved) return false;
    activate(solved);
    return true;
  }

  function addSolveButton(trigger) {
    if (!trigger || !trigger.isConnected) return;
    const wrapper = trigger.parentElement || trigger.closest('[data-transitional-component="Select"]');
    if (!wrapper) return;

    // Remove detached or duplicate copies, then keep exactly one beside this status selector.
    document.querySelectorAll('.employee-solve-shortcut').forEach(button => {
      if (button.parentElement !== wrapper) button.remove();
    });
    if (wrapper.querySelector('.employee-solve-shortcut')) return;

    wrapper.style.setProperty('display', 'inline-flex', 'important');
    wrapper.style.setProperty('align-items', 'center', 'important');
    const b = makeBlueButton(settings.solveLabel || 'Mark solved by me', 'employee-solve-shortcut', `Solve and assign to ${settings.ownerName}`);
    b.style.marginLeft = '8px';
    b.onclick = async () => {
      if (b.dataset.running === '1') return;
      b.dataset.running = '1'; b.disabled = true; const original = b.textContent;
      try {
        b.textContent = 'Marking solved...';
        if (!await chooseSolved(trigger)) { b.textContent = 'Solved not found'; return; }
        const form = await waitFor(() => [...document.querySelectorAll('form[data-transitional-component="Form"]')]
          .find(f => visible(f) && f.querySelector(OWNER_FIELD)), 10000);
        if (!form) { b.textContent = 'Solved'; return; }
        const ownerTrigger = form.querySelector(`${OWNER_FIELD} button[data-dropdown="true"]`);
        const selected = ownerTrigger?.querySelector('[data-option-value]');
        const currentValue = selected?.getAttribute('data-option-value') || '';
        const currentText = text(selected || ownerTrigger);
        if (!currentValue || currentText === 'No owner' || currentText === 'Unassigned') {
          b.textContent = `Selecting ${settings.ownerName}...`;
          if (!await selectConfiguredOwner(ownerTrigger)) { b.textContent = 'Owner not found'; return; }
        }
        if (settings.autoApply) {
          const apply = form.querySelector('button[type="submit"][data-button-use="primary"]');
          if (apply) {
            await waitFor(() => apply.getAttribute('aria-disabled') !== 'true' ? apply : null, 5000);
            activate(apply);
          }
        }
        b.textContent = 'Done';
      } finally {
        setTimeout(() => { b.textContent=original; b.disabled=false; b.dataset.running='0'; }, 1600);
      }
    };
    trigger.insertAdjacentElement('afterend', b);
  }

  function scan() {
    document.querySelectorAll('.travelor-status-split, .employee-awaiting-split:not(.employee-awaiting-split-v93)')
      .forEach(row => {
        row.style.setProperty('display', 'none', 'important');
        row.setAttribute('aria-hidden', 'true');
      });
    document.querySelectorAll(OWNER_FIELD).forEach(addOwnerButton);
    const status = findStatusTrigger();
    if (status) addSolveButton(status);
    document.querySelectorAll('[data-test-id="composer-editor"]').forEach(addReplyPaste);
    document.querySelectorAll('[data-test-id="email-recipients-wrapper"]').forEach(addRecipientPaste);
    document.querySelectorAll('label[data-selenium-test="metadata-subject-input"]').forEach(addSubjectPaste);
    document.querySelectorAll('[role="listbox"].Select-menu').forEach(addAwaitingSplit);
  }


  const PASTE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg>';

  function pasteButton(title, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = PASTE_ICON;
    Object.assign(button.style, {
      width:'28px', height:'28px', padding:'5px', display:'inline-flex',
      alignItems:'center', justifyContent:'center', flex:'0 0 28px', marginLeft:'6px',
      border:'1px solid #cbd6e2', borderRadius:'4px', background:'#fff',
      color:'#516f90', cursor:'pointer', boxShadow:'none'
    });
    button.addEventListener('mouseenter', () => { button.style.background='#f5f8fa'; });
    button.addEventListener('mouseleave', () => { button.style.background='#fff'; });
    button.addEventListener('mousedown', event => event.preventDefault());
    return button;
  }

  async function readClipboard() {
    try { return await navigator.clipboard.readText(); }
    catch { return ''; }
  }

  function setInputValue(input, value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertFromPaste', data:value }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
  }

  function fitBeside(container, field, button) {
    container.style.cssText += ';display:flex!important;align-items:center!important;width:100%!important;min-width:0!important;box-sizing:border-box!important';
    field.style.cssText += ';flex:1 1 0!important;max-width:calc(100% - 34px)!important;min-width:0!important;box-sizing:border-box!important';
    container.appendChild(button);
  }

  function addReplyPaste(composer) {
    if (composer.querySelector('.employee-reply-paste')) return;
    const editor = composer.querySelector('[contenteditable="true"][aria-label="Reply to conversation"]');
    const editorWrapper = editor?.closest('.remirror-editor-wrapper');
    const theme = editorWrapper?.parentElement;
    if (!editor || !editorWrapper || !theme) return;
    const row = document.createElement('div');
    theme.insertBefore(row, editorWrapper);
    row.appendChild(editorWrapper);
    const button = pasteButton('Paste into reply', 'employee-reply-paste');
    button.onclick = async () => {
      const value = await readClipboard(); if (!value) return;
      editor.focus();
      const selection=getSelection(), range=document.createRange();
      range.selectNodeContents(editor); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('insertText', false, value);
      editor.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertFromPaste', data:value }));
    };
    fitBeside(row, editorWrapper, button);
  }

  function addRecipientPaste(wrapper) {
    if (wrapper.querySelector('.employee-recipient-paste')) return;
    const field=wrapper.querySelector('[data-selenium-test="recipient-select"]');
    const input=field?.querySelector('input[role="combobox"]');
    if (!field || !input) return;
    const button=pasteButton('Paste email recipient','employee-recipient-paste');
    button.onclick=async()=>{
      const value=(await readClipboard()).trim(); if(!value)return;
      setInputValue(input,value);
      setTimeout(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true})),180);
    };
    fitBeside(field.parentElement||wrapper, field, button);
  }

  function addSubjectPaste(label) {
    if (label.querySelector('.employee-subject-paste')) return;
    const field=label.querySelector('div[aria-labelledby]');
    const input=label.querySelector('input[type="text"]');
    if (!field || !input) return;
    const button=pasteButton('Paste subject','employee-subject-paste');
    button.onclick=async()=>{const value=(await readClipboard()).trim();if(value)setInputValue(input,value);};
    fitBeside(label, field, button);
  }

  function makeNativeHalf(sample, label, target, side) {
    const half=sample.cloneNode(true);
    half.removeAttribute('id');
    half.classList.remove('is-focused');
    half.classList.add('employee-awaiting-half', side);
    half.setAttribute('role','presentation');
    half.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    half.style.cssText='width:50%!important;flex:1 1 50%!important;min-width:0!important;margin:0!important;padding:0!important;background:#fff!important;border-radius:0!important;';
    if(side==='agent') half.style.setProperty('border-right','1px solid #dfe3eb','important');
    const item=half.querySelector('[data-typeahead-item="true"]');
    if(item){item.removeAttribute('data-option-value');item.setAttribute('role','presentation');}
    const button=half.querySelector('button');
    const optionText=half.querySelector('[data-option-text="true"]');
    if(optionText) optionText.textContent=label;
    if(button){
      button.title=side==='agent'?'Set status to Awaiting Agent Reply':'Set status to Awaiting Supplier Reply';
      button.tabIndex=-1;
      button.style.cssText='width:100%!important;height:40px!important;padding:0 10px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#fff!important;border:0!important;border-radius:0!important;box-shadow:none!important;outline:none!important;color:#33475b!important;font-weight:400!important;';
      button.addEventListener('mouseenter',()=>button.style.setProperty('background','#f5f8fa','important'));
      button.addEventListener('mouseleave',()=>button.style.setProperty('background','#fff','important'));
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();activate(target);});
    }
    return half;
  }

  function addAwaitingSplit(listbox) {
    if (!listbox || !listbox.isConnected) return;

    // Hide/remove legacy rows first. An older script may add one after our row exists.
    listbox.querySelectorAll('.travelor-status-split, .employee-awaiting-split:not(.employee-awaiting-split-v93)')
      .forEach(row => {
        row.style.setProperty('display', 'none', 'important');
        row.setAttribute('aria-hidden', 'true');
      });

    const currentRows = [...listbox.querySelectorAll('.employee-awaiting-split-v93')];
    if (currentRows.length > 1) currentRows.slice(1).forEach(row => row.remove());
    if (currentRows.length >= 1) return;

    const agent = listbox.querySelector('button[title="Awaiting Agent Reply"]');
    const supplier = listbox.querySelector('button[title="Awaiting Supplier Reply"]');
    if (!agent || !supplier) return;

    const agentOption = agent.closest('.Select-option');
    const supplierOption = supplier.closest('.Select-option');
    const firstNative = [...listbox.querySelectorAll(':scope > .Select-option')]
      .find(option => option !== agentOption && option !== supplierOption && option.querySelector('button'));
    if (!firstNative) return;

    for (const original of [agentOption, supplierOption]) {
      original.classList.add('employee-hidden-awaiting-original');
      original.style.setProperty('display', 'none', 'important');
      original.setAttribute('aria-hidden', 'true');
    }

    const row = document.createElement('div');
    row.className = 'Select-option employee-awaiting-split-v93';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.style.cssText = 'display:flex!important;align-items:stretch!important;width:100%!important;height:40px!important;min-height:40px!important;padding:0!important;margin:0!important;background:#fff!important;box-sizing:border-box!important;border-radius:0!important;';
    row.append(
      makeNativeHalf(firstNative, 'A. Agent', agent, 'agent'),
      makeNativeHalf(firstNative, 'A. Supplier', supplier, 'supplier')
    );
    listbox.insertBefore(row, firstNative);
  }

  async function detectHubSpotAccount() {
    const accountButton = document.querySelector(
      'button[data-test-id="hs-global-toolbar-accounts"], #hs-global-toolbar-accounts'
    );
    if (!accountButton) {
      return { ok: false, error: 'HubSpot account button was not found.' };
    }

    activate(accountButton);

    const profile = await waitFor(() => {
      const menu = document.querySelector('#accounts-menu-content');
      if (!menu || !visible(menu)) return null;
      const link = menu.querySelector(
        '[data-test-id="nav-account-menu-user-preferences"], #userPreferences'
      );
      if (!link) return null;

      const name = link.querySelector('[class*="UserPreferences__UserName"]')?.textContent?.trim()
        || link.querySelector('img[alt]')?.getAttribute('alt')?.trim()
        || '';
      const email = link.querySelector('[class*="UserPreferences__UserEmail"]')?.textContent?.trim()
        || '';

      return name && email ? { name, email } : null;
    }, 7000);

    if (!profile) {
      return { ok: false, error: 'The account menu opened, but the name or email was not found.' };
    }

    // Close the account menu after reading it.
    activate(accountButton);
    return { ok: true, ...profile };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'detectHubSpotAccount') return;
    detectHubSpotAccount().then(sendResponse);
    return true;
  });

  // HubSpot updates many attributes while a dropdown opens. Observing attributes
  // caused a feedback loop because this extension also changes styles and ARIA
  // attributes. Observe added/removed nodes only and coalesce scans per frame.
  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  scan();
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
