/**
 * El Prospector — LinkedIn sync (EXPLORATION MODE)
 *
 * Scrapes the LinkedIn connections page and shows what it can extract,
 * WITHOUT writing anything to the backend. Used to validate selectors
 * before deploying the production version.
 *
 * Run on: https://www.linkedin.com/mynetwork/invite-connect/connections/
 */
(async function elProspectorExplore() {
  if (window.__epSyncRunning) { alert('El Prospector — sync deja en cours'); return; }
  window.__epSyncRunning = true;

  // --- Inject overlay ---
  const old = document.getElementById('ep-sync-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'ep-sync-panel';
  panel.style.cssText = [
    'position:fixed','top:80px','right:20px','z-index:2147483647',
    'width:400px','max-height:80vh','overflow:auto',
    'background:#0a0a0f','color:#fff','border:1px solid #2a2a3a',
    'border-radius:14px','padding:18px',
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif','font-size:13px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.6)','line-height:1.4'
  ].join(';');
  panel.innerHTML = '<div id="ep-status" style="color:#aaa">Initialisation...</div>';
  document.body.appendChild(panel);

  const status = panel.querySelector('#ep-status');
  const setStatus = (html) => { try { status.innerHTML = html; } catch (_) {} };

  // --- Helpers ---
  const safeClassName = (el) => {
    try {
      const c = el && el.className;
      return typeof c === 'string' ? c : (c && c.baseVal) ? c.baseVal : '';
    } catch (_) { return ''; }
  };
  const safeText = (el) => {
    try { return ((el && (el.innerText || el.textContent)) || '').trim().replace(/\s+/g, ' '); }
    catch (_) { return ''; }
  };

  // --- Wrap everything in try/catch so any error is visible ---
  try {

    // --- Guard: right page ---
    if (!/\/mynetwork\/invite-connect\/connections/.test(location.pathname)) {
      panel.innerHTML = '<div style="color:#ff8080;font-weight:bold">Mauvaise page</div>' +
        '<div style="margin-top:8px;color:#aaa">Va d\'abord sur <a href="https://www.linkedin.com/mynetwork/invite-connect/connections/" style="color:#5e9eff" target="_blank">Mes connexions</a> puis re-clique sur le favori.</div>' +
        '<button id="ep-close" style="margin-top:12px;background:#1a1a24;color:#fff;border:1px solid #2a2a3a;padding:8px 12px;border-radius:8px;cursor:pointer;width:100%">Fermer</button>';
      panel.querySelector('#ep-close').onclick = () => { panel.remove(); window.__epSyncRunning = false; };
      return;
    }

    // --- Auto-scroll to bottom (forces LinkedIn lazy-load to render everything) ---
    setStatus('Scroll en cours pour charger toutes les connexions...');
    let stable = 0, lastCount = 0, scrolls = 0;
    const MAX_SCROLLS = 300;
    const t0 = Date.now();

    while (stable < 4 && scrolls < MAX_SCROLLS && (Date.now() - t0) < 90000) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 900));

      // Click any "Show more" button if present
      try {
        const showMoreBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return /afficher plus|show more|voir plus|charger plus/.test(t);
        });
        if (showMoreBtn) showMoreBtn.click();
      } catch (_) {}

      const count = document.querySelectorAll('a[href*="/in/"]').length;
      if (count === lastCount) stable++; else stable = 0;
      lastCount = count;
      scrolls++;

      setStatus(`Scroll #${scrolls} - ${count} liens detectes (stable ${stable}/4)`);
    }

    setStatus(`Scroll termine en ${scrolls} passes. Demarrage extraction...`);
    await new Promise(r => setTimeout(r, 200));

    // --- Extract connections ---
    const profileLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const bySlug = new Map();
    let processed = 0;
    let errorsInLoop = 0;
    const extractStart = Date.now();

    for (const a of profileLinks) {
      processed++;

      // Periodic progress update (every 25 items so DOM stays responsive)
      if (processed % 25 === 0) {
        setStatus(`Extraction ${processed}/${profileLinks.length} - ${bySlug.size} uniques`);
        await new Promise(r => setTimeout(r, 0));
      }

      try {
        const rawHref = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
        const absHref = rawHref.startsWith('http') ? rawHref : (a.href || '').split('?')[0];
        const cleanHref = absHref.replace(/\/$/, '');
        const slugMatch = cleanHref.match(/\/in\/([^\/]+)/);
        if (!slugMatch) continue;
        const slug = decodeURIComponent(slugMatch[1]).toLowerCase();
        if (!slug || slug.length < 2) continue;
        if (bySlug.has(slug)) continue;

        // Walk up to find a card-like container — cap at 6 levels for safety
        let card = a;
        for (let depth = 0; depth < 6; depth++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          const tag = (card.tagName || '').toLowerCase();
          if (tag === 'li') break;
          const cn = safeClassName(card);
          if (cn && /card|connection|entity|result|lockup|row/i.test(cn)) break;
        }

        // Name: try link text first, then nearby labels
        let name = safeText(a);
        if (!name || name.length > 120 || /^view|voir le profil|message/i.test(name)) {
          let nameEl = null;
          try {
            nameEl = card.querySelector('[class*="title"] span[aria-hidden="true"], [class*="name"] span[aria-hidden="true"], .artdeco-entity-lockup__title span[aria-hidden="true"], span[aria-hidden="true"]');
          } catch (_) {}
          if (nameEl) name = safeText(nameEl);
        }
        if (name) {
          // De-duplicate weird "Jean DUPONT Jean DUPONT" pattern (LinkedIn aria duplication)
          const half = name.slice(0, name.length / 2);
          if (name === half + half) name = half.trim();
        }

        // Headline / position
        let headline = null;
        try {
          const headlineEl = card.querySelector('[class*="occupation"], [class*="subtitle"], [class*="subline"], .artdeco-entity-lockup__subtitle');
          if (headlineEl) headline = safeText(headlineEl);
        } catch (_) {}

        // Conversation URL
        let conversationUrl = null;
        try {
          const msgLink = card.querySelector('a[href*="/messaging/thread/"]');
          if (msgLink) conversationUrl = (msgLink.href || '').split('?')[0];
        } catch (_) {}

        // Connected-on date (visible in card text — e.g. "Connexion le 16 mai 2026")
        let connectedOnText = null;
        try {
          const cardText = safeText(card);
          const m = cardText.match(/Connexion le ([0-9]{1,2} [a-zûéûéàùç]+\.? [0-9]{4})/i);
          if (m) connectedOnText = m[1];
        } catch (_) {}

        bySlug.set(slug, {
          slug,
          profileUrl: cleanHref,
          name: name || null,
          headline,
          conversationUrl,
          connectedOnText
        });

      } catch (err) {
        errorsInLoop++;
        if (errorsInLoop < 3) console.error('[ElProspector] extract error:', err);
      }
    }

    const extractMs = Date.now() - extractStart;
    const connections = Array.from(bySlug.values());

    // --- Render results ---
    const diagnostics = {
      pageUrl: location.href,
      rawProfileLinks: profileLinks.length,
      uniqueProfiles: connections.length,
      withName: connections.filter(c => c.name).length,
      withHeadline: connections.filter(c => c.headline).length,
      withConversationUrl: connections.filter(c => c.conversationUrl).length,
      withConnectedOnText: connections.filter(c => c.connectedOnText).length,
      extractMs,
      errorsInLoop,
      selectorCounts: {
        'a[href*="/in/"]': document.querySelectorAll('a[href*="/in/"]').length,
        'a[href*="/messaging/thread/"]': document.querySelectorAll('a[href*="/messaging/thread/"]').length,
        'main li': document.querySelectorAll('main li').length,
        '.mn-connection-card': document.querySelectorAll('.mn-connection-card').length,
        '.artdeco-entity-lockup': document.querySelectorAll('.artdeco-entity-lockup').length,
      }
    };

    const sample = connections.slice(0, 6);
    const fullPayload = { timestamp: new Date().toISOString(), diagnostics, connections };

    panel.innerHTML = `
      <div style="font-weight:600;font-size:15px;margin-bottom:12px;display:flex;align-items:center;gap:6px">
        <span style="color:#5e9eff">EL PROSPECTOR</span>
        <span style="color:#666">- mode exploration</span>
      </div>
      <div style="background:#1a1a24;padding:14px;border-radius:10px;margin-bottom:14px;border:1px solid #2a2a3a">
        <div style="font-size:28px;font-weight:700;color:#5e9eff;line-height:1">${connections.length}</div>
        <div style="color:#aaa;margin-top:4px;font-size:12px">connexions extraites</div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#888">
          <div><span style="color:#5e9eff">${diagnostics.withName}</span> avec nom</div>
          <div><span style="color:#5e9eff">${diagnostics.withConversationUrl}</span> avec URL conv.</div>
          <div><span style="color:#5e9eff">${diagnostics.withHeadline}</span> avec headline</div>
          <div><span style="color:#5e9eff">${diagnostics.withConnectedOnText}</span> avec date</div>
          <div><span style="color:#888">${scrolls}</span> scrolls</div>
          <div><span style="color:#888">${extractMs}ms</span> extraction</div>
        </div>
      </div>

      <div style="color:#aaa;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Apercu (6 premiers)</div>
      <pre style="background:#1a1a24;padding:10px;border-radius:8px;overflow-x:auto;font-size:10px;line-height:1.5;color:#ddd;max-height:200px;border:1px solid #2a2a3a;margin:0">${JSON.stringify(sample, null, 2).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>

      <button id="ep-copy" style="background:#5e9eff;color:#fff;border:0;padding:12px 16px;border-radius:10px;font-weight:600;cursor:pointer;width:100%;margin-top:12px;font-size:13px">
        Copier tout le JSON (a envoyer a Claude)
      </button>
      <button id="ep-close" style="background:transparent;color:#aaa;border:1px solid #2a2a3a;padding:8px 16px;border-radius:8px;margin-top:8px;cursor:pointer;width:100%">
        Fermer
      </button>

      <details style="margin-top:14px">
        <summary style="cursor:pointer;color:#888;font-size:11px">Diagnostics selecteurs</summary>
        <pre style="background:#1a1a24;padding:8px;border-radius:6px;font-size:10px;margin-top:4px;color:#aaa;max-height:180px;overflow:auto">${JSON.stringify(diagnostics, null, 2)}</pre>
      </details>
    `;

    panel.querySelector('#ep-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(fullPayload, null, 2));
        const btn = panel.querySelector('#ep-copy');
        btn.textContent = 'Copie ! Colle-le a Claude';
        btn.style.background = '#10b981';
      } catch (e) {
        alert('Echec copie clipboard. Texte affiche en console (F12).');
        console.log('[ElProspector] payload:', fullPayload);
      }
    };
    panel.querySelector('#ep-close').onclick = () => {
      panel.remove();
      window.__epSyncRunning = false;
    };

  } catch (fatalErr) {
    panel.innerHTML = `
      <div style="font-weight:600;color:#ff8080;margin-bottom:8px">Erreur fatale</div>
      <div style="color:#aaa;font-size:12px;margin-bottom:8px">Le script a plante. Voici le message :</div>
      <pre style="background:#1a1a24;padding:10px;border-radius:8px;color:#ffaaaa;font-size:11px;overflow:auto;max-height:200px">${(fatalErr && fatalErr.stack ? fatalErr.stack : String(fatalErr)).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
      <button id="ep-close2" style="background:#1a1a24;color:#fff;border:1px solid #2a2a3a;padding:8px 16px;border-radius:8px;cursor:pointer;width:100%;margin-top:12px">Fermer</button>
    `;
    panel.querySelector('#ep-close2').onclick = () => { panel.remove(); window.__epSyncRunning = false; };
    console.error('[ElProspector] fatal:', fatalErr);
  } finally {
    window.__epSyncRunning = false;
  }
})();
