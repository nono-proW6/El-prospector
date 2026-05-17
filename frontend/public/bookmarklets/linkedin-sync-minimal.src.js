/**
 * El Prospector — LinkedIn sync (MINIMAL MODE)
 *
 * Pas de UI dans la page LinkedIn (zero surface d'attaque).
 * Scrape, copie le JSON dans le clipboard, montre une alert + console.log.
 *
 * Run on: https://www.linkedin.com/mynetwork/invite-connect/connections/
 */
(async function elProspectorMinimal() {
  if (window.__epSyncRunning) { alert('Sync deja en cours'); return; }
  window.__epSyncRunning = true;

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

  try {
    if (!/\/mynetwork\/invite-connect\/connections/.test(location.pathname)) {
      alert('Va d\'abord sur https://www.linkedin.com/mynetwork/invite-connect/connections/');
      return;
    }

    console.log('[ElProspector] Scroll demarre...');

    // --- Auto-scroll ---
    let stable = 0, lastCount = 0, scrolls = 0;
    const MAX_SCROLLS = 300;
    const t0 = Date.now();

    while (stable < 4 && scrolls < MAX_SCROLLS && (Date.now() - t0) < 90000) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 900));

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
      console.log(`[ElProspector] Scroll #${scrolls} - ${count} liens (stable ${stable}/4)`);
    }

    console.log('[ElProspector] Scroll fini, extraction...');

    // --- Extract ---
    const profileLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const bySlug = new Map();
    let errorsInLoop = 0;
    const extractStart = Date.now();

    for (const a of profileLinks) {
      try {
        const rawHref = (a.getAttribute('href') || '').split('?')[0].split('#')[0];
        const absHref = rawHref.startsWith('http') ? rawHref : (a.href || '').split('?')[0];
        const cleanHref = absHref.replace(/\/$/, '');
        const slugMatch = cleanHref.match(/\/in\/([^\/]+)/);
        if (!slugMatch) continue;
        const slug = decodeURIComponent(slugMatch[1]).toLowerCase();
        if (!slug || slug.length < 2) continue;
        if (bySlug.has(slug)) continue;

        // Walk up to a card-like container
        let card = a;
        for (let depth = 0; depth < 6; depth++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          const tag = (card.tagName || '').toLowerCase();
          if (tag === 'li') break;
          const cn = safeClassName(card);
          if (cn && /card|connection|entity|result|lockup|row/i.test(cn)) break;
        }

        let name = safeText(a);
        if (!name || name.length > 120 || /^view|voir le profil|message/i.test(name)) {
          let nameEl = null;
          try {
            nameEl = card.querySelector('[class*="title"] span[aria-hidden="true"], [class*="name"] span[aria-hidden="true"], .artdeco-entity-lockup__title span[aria-hidden="true"], span[aria-hidden="true"]');
          } catch (_) {}
          if (nameEl) name = safeText(nameEl);
        }
        if (name) {
          const half = name.slice(0, name.length / 2);
          if (name === half + half) name = half.trim();
        }

        let headline = null;
        try {
          const headlineEl = card.querySelector('[class*="occupation"], [class*="subtitle"], [class*="subline"], .artdeco-entity-lockup__subtitle');
          if (headlineEl) headline = safeText(headlineEl);
        } catch (_) {}

        let conversationUrl = null;
        try {
          const msgLink = card.querySelector('a[href*="/messaging/thread/"]');
          if (msgLink) conversationUrl = (msgLink.href || '').split('?')[0];
        } catch (_) {}

        let connectedOnText = null;
        try {
          const cardText = safeText(card);
          const m = cardText.match(/Connexion le ([0-9]{1,2} [a-zA-Zûéàùç\.]+ [0-9]{4})/i);
          if (m) connectedOnText = m[1];
        } catch (_) {}

        bySlug.set(slug, { slug, profileUrl: cleanHref, name: name || null, headline, conversationUrl, connectedOnText });
      } catch (err) {
        errorsInLoop++;
      }
    }

    const extractMs = Date.now() - extractStart;
    const connections = Array.from(bySlug.values());

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
      scrolls,
      selectorCounts: {
        'a[href*="/in/"]': document.querySelectorAll('a[href*="/in/"]').length,
        'a[href*="/messaging/thread/"]': document.querySelectorAll('a[href*="/messaging/thread/"]').length,
        'main li': document.querySelectorAll('main li').length,
        '.mn-connection-card': document.querySelectorAll('.mn-connection-card').length,
        '.artdeco-entity-lockup': document.querySelectorAll('.artdeco-entity-lockup').length,
      }
    };

    const fullPayload = { timestamp: new Date().toISOString(), diagnostics, connections };
    const jsonStr = JSON.stringify(fullPayload, null, 2);

    // Always log to console first (guaranteed fallback)
    console.log('[ElProspector] === RESULTAT ===');
    console.log('[ElProspector] Diagnostics:', diagnostics);
    console.log('[ElProspector] Apercu (3 premiers):', connections.slice(0, 3));
    console.log('[ElProspector] PAYLOAD COMPLET (copie ce qui suit) ↓↓↓');
    console.log(jsonStr);
    console.log('[ElProspector] ↑↑↑ FIN PAYLOAD');
    window.__epLastPayload = fullPayload;

    // Try clipboard
    let clipOk = false;
    try {
      await navigator.clipboard.writeText(jsonStr);
      clipOk = true;
    } catch (e) {
      console.warn('[ElProspector] Clipboard refuse (focus perdu ?). Le JSON est dans la console.');
    }

    alert(
      `El Prospector — sync OK\n\n` +
      `${connections.length} connexions extraites en ${scrolls} scrolls + ${extractMs}ms\n` +
      `- avec nom: ${diagnostics.withName}\n` +
      `- avec URL conversation: ${diagnostics.withConversationUrl}\n` +
      `- avec headline: ${diagnostics.withHeadline}\n` +
      `- avec date connexion: ${diagnostics.withConnectedOnText}\n\n` +
      (clipOk
        ? `JSON copie dans le presse-papier — colle-le a Claude.`
        : `Clipboard refuse — le JSON est dans la console (window.__epLastPayload).`)
    );

  } catch (fatalErr) {
    console.error('[ElProspector] FATAL:', fatalErr);
    alert('Erreur fatale: ' + (fatalErr && fatalErr.message ? fatalErr.message : String(fatalErr)) + '\n\nDetails dans la console (F12).');
  } finally {
    window.__epSyncRunning = false;
  }
})();
