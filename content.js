/**
 * Cookie Cutter - Content Script
 * Automatically detects and accepts cookie consent popups
 * 
 * Uses a generalized, context-aware scoring system instead of
 * hard-coded CMP framework rules.
 */

(function () {
    'use strict';

    // ================================
    // Configuration
    // ================================

    let isEnabled = true;
    let hasAccepted = false;
    let clickCount = 0;
    const MAX_CLICKS = 1; // Only click once - be conservative

    // ================================
    // Internationalized Accept Keywords
    // Same index = same phrase across languages
    // ================================

    const ACCEPT_KEYWORDS = {
        // Index: 0=accept all, 1=accept cookies, 2=accept & continue, 3=agree to all, 
        //        4=allow all, 5=i agree, 6=i accept, 7=got it, 8=ok, 9=yes, 10=continue, 11=understood
        en: ['accept all', 'accept cookies', 'accept & continue', 'agree to all', 'allow all', 'i agree', 'i accept', 'got it', 'ok', 'yes', 'continue', 'understood'],
        de: ['alle akzeptieren', 'cookies akzeptieren', 'akzeptieren & weiter', 'allen zustimmen', 'alle zulassen', 'ich stimme zu', 'ich akzeptiere', 'verstanden', 'ok', 'ja', 'weiter', 'verstanden'],
        fr: ['tout accepter', 'accepter les cookies', 'accepter et continuer', 'accepter tout', 'tout autoriser', "j'accepte", "j'accepte", 'compris', 'ok', 'oui', 'continuer', 'compris'],
        es: ['aceptar todo', 'aceptar cookies', 'aceptar y continuar', 'aceptar todo', 'permitir todo', 'acepto', 'acepto', 'entendido', 'ok', 'sí', 'continuar', 'entendido'],
        pt: ['aceitar tudo', 'aceitar cookies', 'aceitar e continuar', 'concordar com tudo', 'permitir tudo', 'eu concordo', 'eu aceito', 'entendi', 'ok', 'sim', 'continuar', 'entendido'],
        it: ['accetta tutto', 'accetta i cookie', 'accetta e continua', 'accetta tutto', 'consenti tutto', 'accetto', 'accetto', 'capito', 'ok', 'sì', 'continua', 'capito'],
        nl: ['alles accepteren', 'cookies accepteren', 'accepteren en doorgaan', 'alles accepteren', 'alles toestaan', 'ik ga akkoord', 'ik accepteer', 'begrepen', 'ok', 'ja', 'doorgaan', 'begrepen'],
        pl: ['zaakceptuj wszystkie', 'zaakceptuj cookies', 'zaakceptuj i kontynuuj', 'zgadzam się na wszystko', 'zezwól na wszystko', 'zgadzam się', 'akceptuję', 'rozumiem', 'ok', 'tak', 'kontynuuj', 'rozumiem'],
        ru: ['принять все', 'принять cookies', 'принять и продолжить', 'согласиться со всем', 'разрешить все', 'я согласен', 'я принимаю', 'понятно', 'ок', 'да', 'продолжить', 'понятно'],
        ja: ['すべて受け入れる', 'クッキーを受け入れる', '同意して続行', 'すべてに同意', 'すべて許可', '同意する', '承諾する', '了解', 'ok', 'はい', '続行', '了解'],
        zh: ['全部接受', '接受cookies', '接受并继续', '全部同意', '全部允许', '我同意', '我接受', '知道了', '好', '是', '继续', '明白']
    };

    // Build flattened keyword list for matching
    const ALL_ACCEPT_KEYWORDS = [
        ...new Set([
            ...Object.values(ACCEPT_KEYWORDS).flat(),
            'accept', 'agree', 'allow', 'consent', 'okay'  // Single-word fallbacks
        ])
    ];

    // Exclusion keywords (do NOT click these)
    const EXCLUSION_KEYWORDS = [
        'policy', 'privacy', 'terms', 'conditions', 'learn more', 'more info',
        'settings', 'preferences', 'customize', 'customise', 'manage', 'options',
        'reject', 'decline', 'deny', 'refuse', 'necessary only', 'essential only',
        'read more', 'find out', 'details', 'about cookies', 'more information',
        'datenschutz', 'impressum', 'cookie settings', 'manage cookies',
        // Social/Auth buttons that should NEVER be clicked
        'follow', 'following', 'unfollow', 'subscribe', 'unsubscribe',
        'sign up', 'sign in', 'login', 'log in', 'log out', 'logout', 'register',
        'like', 'retweet', 'share', 'comment', 'reply', 'post', 'tweet',
        'add friend', 'connect', 'message', 'dm', 'download', 'install', 'buy', 'purchase',
        'add to cart', 'checkout', 'pay', 'donate', 'join', 'apply', 'submit'
    ];

    // Cookie-related context keywords (for scoring parent elements)
    const CONTEXT_KEYWORDS = /cookie|consent|gdpr|privacy|banner|notice|ccpa|dsgvo/i;

    // ================================
    // Mandatory Cookie Context Validation
    // A button will NEVER be clicked unless this returns true
    // ================================

    // Reject keywords for context validation
    const REJECT_BUTTON_KEYWORDS = ['reject', 'decline', 'deny', 'refuse', 'no thanks', 'ablehnen', 'refuser', 'rechazar', 'rifiuta', 'weigeren'];

    function hasCookieContextInHierarchy(element) {
        let current = element;
        let depth = 0;
        const MAX_DEPTH = 10;

        while (current && depth < MAX_DEPTH) {
            // Check class and id attributes
            const classId = ((current.className || '') + ' ' + (current.id || '')).toLowerCase();
            if (CONTEXT_KEYWORDS.test(classId)) {
                return true;
            }

            // Check aria-label and title attributes
            const ariaLabel = (current.getAttribute?.('aria-label') || '').toLowerCase();
            const title = (current.getAttribute?.('title') || '').toLowerCase();
            if (CONTEXT_KEYWORDS.test(ariaLabel) || CONTEXT_KEYWORDS.test(title)) {
                return true;
            }

            // Check text content of current element for cookie-related phrases
            // Sample the first portion of visible text where cookie notices typically appear
            const fullText = (current.innerText || '').toLowerCase();
            const textSample = fullText.slice(0, 800);
            
            // Check for cookie-related phrases in the sampled text
            // This catches banners that don't use cookie-related class/id names
            if (/cookie|consent|gdpr|privacy policy|we use cookies|this site uses|use of cookies|personalization cookies/i.test(textSample)) {
                // Validate it's a reasonably-sized container (not the entire page)
                const rect = current.getBoundingClientRect?.();
                if (rect && (rect.height < window.innerHeight * 0.7 || rect.width < window.innerWidth * 0.5)) {
                    return true;
                }
                // Also accept if total text is under 2000 chars (unlikely to be full page)
                if (fullText.length < 2000) {
                    return true;
                }
            }

            // Check for Accept/Reject button pair (strong cookie banner signal)
            // Only check if container is reasonably sized (not full page)
            const rect = current.getBoundingClientRect?.();
            if (rect && rect.width < window.innerWidth * 0.95 && rect.height < window.innerHeight * 0.6) {
                const buttons = current.querySelectorAll?.('button, [role="button"]');
                if (buttons && buttons.length >= 2 && buttons.length <= 10) {
                    let hasAccept = false;
                    let hasReject = false;

                    for (const btn of buttons) {
                        const btnText = (btn.textContent || '').toLowerCase().trim();
                        if (ALL_ACCEPT_KEYWORDS.some(kw => btnText === kw)) {
                            hasAccept = true;
                        }
                        if (REJECT_BUTTON_KEYWORDS.some(kw => btnText === kw || btnText.includes(kw))) {
                            hasReject = true;
                        }
                        if (hasAccept && hasReject) {
                            return true;
                        }
                    }
                }
            }

            current = current.parentElement;
            depth++;
        }
        return false;
    }

    // ================================
    // Fast-Path CMP Configs (Minimal)
    // Well-known frameworks with deterministic selectors
    // ================================

    const FAST_PATH_CMPS = [
        // OneTrust
        {
            name: 'OneTrust',
            detect: () => document.querySelector('#onetrust-consent-sdk, #onetrust-banner-sdk'),
            accept: () => clickIfExists('#onetrust-accept-btn-handler, .onetrust-close-btn-handler, #accept-recommended-btn-handler')
        },
        // Cookiebot
        {
            name: 'Cookiebot',
            detect: () => document.querySelector('#CybotCookiebotDialog'),
            accept: () => clickIfExists('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept, .CybotCookiebotDialogBodyButton[id*="Accept"]')
        },
        // TrustArc
        {
            name: 'TrustArc',
            detect: () => document.querySelector('.truste_box_overlay, #truste-consent-track, .trustarc-banner-container'),
            accept: () => clickIfExists('.truste_acceptButton, #truste-consent-button, .trustarc-agree-btn, a[class*="acceptAll"]')
        },
        // CookieYes
        {
            name: 'CookieYes',
            detect: () => document.querySelector('.cky-consent-container, .cky-consent-bar'),
            accept: () => clickIfExists('.cky-btn-accept, [data-cky-tag="accept-button"]')
        },
        // iubenda
        {
            name: 'iubenda',
            detect: () => document.querySelector('#iubenda-cs-banner'),
            accept: () => clickIfExists('.iubenda-cs-accept-btn, #iubenda-cs-accept-btn')
        },
        // Usercentrics
        {
            name: 'Usercentrics',
            detect: () => document.querySelector('#usercentrics-root'),
            accept: () => {
                const root = document.querySelector('#usercentrics-root');
                if (root?.shadowRoot) {
                    const btn = root.shadowRoot.querySelector('[data-testid="uc-accept-all-button"], button[class*="accept"]');
                    if (btn) { btn.click(); return true; }
                }
                return false;
            }
        },
        // Quantcast Choice
        {
            name: 'Quantcast',
            detect: () => document.querySelector('.qc-cmp2-container, .qc-cmp-ui-container'),
            accept: () => clickIfExists('.qc-cmp2-summary-buttons button[mode="primary"], .qc-cmp2-button[mode="primary"], .qc-cmp-button[mode="primary"]')
        },
        // Didomi
        {
            name: 'Didomi',
            detect: () => document.querySelector('#didomi-popup, #didomi-host'),
            accept: () => clickIfExists('#didomi-notice-agree-button, [id*="didomi"][id*="agree"], .didomi-continue-without-agreeing')
        },
        // Osano
        {
            name: 'Osano',
            detect: () => document.querySelector('.osano-cm-window, .osano-cm-dialog'),
            accept: () => clickIfExists('.osano-cm-accept-all, .osano-cm-accept')
        },
        // Klaro
        {
            name: 'Klaro',
            detect: () => document.querySelector('.klaro .cookie-notice, .klaro .cookie-modal'),
            accept: () => clickIfExists('.klaro .cm-btn-accept-all, .klaro .cm-btn-accept, .klaro button[class*="accept"]')
        },
        // Termly
        {
            name: 'Termly',
            detect: () => document.querySelector('#termly-code-snippet-support, .termly-consent-banner'),
            accept: () => clickIfExists('[data-tid="accept-all"], .t-acceptAllButton, button[class*="termly"][class*="accept"]')
        },
        // Complianz
        {
            name: 'Complianz',
            detect: () => document.querySelector('#cmplz-cookiebanner-container, .cmplz-cookiebanner'),
            accept: () => clickIfExists('.cmplz-accept, .cmplz-btn.cmplz-accept-all, button.cmplz-accept')
        },
        // Cookie Script
        {
            name: 'CookieScript',
            detect: () => document.querySelector('#cookiescript_injected'),
            accept: () => clickIfExists('#cookiescript_accept, .cookiescript_accept')
        },
        // CIVIC Cookie Control
        {
            name: 'CIVIC',
            detect: () => document.querySelector('#ccc, #catapult-cookie-bar'),
            accept: () => clickIfExists('#ccc-recommended-settings, .ccc-accept-button, #catapultCookie')
        },
        // Borlabs Cookie (WordPress)
        {
            name: 'Borlabs',
            detect: () => document.querySelector('#BorlabsCookieBox'),
            accept: () => clickIfExists('a[data-borlabs-cookie-accept-all], ._brlbs-btn-accept-all')
        },
        // Cookie Notice for GDPR
        {
            name: 'CookieNotice',
            detect: () => document.querySelector('#cookie-notice, #cookie-law-info-bar'),
            accept: () => clickIfExists('#cn-accept-cookie, #cookie_action_close_header, .cn-set-cookie')
        },
        // GDPR Cookie Consent
        {
            name: 'GDPRCookieConsent',
            detect: () => document.querySelector('.gdpr-cookie-notice, #moove_gdpr_cookie_info_bar'),
            accept: () => clickIfExists('.gdpr-cookie-notice-accept, #moove_gdpr_cookie_accept')
        },
        // Axeptio
        {
            name: 'Axeptio',
            detect: () => document.querySelector('#axeptio_overlay, [class*="axeptio"]'),
            accept: () => clickIfExists('[class*="axeptio"][class*="accept"], button[class*="Axeptio"]')
        },
        // Sirdata
        {
            name: 'Sirdata',
            detect: () => document.querySelector('#sd-cmp, .sd-cmp-banner'),
            accept: () => clickIfExists('#sd-cmp-accept-all, .sd-cmp-accept')
        },
        // Commanders Act
        {
            name: 'CommandersAct',
            detect: () => document.querySelector('#privacy-banner, [id*="commanders"]'),
            accept: () => clickIfExists('#privacy-accept, [id*="commanders"][id*="accept"]')
        },

        // WordPress.com CMP (consent management platform in iframes)
        {
            name: 'WordPress.com CMP',
            detect: () => document.querySelector('.cmp__notice'),
            accept: () => clickIfExists('.cmp-components-button.is-primary, .cmp__agree-button, button.cmp-components-button[class*="primary"]')
        },
        // Sourcepoint (used by Guardian, BBC, etc.)
        {
            name: 'Sourcepoint',
            detect: () => document.querySelector('[class*="sp_message_container"], .message-component'),
            accept: () => clickIfExists('button[title="Accept all"], button[title="Accept"], [class*="sp_choice_type_11"]')
        },
        // HubSpot Cookie Banner
        {
            name: 'HubSpot',
            detect: () => document.querySelector('#hs-eu-cookie-confirmation'),
            accept: () => clickIfExists('#hs-eu-confirmation-button')
        },

        // Cookie Control (Silktide)
        {
            name: 'Silktide',
            detect: () => document.querySelector('#ccc-notify, .ccc-notify'),
            accept: () => clickIfExists('.ccc-notify-button, #ccc-notify-accept')
        }
    ];

    function clickIfExists(selector) {
        const el = document.querySelector(selector);
        if (el) { el.click(); return true; }
        return false;
    }

    // ================================
    // Helper Functions
    // ================================

    function log(message, ...args) {
        // console.log(`[Cookie Cutter] ${message}`, ...args);
    }

    function isVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getElementText(el) {
        return (el.textContent || el.value || el.innerText || '').toLowerCase().trim();
    }

    function getElementContext(el) {
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        return getElementText(el) + ' ' + ariaLabel + ' ' + title;
    }

    // ================================
    // Banner Discovery
    // ================================

    // Reject keywords for button-pair detection
    const REJECT_KEYWORDS = ['reject', 'decline', 'deny', 'refuse', 'no thanks', 'no, thanks', 'ablehnen', 'refuser', 'rechazar', 'rifiuta', 'weigeren'];

    /**
     * Check if a container has both Accept and Reject buttons (strong cookie banner signal)
     */
    function hasAcceptRejectButtonPair(container) {
        const buttons = container.querySelectorAll('button, [role="button"], a');
        let hasAccept = false;
        let hasReject = false;

        for (const btn of buttons) {
            if (!isVisible(btn)) continue;
            const text = getElementText(btn);

            // Check for accept-like text
            if (ALL_ACCEPT_KEYWORDS.some(kw => text === kw || text.startsWith(kw))) {
                hasAccept = true;
            }
            // Check for reject-like text
            if (REJECT_KEYWORDS.some(kw => text === kw || text.includes(kw))) {
                hasReject = true;
            }

            if (hasAccept && hasReject) return true;
        }
        return false;
    }

    function findCookieBanners() {
        const candidates = [];
        const checked = new Set();

        // Strategy 1: Direct class/id matching
        const directMatches = document.querySelectorAll(
            '[class*="cookie" i], [class*="consent" i], [class*="gdpr" i], [class*="privacy-banner" i], ' +
            '[id*="cookie" i], [id*="consent" i], [id*="gdpr" i], ' +
            '[aria-label*="cookie" i], [aria-label*="consent" i]'
        );

        for (const el of directMatches) {
            if (isVisible(el) && !checked.has(el)) {
                candidates.push({ element: el, score: 20, reason: 'direct-match' });
                checked.add(el);
            }
        }

        // Strategy 2: Fixed/sticky positioned elements at viewport edges
        const allElements = document.querySelectorAll('div, aside, section, footer, header, span');
        for (const el of allElements) {
            if (checked.has(el)) continue;

            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            const isFixed = style.position === 'fixed' || style.position === 'sticky';
            const isAtEdge = rect.top < 150 || rect.bottom > window.innerHeight - 150;

            if (isFixed && isAtEdge && (hasCookieContent(el) || hasAcceptRejectButtonPair(el))) {
                candidates.push({ element: el, score: 15, reason: 'visual-heuristic' });
                checked.add(el);
            }
        }

        // Strategy 3: Modal dialogs (including native <dialog> element)
        const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, .overlay, dialog');
        for (const el of dialogs) {
            if (checked.has(el)) continue;
            if (isVisible(el) && (hasCookieContent(el) || hasAcceptRejectButtonPair(el))) {
                candidates.push({ element: el, score: 15, reason: 'dialog' });
                checked.add(el);
            }
        }

        // Strategy 4: Shadow DOM traversal (with protection)
        const shadowHosts = document.querySelectorAll('*');
        for (const host of shadowHosts) {
            if (host.shadowRoot && !checked.has(host)) {
                const shadowBanners = findBannersInShadow(host.shadowRoot, 0);
                for (const banner of shadowBanners) {
                    candidates.push({ element: banner.element, score: banner.score, reason: 'shadow-dom' });
                }
            }
        }

        // Strategy 5: Toast/notification/snackbar containers
        // These are common UI patterns for cookie banners that may not use "cookie" in class names
        const toastPatterns = document.querySelectorAll(
            '[class*="toast" i], [class*="notification" i], [class*="snackbar" i], ' +
            '[class*="banner" i], [class*="alert" i]:not([role="alert"]), [class*="popup" i]'
        );
        for (const el of toastPatterns) {
            if (checked.has(el)) continue;
            // Only add if it has Accept/Reject button pair (strong cookie signal)
            if (isVisible(el) && hasAcceptRejectButtonPair(el)) {
                candidates.push({ element: el, score: 25, reason: 'toast-with-buttons' });
                checked.add(el);
            }
        }

        // Strategy 6: Button-pair heuristic - find any visible container with Accept+Reject
        // This catches custom implementations without standard naming
        const potentialContainers = document.querySelectorAll('div, section, aside, footer');
        for (const el of potentialContainers) {
            if (checked.has(el)) continue;

            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            // Must be fixed/sticky or at viewport edges, and contain button pair
            const isPositioned = style.position === 'fixed' || style.position === 'sticky';
            const isOverlay = parseInt(style.zIndex) > 100;

            if ((isPositioned || isOverlay) && isVisible(el) && hasAcceptRejectButtonPair(el)) {
                // Extra validation: container should be reasonably sized (not full page)
                const isReasonableSize = rect.width < window.innerWidth * 0.95 || rect.height < window.innerHeight * 0.5;
                if (isReasonableSize) {
                    candidates.push({ element: el, score: 20, reason: 'button-pair-heuristic' });
                    checked.add(el);
                }
            }
        }

        return candidates;
    }

    function findBannersInShadow(shadowRoot, depth) {
        if (depth > 3) return []; // Prevent deep recursion

        const banners = [];
        const elements = shadowRoot.querySelectorAll('*');

        for (const el of elements) {
            const classId = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
            if (CONTEXT_KEYWORDS.test(classId) && isVisible(el)) {
                banners.push({ element: el, score: 15 });
            }

            // Recurse into nested shadow roots
            if (el.shadowRoot) {
                banners.push(...findBannersInShadow(el.shadowRoot, depth + 1));
            }
        }

        return banners;
    }

    function hasCookieContent(el) {
        const text = (el.innerText || '').toLowerCase();
        return CONTEXT_KEYWORDS.test(text);
    }

    // ================================
    // Button Scoring System
    // ================================

    function scoreButton(btn, containerScore = 0) {
        let score = containerScore;

        const text = getElementContext(btn);

        // Early exit: Exclusion keywords
        if (EXCLUSION_KEYWORDS.some(kw => text.includes(kw))) {
            return -100;
        }

        // Check href for policy links
        if (btn.tagName === 'A') {
            const href = (btn.getAttribute('href') || '').toLowerCase();
            if (EXCLUSION_KEYWORDS.some(kw => href.includes(kw))) {
                return -100;
            }
        }

        // Accept keyword matching
        const buttonText = getElementText(btn);

        // Exact match (highest score)
        if (ALL_ACCEPT_KEYWORDS.some(kw => buttonText === kw)) {
            score += 60;
        }
        // Starts with accept keyword
        else if (ALL_ACCEPT_KEYWORDS.some(kw => buttonText.startsWith(kw))) {
            score += 50;
        }
        // Contains accept keyword
        else if (ALL_ACCEPT_KEYWORDS.some(kw => buttonText.includes(kw))) {
            score += 40;
        }

        // Element type scoring
        const tag = btn.tagName.toLowerCase();
        if (tag === 'button') {
            score += 15;
        } else if (tag === 'input' && ['button', 'submit'].includes(btn.type)) {
            score += 15;
        } else if (tag === 'a') {
            score -= 10; // Links are riskier
        }

        // Visual emphasis (filled background = primary button)
        try {
            const style = getComputedStyle(btn);
            const bg = style.backgroundColor;
            const isPrimary = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)';
            if (isPrimary) score += 10;
        } catch (e) { /* ignore */ }

        // Context scoring: check parent hierarchy
        let parent = btn.parentElement;
        for (let i = 0; i < 6 && parent; i++) {
            const classId = ((parent.className || '') + ' ' + (parent.id || '')).toLowerCase();
            if (CONTEXT_KEYWORDS.test(classId)) {
                score += 25 - (i * 3); // Closer parents score higher
                break;
            }
            parent = parent.parentElement;
        }

        return score;
    }

    function findBestButton(container) {
        const buttons = container.querySelectorAll(
            'button, [role="button"], input[type="button"], input[type="submit"], a'
        );

        let bestScore = 0;
        let bestButton = null;

        for (const btn of buttons) {
            if (!isVisible(btn)) continue;

            const score = scoreButton(btn, 0);
            log(`Button "${getElementText(btn)}" score: ${score}`);

            if (score > bestScore) {
                bestScore = score;
                bestButton = btn;
            }
        }

        return { button: bestButton, score: bestScore };
    }

    // ================================
    // Main Accept Logic
    // ================================

    function tryFastPath() {
        for (const cmp of FAST_PATH_CMPS) {
            try {
                if (cmp.detect()) {
                    log(`Fast-path: Detected ${cmp.name}`);
                    if (cmp.accept()) {
                        log(`Fast-path: Accepted ${cmp.name}`);
                        return true;
                    }
                }
            } catch (e) {
                log(`Fast-path error with ${cmp.name}:`, e);
            }
        }
        return false;
    }

    function tryGeneralizedAccept() {
        const banners = findCookieBanners();
        log(`Found ${banners.length} cookie banner candidates`);

        let globalBestScore = 0;
        let globalBestButton = null;

        for (const banner of banners) {
            const { button, score } = findBestButton(banner.element);
            const totalScore = score + banner.score;

            if (totalScore > globalBestScore) {
                globalBestScore = totalScore;
                globalBestButton = button;
            }
        }

        // Minimum threshold to click (raised for safety)
        const THRESHOLD = 50;

        if (globalBestScore >= THRESHOLD && globalBestButton) {
            // CRITICAL: Never click unless cookie context is confirmed in DOM hierarchy
            if (!hasCookieContextInHierarchy(globalBestButton)) {
                log(`REJECTED: No cookie context in hierarchy for "${getElementText(globalBestButton)}"`);
                return false;
            }

            log(`Clicking button with score ${globalBestScore}: "${getElementText(globalBestButton)}"`);
            globalBestButton.click();
            clickCount++;
            return true;
        }

        log(`No button met threshold (best: ${globalBestScore})`);
        return false;
    }

    function removeScrollLocks() {
        const html = document.documentElement;
        const body = document.body;

        if (html) {
            html.style.overflow = '';
            html.classList.remove('cookie-consent-active', 'modal-open', 'no-scroll');
        }

        if (body) {
            body.style.overflow = '';
            body.style.position = '';
            body.classList.remove('cookie-consent-active', 'modal-open', 'no-scroll', 'overflow-hidden');
        }
    }

    function notifyBackground() {
        try {
            chrome.runtime.sendMessage({ type: 'COOKIE_ACCEPTED' });
        } catch (e) { /* Extension context may be invalidated */ }
    }

    function acceptCookies() {
        if (hasAccepted || !isEnabled || clickCount >= MAX_CLICKS) return;

        // Try fast-path CMPs first
        if (tryFastPath()) {
            hasAccepted = true;
            removeScrollLocks();
            notifyBackground();
            return;
        }

        // Fall back to generalized detection
        if (tryGeneralizedAccept()) {
            // Don't set hasAccepted yet - verify banner is gone
            setTimeout(() => {
                const banners = findCookieBanners();
                if (banners.length === 0 || clickCount >= MAX_CLICKS) {
                    hasAccepted = true;
                    removeScrollLocks();
                    notifyBackground();
                }
            }, 500);
            return;
        }

        // Last resort: try to find hidden buttons in dialogs with cookie content
        if (tryHiddenDialogButtons()) {
            hasAccepted = true;
            removeScrollLocks();
            notifyBackground();
            return;
        }

        removeScrollLocks();
    }

    /**
     * Last-resort handler for sites that hide cookie accept buttons via CSS.
     * Some sites (like Teamtailor-based career pages) have cookie dialogs where
     * the buttons are explicitly hidden with display:none or visibility:hidden.
     * This function finds such dialogs, forces buttons visible, and clicks them.
     */
    function tryHiddenDialogButtons() {
        // Find all dialog-like elements
        const dialogContainers = document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]');
        
        for (const dialog of dialogContainers) {
            // Check if dialog contains cookie-related content
            const text = (dialog.innerText || '').toLowerCase();
            if (!/cookie|consent|gdpr|privacy|we use|this site uses/i.test(text)) {
                continue;
            }
            
            log('Found dialog with cookie content, checking for hidden buttons');
            
            // Find all buttons in this dialog, including hidden ones
            const buttons = dialog.querySelectorAll('button, [role="button"]');
            
            for (const btn of buttons) {
                // Get button text even if hidden (textContent works on hidden elements)
                const btnText = (btn.textContent || '').toLowerCase().trim();
                
                // Check if this looks like an accept button
                if (!ALL_ACCEPT_KEYWORDS.some(kw => btnText.includes(kw))) {
                    continue;
                }
                
                // Check if button is excluded
                if (EXCLUSION_KEYWORDS.some(kw => btnText.includes(kw))) {
                    continue;
                }
                
                // Check if button is hidden
                const style = getComputedStyle(btn);
                const isHidden = style.display === 'none' || 
                                 style.visibility === 'hidden' || 
                                 style.opacity === '0' ||
                                 btn.offsetParent === null;
                
                if (isHidden) {
                    log(`Found hidden accept button: "${btnText}", forcing visible`);
                    
                    // Force the button visible
                    btn.style.cssText = 'display: inline-block !important; visibility: visible !important; opacity: 1 !important;';
                    
                    // Also force parent elements visible up to the dialog
                    let parent = btn.parentElement;
                    while (parent && parent !== dialog) {
                        const parentStyle = getComputedStyle(parent);
                        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') {
                            parent.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
                        }
                        parent = parent.parentElement;
                    }
                    
                    // Now click it
                    try {
                        btn.click();
                        clickCount++;
                        log('Clicked previously-hidden accept button');
                        return true;
                    } catch (e) {
                        log('Failed to click hidden button:', e);
                    }
                } else {
                    // Button is visible, just click it
                    btn.click();
                    clickCount++;
                    return true;
                }
            }
        }
        
        return false;
    }

    // ================================
    // Mutation Observer
    // ================================

    let observer = null;
    let debounceTimer = null;

    function setupObserver() {
        if (observer) return;

        observer = new MutationObserver(() => {
            if (hasAccepted || clickCount >= MAX_CLICKS) {
                observer.disconnect();
                return;
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(acceptCookies, 150);
        });

        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true
        });

        // Auto-disconnect after 15 seconds
        setTimeout(() => {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }, 15000);
    }

    // ================================
    // Initialization
    // ================================

    function init() {
        try {
            chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
                if (response?.enabled === false) {
                    isEnabled = false;
                    return;
                }
                runAcceptance();
            });
        } catch (e) {
            runAcceptance();
        }
    }

    function runAcceptance() {
        // If the tab is hidden (opened in background via Ctrl+click), wait for it to become visible
        if (document.visibilityState === 'hidden') {
            log('Tab is hidden, waiting for visibility change...');
            const onVisibilityChange = () => {
                if (document.visibilityState === 'visible') {
                    document.removeEventListener('visibilitychange', onVisibilityChange);
                    log('Tab became visible, running acceptance...');
                    runAcceptanceDelayed();
                }
            };
            document.addEventListener('visibilitychange', onVisibilityChange);
            return;
        }

        runAcceptanceDelayed();
    }

    function runAcceptanceDelayed() {
        // Wait for page to stabilize
        setTimeout(acceptCookies, 300);
        setTimeout(acceptCookies, 800);
        setTimeout(acceptCookies, 1500);
        setTimeout(acceptCookies, 3000);

        if (document.body) {
            setupObserver();
        } else {
            document.addEventListener('DOMContentLoaded', setupObserver);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('load', () => {
        setTimeout(acceptCookies, 500);
    });

})();
