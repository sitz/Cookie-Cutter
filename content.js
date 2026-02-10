/*
 * Cookie Cutter - Content Script
 *
 * Finds visible "Accept" buttons near cookie/privacy text and clicks them.
 * For multi-step CMPs (e.g. Ketch), clicks the follow-up "Save" button too.
 */

(function () {
    'use strict';

    let enabled = true;
    let accepted = false;

    const CLICKABLE = 'button, [role="button"], input[type="button"], input[type="submit"], a[href="#"], a[href="javascript:"]';

    const ACCEPT_PATTERNS = [
        /^accept(\s+all)?(\s+cookies?)?(\s*(and\s+|&\s*)?continue)?$/i,
        /^agree(\s+to\s+all)?$/i,
        /^allow(\s+all)?$/i,
        /^i\s+(agree|accept)$/i,
        /^(got\s+it|ok(ay)?|yes|continue|understood)$/i,
        /^consent$/i,
        /^yes,?\s+i'?m\s+happy$/i,
        /^that'?s\s+(ok|fine|okay)$/i,
        /^i\s+understand$/i,
        /^(enable|allow)\s+all$/i,
        // German
        /^(alle\s+)?akzeptieren$/i,
        /^(allen\s+)?zustimmen$/i,
        /^verstanden$/i,
        /^ich\s+stimme\s+zu$/i,
        /^einverstanden$/i,
        // French
        /^(tout\s+)?accepter(\s+et\s+continuer)?$/i,
        /^j'accepte$/i,
        /^compris$/i,
        /^d'accord$/i,
        // Spanish
        /^aceptar(\s+todo)?$/i,
        /^acepto$/i,
        /^de\s+acuerdo$/i,
        // Italian
        /^accetta(\s+tutto)?$/i,
        /^accetto$/i,
        // Dutch
        /^(alles\s+)?accepteren$/i,
        /^akkoord$/i,
        // Portuguese
        /^aceitar(\s+tudo)?$/i,
        /^concordo$/i,
        // Polish
        /^(zaakceptuj|zgadzam\s+się)$/i,
        // Russian
        /^(принять|согласен)$/i,
    ];

    // Multi-step CMPs (e.g. Ketch) need a follow-up save/confirm click
    const SAVE_PATTERNS = [
        /^save(\s+(choices|preferences|settings|selection))?$/i,
        /^confirm(\s+(choices|preferences|selection|my\s+choice))?$/i,
        /^submit$/i,
        /^done$/i,
        /^close$/i,
        /^(auswahl\s+)?speichern$/i,
        /^bestätigen$/i,
        /^sauvegarder$/i,
        /^confirmer$/i,
        /^opslaan$/i,
        /^bevestigen$/i,
    ];

    const EXCLUSION_PATTERNS = [
        /settings|preferences|customize|customise|manage|options/i,
        /cookie\s*settings|manage\s*cookies/i,
        /reject|decline|deny|refuse|no\s*thanks/i,
        /necessary\s*only|essential\s*only/i,
        /policy|privacy|terms|conditions|learn\s*more|read\s*more|details/i,
        /sign\s*(up|in)|log\s*(in|out)|register/i,
        /follow|subscribe|like|share|comment|reply|post/i,
        /download|install|buy|purchase|add\s*to\s*cart|checkout/i,
    ];

    const CONTEXT_WORDS = [
        'cookie', 'cookies', 'consent',
        'gdpr', 'dsgvo', 'ccpa',
        'privacy', 'tracking',
        'personalization', 'personalisation',
        'personal data', 'your data',
        'advertising', 'partners',
        'we use', 'this site uses', 'this website uses',
        'your experience', 'improve your experience',
        'asks for your consent',
    ];

    const SCROLL_LOCK_CLASSES = [
        'modal-open', 'no-scroll', 'overflow-hidden',
        'cookie-consent-active', 'gdpr-active',
        'popin-gdpr-no-scroll', 'sp-message-open',
    ];

    function isVisible(el) {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')
            return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function isHidden(el) {
        const s = getComputedStyle(el);
        return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
    }

    /* Extract all text candidates from a button: visible text, aria-label, value, title.
     * Each is tested independently so a verbose aria-label doesn't poison a short label. */
    function buttonTexts(el) {
        let visible = '';
        for (const node of el.childNodes)
            if (node.nodeType === Node.TEXT_NODE)
                visible += node.textContent;
        if (!visible.trim())
            visible = el.textContent || el.innerText || '';

        const texts = new Set();
        const v = visible.trim().toLowerCase();
        if (v) texts.add(v);

        for (const attr of ['aria-label', 'value', 'title']) {
            const val = (el.getAttribute(attr) || '').trim().toLowerCase();
            if (val) texts.add(val);
        }

        return [...texts];
    }

    /* Does any text candidate from el match any of the given patterns? */
    function elMatches(el, patterns) {
        return buttonTexts(el).some(t => t.length <= 50 && patterns.some(p => p.test(t)));
    }

    function hasContext(el) {
        let current = el.parentElement;

        for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
            const rect = current.getBoundingClientRect();
            if (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.9)
                continue;

            const text = (current.textContent || '').toLowerCase();
            if (CONTEXT_WORDS.some(w => text.includes(w)))
                return true;
        }

        return false;
    }

    function scoreButton(el) {
        if (!elMatches(el, ACCEPT_PATTERNS)) return null;
        if (elMatches(el, EXCLUSION_PATTERNS)) return null;

        let score = 50;
        if (el.tagName === 'BUTTON') score += 10;
        if (el.tagName === 'A') score -= 10;

        try {
            const bg = getComputedStyle(el).backgroundColor;
            if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)')
                score += 5;
        } catch (_) {}

        return { element: el, score };
    }

    function findAcceptButtons() {
        const candidates = [];

        for (const el of document.querySelectorAll(CLICKABLE)) {
            if (!isVisible(el)) continue;
            if (!hasContext(el)) continue;
            const c = scoreButton(el);
            if (c) candidates.push(c);
        }

        // Shadow DOM
        for (const host of document.querySelectorAll('*')) {
            if (!host.shadowRoot) continue;
            candidates.push(...findInShadow(host.shadowRoot, 0));
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates;
    }

    function findInShadow(root, depth) {
        if (depth > 2) return [];

        // Check host id/class for cookie/consent keywords (e.g. #wpconsent-container)
        const hostId = (root.host?.id || '').toLowerCase();
        const hostClass = (root.host?.className || '').toLowerCase();
        const hostMeta = hostId + ' ' + hostClass;
        const metaHit = CONTEXT_WORDS.some(w => hostMeta.includes(w));

        // Check shadow root's own text (light DOM textContent is empty for shadow-only components)
        const shadowText = (root.textContent || '').toLowerCase();
        const textHit = CONTEXT_WORDS.some(w => shadowText.includes(w));

        if (!metaHit && !textHit) return [];

        const results = [];
        for (const el of root.querySelectorAll(CLICKABLE)) {
            if (!isVisible(el)) continue;
            const c = scoreButton(el);
            if (c) { c.score = 45; results.push(c); }
        }

        for (const el of root.querySelectorAll('*'))
            if (el.shadowRoot)
                results.push(...findInShadow(el.shadowRoot, depth + 1));

        return results;
    }

    function findSaveButton() {
        for (const el of document.querySelectorAll(CLICKABLE)) {
            if (!isVisible(el)) continue;
            if (elMatches(el, SAVE_PATTERNS) && hasContext(el))
                return el;
        }
        return null;
    }

    function tryHiddenButtons() {
        for (const el of document.querySelectorAll('button, [role="button"]')) {
            if (!isHidden(el)) continue;
            if (!elMatches(el, ACCEPT_PATTERNS)) continue;
            if (elMatches(el, EXCLUSION_PATTERNS)) continue;
            if (!hasContext(el)) continue;

            el.style.cssText = 'display:inline-block!important;visibility:visible!important;opacity:1!important';
            let parent = el.parentElement;
            for (let i = 0; i < 5 && parent; i++, parent = parent.parentElement) {
                const s = getComputedStyle(parent);
                if (s.display === 'none' || s.visibility === 'hidden')
                    parent.style.cssText = 'display:block!important;visibility:visible!important';
            }

            el.click();
            return true;
        }
        return false;
    }

    function removeSourcepoint() {
        document.querySelectorAll(
            'iframe[id^="sp_message_iframe"], [class*="sp_message_container"], [id*="sp_message_container"]'
        ).forEach(el => el.remove());
    }

    function done() {
        accepted = true;

        // Restore scrolling
        for (const root of [document.documentElement, document.body]) {
            if (!root) continue;
            root.style.overflow = '';
            root.style.position = '';
            SCROLL_LOCK_CLASSES.forEach(c => root.classList.remove(c));
        }

        removeSourcepoint();

        try { chrome.runtime.sendMessage({ type: 'COOKIE_ACCEPTED' }); } catch (_) {}
    }

    function acceptCookies() {
        if (accepted || !enabled) return;

        const candidates = findAcceptButtons();
        if (candidates.length > 0) {
            candidates[0].element.click();
            waitForSaveButton();
            return;
        }

        if (tryHiddenButtons()) { done(); return; }

        // Last resort: remove cross-origin CMP iframes we can't interact with
        if (document.querySelector('iframe[id^="sp_message_iframe"]')) {
            removeSourcepoint();
            done();
        }
    }

    /*
     * Multi-step CMPs: after clicking accept, look for a save/confirm button.
     * Check immediately, then watch for DOM changes. Give up after 3s (single-step CMP).
     */
    function waitForSaveButton() {
        const immediate = findSaveButton();
        if (immediate) { immediate.click(); done(); return; }

        const obs = new MutationObserver(() => {
            const btn = findSaveButton();
            if (btn) { obs.disconnect(); btn.click(); done(); }
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true });

        // Safety: single-step CMP, no save button will ever appear
        setTimeout(() => { obs.disconnect(); if (!accepted) done(); }, 3000);
    }

    /* DOM observer: re-run acceptCookies when new elements appear (max 15s) */
    let observer = null;
    let debounce = null;

    function observe() {
        if (observer) return;
        const deadline = Date.now() + 15000;

        observer = new MutationObserver(() => {
            if (accepted || Date.now() > deadline) {
                observer.disconnect();
                observer = null;
                return;
            }
            clearTimeout(debounce);
            debounce = setTimeout(acceptCookies, 200);
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function start() {
        if (document.visibilityState === 'hidden') {
            document.addEventListener('visibilitychange', function h() {
                if (document.visibilityState === 'visible') {
                    document.removeEventListener('visibilitychange', h);
                    acceptCookies();
                    if (document.body) observe();
                }
            });
            return;
        }

        acceptCookies();
        if (document.body) observe();
        else document.addEventListener('DOMContentLoaded', () => { acceptCookies(); observe(); });
    }

    function init() {
        try {
            chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (r) => {
                if (r?.enabled === false) { enabled = false; return; }
                start();
            });
        } catch (_) {
            start();
        }
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();

    window.addEventListener('load', acceptCookies);
})();
