// pageWrapGate.js
// Shared page-wrap reveal gate.
//
// Assumption:
// - Pages that need gating mark the wrapper as `.page-wrap.is-hidden` server-side.
// - CSS handles the hide, e.g. `.page-wrap.is-hidden { opacity: 0; }`.
//
// This util only reveals by removing `.is-hidden`.

import { createLogger } from "./debug.js";

const HIDDEN_CLASS = "is-hidden";
let revealed = false;

const { DEBUG, log, trace } = createLogger("pageWrapGate");

function attemptReveal() {
    try {
        const wraps = Array.from(document.querySelectorAll(`.page-wrap.${HIDDEN_CLASS}`));
        log("attemptReveal", { count: wraps.length, alreadyRevealed: revealed });
        if (!wraps.length) return false;
        wraps.forEach((el) => el.classList.remove(HIDDEN_CLASS));
        revealed = true;
        log("revealed", { count: wraps.length });
        return true;
    } catch {
        return false;
    }
}

function reveal() {
    log("reveal() called", { revealed });
    if (DEBUG) trace("reveal() stack");

    if (revealed) return;

    const ok = attemptReveal();
    if (!ok) {
        log("reveal(): no-op (no .page-wrap.is-hidden found)");
    }
}

export function init() {
    // Mount the API for consistent access: window.sitekit.pageWrapGate
    window.sitekit = window.sitekit || {};
    if (!window.sitekit.pageWrapGate) {
        window.sitekit.pageWrapGate = api;
    }

    log("init");
}

export const api = {
    reveal
};
