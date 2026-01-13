import { createLogger } from "../utils/debug.js";

const { log, warn } = createLogger("ambientSound");

const CONFIG = {
    fadeInSec: 1.8,
    fadeOutSec: 0.6,
    crossfadeSec: 1.5,
    targetVol: 1.0,
    // Global multiplier applied to `targetVol`.
    // Set to 0.8 to reduce volume by 20%.
    volumeMultiplier: 0.6,
};

let instance = null;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function initOne(root) {
    if (instance) return instance;

    const toggleInput = root.querySelector("input[type='checkbox']");
    const textOnEls = Array.from(root.querySelectorAll('[data-audio-text="on"]'));
    const textOffEls = Array.from(root.querySelectorAll('[data-audio-text="off"]'));

    const defaultUrl = root.dataset.audioUrl || root.getAttribute("data-audio-url");
    const altUrl = root.dataset.audioUrl2 || root.getAttribute("data-audio-url-2");
    const label =
        root.dataset.audioLabel || root.getAttribute("data-audio-label") || "Toggle sound";

    // Optional per-instance override: <... data-audio-volume-multiplier="0.8">
    const volumeMulAttr =
        root.dataset.audioVolumeMultiplier || root.getAttribute("data-audio-volume-multiplier");
    const volumeMulNum = volumeMulAttr == null ? NaN : Number(volumeMulAttr);
    const volumeMultiplier = Number.isFinite(volumeMulNum)
        ? clamp01(volumeMulNum)
        : CONFIG.volumeMultiplier;
    const effectiveTargetVol = clamp01(CONFIG.targetVol * volumeMultiplier);

    if (!defaultUrl) return;

    root.style.cursor = "pointer";
    root.style.touchAction = "manipulation";
    root.style.webkitTapHighlightColor = "transparent";
    root.setAttribute("role", "button");
    root.setAttribute("aria-label", label);
    root.tabIndex = 0;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        warn("Web Audio API not supported in this browser.");
        return;
    }

    // ---- audio (lazy init) ----
    let ctx = null;
    let gains = null; // [GainNode, GainNode]
    let sources = [null, null]; // [AudioBufferSourceNode|null, ...]
    const buffers = new Map(); // url -> Promise<AudioBuffer>

    let activeSlot = 0;

    // ---- state ----
    let isOn = false;        // sources started (audio keeps playing)
    let desiredOn = false;   // UI intent (audible vs muted)
    let hasEverStarted = false;
    let autoTriggerUsed = false;
    let ignoreNextInputChange = false;
    let currentUrl = defaultUrl;

    let primed = false;
    let preloadStarted = false;

    let wasOnBeforeHide = false;
    let scrollMuted = false;
    let wasMutedByScroll = false;

    let startPromise = null;
    const cleanupFns = [];

    // ---------- UI ----------
    function setUILabel() {
        // Drive UI off intent so it updates instantly on click
        const uiOn = desiredOn;

        root.setAttribute("aria-pressed", uiOn ? "true" : "false");

        // checked === muted (CSS uses :checked to show muted bars)
        if (toggleInput) toggleInput.checked = !uiOn;

        const onOpacity = uiOn ? 1 : 0;
        const offOpacity = uiOn ? 0 : 1;

        for (const el of textOnEls) {
            el.style.opacity = onOpacity;
            el.style.transition ||= "opacity 0.35s ease";
            el.textContent = "SOUND ON";
            el.setAttribute("aria-hidden", uiOn ? "false" : "true");
        }

        for (const el of textOffEls) {
            el.style.opacity = offOpacity;
            el.style.transition ||= "opacity 0.35s ease";
            el.textContent = "SOUND OFF";
            el.setAttribute("aria-hidden", uiOn ? "true" : "false");
        }
    }

    // ---------- audio graph ----------
    function initAudioGraph() {
        if (ctx) return;
        ctx = new AudioCtx();
        gains = [ctx.createGain(), ctx.createGain()];
        for (const g of gains) {
            g.gain.value = 0;
            g.connect(ctx.destination);
        }
    }

    // Must be synchronous in a user gesture
    function unlockAudioFromGesture() {
        if (!ctx) return;
        try {
            const buf = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
            src.stop(0);
        } catch { }
    }

    function primeAudioOnce() {
        if (primed) return;
        primed = true;

        initAudioGraph();
        try { ctx.resume(); } catch { }

        unlockAudioFromGesture();
        startPreload();
    }

    function fadeGain(gainNode, to, sec) {
        if (!ctx || !gainNode) return;

        const g = gainNode.gain;
        const target = clamp01(to);

        // We intentionally avoid AudioParam automation (linearRampToValueAtTime), because
        // canceling/reversing ramps quickly can "jump" to the param's last set value
        // in some browsers (commonly noticed when scrolling in/out rapidly).
        //
        // Instead, drive fades with rAF + direct value assignment so the "from" value
        // is always the true current value we last applied.

        if (!fadeGain._state) fadeGain._state = new WeakMap();
        const state = fadeGain._state;

        const prev = state.get(gainNode);
        if (prev?.rafId) cancelAnimationFrame(prev.rafId);

        // Clear any leftover automation from older code paths.
        try {
            const now = ctx.currentTime;
            if (typeof g.cancelAndHoldAtTime === "function") g.cancelAndHoldAtTime(now);
            else g.cancelScheduledValues(now);
        } catch { }

        const from = clamp01(g.value);
        const durationMs = Math.max(0.001, sec) * 1000;

        if (durationMs <= 20) {
            g.value = target;
            state.set(gainNode, { rafId: 0 });
            return;
        }

        const startMs = performance.now();
        const tick = (nowMs) => {
            const t = Math.min(1, (nowMs - startMs) / durationMs);
            g.value = from + (target - from) * t;

            if (t >= 1) {
                state.set(gainNode, { rafId: 0 });
                return;
            }

            const rafId = requestAnimationFrame(tick);
            state.set(gainNode, { rafId });
        };

        const rafId = requestAnimationFrame(tick);
        state.set(gainNode, { rafId });
    }

    async function ensureAudioRunning() {
        if (!ctx) return false;
        if (ctx.state === "running") return true;

        try {
            await ctx.resume();
        } catch (e) {
            log("audio:resume-blocked", { state: ctx.state, err: String(e) });
            return false;
        }

        return ctx.state === "running";
    }

    async function loadBuffer(url) {
        if (!ctx) throw new Error("Audio context not initialized");
        if (buffers.has(url)) return buffers.get(url);

        const p = fetch(url, { mode: "cors" })
            .then((r) => {
                if (!r.ok) throw new Error(`Fetch failed (${r.status}) for ${url}`);
                return r.arrayBuffer();
            })
            .then((ab) =>
                ctx.decodeAudioData(ab).catch((e) => {
                    warn("decodeAudioData failed", { url, err: String(e) });
                    throw e;
                })
            );

        buffers.set(url, p);
        return p;
    }

    function startPreload() {
        if (preloadStarted || !ctx) return;
        const urls = [defaultUrl, altUrl].filter(Boolean);
        if (!urls.length) return;

        preloadStarted = true;
        Promise.all(urls.map(loadBuffer)).catch((err) => warn("preload:failed", err));
    }

    function stopSlotNow(slot) {
        const s = sources[slot];
        if (!s) return;
        try { s.stop(0); } catch { }
        try { s.disconnect(); } catch { }
        sources[slot] = null;
    }

    function scheduleStopSlot(slot, sec) {
        const s = sources[slot];
        if (!s || !ctx) return;

        const stopAt = ctx.currentTime + Math.max(0.05, sec) + 0.02;

        // Ensure cleanup even if stop throws
        const cleanup = () => {
            try { s.disconnect(); } catch { }
            if (sources[slot] === s) sources[slot] = null;
        };

        try {
            s.onended = cleanup;
            s.stop(stopAt);
        } catch {
            // fallback: immediate cleanup
            cleanup();
        }
    }

    function playInSlot(slot, buffer) {
        if (!ctx || !gains) return;

        // hard-stop anything already in this slot
        stopSlotNow(slot);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gains[slot]);
        src.start(0);

        sources[slot] = src;
    }

    // ---------- controls ----------
    async function turnOn({ fadeSec = CONFIG.fadeInSec } = {}) {
        if (startPromise) return startPromise;

        primeAudioOnce();

        // immediate UI intent
        desiredOn = true;
        setUILabel();

        if (!ctx || !gains) return;

        const targetVol = scrollMuted || document.hidden ? 0 : effectiveTargetVol;
        if (scrollMuted) wasMutedByScroll = true;

        if (isOn && sources[activeSlot]) {
            fadeGain(gains[activeSlot], targetVol, fadeSec);
            return;
        }

        startPromise = (async () => {
            const ok = await ensureAudioRunning();
            if (!ok) {
                // revert UI if blocked
                desiredOn = false;
                isOn = false;
                setUILabel();
                return;
            }

            isOn = true;

            let buffer;
            try {
                buffer = await loadBuffer(currentUrl || defaultUrl);
            } catch (err) {
                warn("audio failed to load/decode", err);
                desiredOn = false;
                isOn = false;
                setUILabel();
                return;
            }

            // Ensure gain starts at 0 for a proper fade-in
            gains[activeSlot].gain.value = 0;

            playInSlot(activeSlot, buffer);
            hasEverStarted = true;

            fadeGain(gains[activeSlot], targetVol, fadeSec);
            fadeGain(gains[1 - activeSlot], 0, 0.15);
        })();

        try {
            await startPromise;
        } finally {
            startPromise = null;
        }
    }

    function turnOff({ fadeSec = CONFIG.fadeOutSec, keepDesired = false } = {}) {
        // immediate UI intent
        desiredOn = keepDesired ? desiredOn : false;
        setUILabel();

        if (!ctx || !gains) {
            stopSlotNow(0);
            stopSlotNow(1);
            return;
        }

        // If the document is hidden, rAF may be throttled/paused; ensure we mute immediately.
        if (document.hidden) {
            gains[0].gain.value = 0;
            gains[1].gain.value = 0;
            return;
        }

        // fade first
        fadeGain(gains[0], 0, fadeSec);
        fadeGain(gains[1], 0, fadeSec);
    }

    async function crossfadeTo(url, { sec = CONFIG.crossfadeSec } = {}) {
        currentUrl = url;

        // Triggers must not start playback
        if (!desiredOn || !isOn || !ctx || !gains) return;

        const ok = await ensureAudioRunning();
        if (!ok) return;

        const nextSlot = 1 - activeSlot;

        let buffer;
        try {
            buffer = await loadBuffer(url);
        } catch (err) {
            warn("audio failed to load/decode", err);
            return;
        }

        // Ensure gain starts at 0 for a proper fade-in
        gains[nextSlot].gain.value = 0;

        playInSlot(nextSlot, buffer);

        const targetVol = scrollMuted || document.hidden ? 0 : effectiveTargetVol;
        fadeGain(gains[nextSlot], targetVol, sec);
        fadeGain(gains[activeSlot], 0, sec);

        // stop old slot after fade
        scheduleStopSlot(activeSlot, sec);

        activeSlot = nextSlot;
    }

    function toggleSound() {
        // one click should prime + toggle
        primeAudioOnce();

        if (desiredOn) {
            turnOff();
        } else {
            turnOn();
        }
    }

    // ---------- events ----------
    function onRootClick(e) {
        // Prevent the LABEL default behavior from auto-toggling the checkbox
        // (this is what was flipping it out of sync)
        if (e.target !== toggleInput) e.preventDefault();

        // Only toggle when clicking the root (not the checkbox itself)
        if (e.target === toggleInput) return;

        ignoreNextInputChange = true;
        toggleSound();
    }

    function onRootKeydown(e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggleSound();
    }

    function onToggleChange() {
        // This path is only for direct checkbox interactions (SR/keyboard focus on input).
        primeAudioOnce();

        if (ignoreNextInputChange) {
            ignoreNextInputChange = false;
            setUILabel();
            return;
        }

        const muted = Boolean(toggleInput?.checked); // checked = muted
        if (muted) {
            turnOff();
        } else {
            turnOn();
        }
    }

    function onTriggerClick(e) {
        // Trigger = unlock + select URL; only crossfade if already playing
        primeAudioOnce();

        const val = String(e.currentTarget?.getAttribute("data-audio-trigger") || "");
        const targetUrl = val === "2" ? altUrl : defaultUrl;
        if (!targetUrl) return;

        currentUrl = targetUrl;
        if (desiredOn && isOn) crossfadeTo(targetUrl);
    }

    function onVisibilityChange() {
        if (document.hidden) {
            wasOnBeforeHide = isOn;
            if (isOn) turnOff({ fadeSec: CONFIG.crossfadeSec, keepDesired: true });
            return;
        }

        if (wasOnBeforeHide) {
            // resume only if user still wants it on
            if (desiredOn) turnOn({ fadeSec: CONFIG.crossfadeSec });
        }
    }

    // Wire up
    root.addEventListener("click", onRootClick);
    root.addEventListener("keydown", onRootKeydown);

    // Prime on earliest gesture (does not start sound by itself)
    root.addEventListener("pointerdown", primeAudioOnce, { passive: true });
    root.addEventListener("touchstart", primeAudioOnce, { passive: true });

    if (toggleInput) toggleInput.addEventListener("change", onToggleChange);

    document.addEventListener("visibilitychange", onVisibilityChange);

    cleanupFns.push(
        () => root.removeEventListener("click", onRootClick),
        () => root.removeEventListener("keydown", onRootKeydown),
        () => root.removeEventListener("pointerdown", primeAudioOnce),
        () => root.removeEventListener("touchstart", primeAudioOnce),
        () => toggleInput?.removeEventListener("change", onToggleChange),
        () => document.removeEventListener("visibilitychange", onVisibilityChange)
    );

    // Mute after scrolling 100vh down the page (independent of this element's visibility).
    let scrollRafId = 0;
    const getScrollY = () => {
        try {
            return Number(window.scrollY ?? window.pageYOffset ?? 0) || 0;
        } catch {
            return 0;
        }
    };
    const getVh = () => {
        try {
            return Number(window.innerHeight) || 0;
        } catch {
            return 0;
        }
    };
    const computeScrollMuted = () => getScrollY() >= getVh();

    const syncScrollMute = () => {
        scrollRafId = 0;

        const nextMuted = computeScrollMuted();
        if (nextMuted === scrollMuted) return;

        scrollMuted = nextMuted;

        if (scrollMuted) {
            if (desiredOn || isOn) {
                wasMutedByScroll = true;
                turnOff({ fadeSec: CONFIG.crossfadeSec, keepDesired: true });
            }
            return;
        }

        if (wasMutedByScroll) {
            wasMutedByScroll = false;
            if (desiredOn) turnOn({ fadeSec: CONFIG.crossfadeSec });
        }
    };

    const scheduleScrollMuteSync = () => {
        if (scrollRafId) return;
        scrollRafId = requestAnimationFrame(syncScrollMute);
    };

    window.addEventListener("scroll", scheduleScrollMuteSync, { passive: true });
    window.addEventListener("resize", scheduleScrollMuteSync, { passive: true });
    cleanupFns.push(
        () => window.removeEventListener("scroll", scheduleScrollMuteSync),
        () => window.removeEventListener("resize", scheduleScrollMuteSync),
        () => scrollRafId && cancelAnimationFrame(scrollRafId)
    );

    const triggerEls = Array.from(document.querySelectorAll("[data-audio-trigger]"));
    for (const el of triggerEls) el.addEventListener("click", onTriggerClick);
    cleanupFns.push(() => {
        for (const el of triggerEls) el.removeEventListener("click", onTriggerClick);
    });

    function getAutoTriggerUrl() {
        const el = triggerEls[0];
        if (!el) return null;
        const val = String(el.getAttribute("data-audio-trigger") || "");
        return val === "2" ? altUrl : defaultUrl;
    }

    function tryAutoStartFromTrigger(eventTarget) {
        if (root.contains(eventTarget)) return;
        if (autoTriggerUsed || hasEverStarted || desiredOn || isOn) return;
        autoTriggerUsed = true;
        const url = getAutoTriggerUrl();
        if (!url) return;
        currentUrl = url;
        turnOn();
    }

    const autoTriggerHandler = (e) => tryAutoStartFromTrigger(e.target);
    document.addEventListener("pointerdown", autoTriggerHandler, { passive: true, once: true });
    document.addEventListener("keydown", autoTriggerHandler, { passive: true, once: true });
    cleanupFns.push(() => {
        document.removeEventListener("pointerdown", autoTriggerHandler);
        document.removeEventListener("keydown", autoTriggerHandler);
    });

    // init
    desiredOn = false;
    isOn = false;
    currentUrl = defaultUrl;
    setUILabel();
    // Ensure initial scroll-muted state is correct.
    try {
        scrollMuted = (Number(window.scrollY ?? window.pageYOffset ?? 0) || 0) >=
            (Number(window.innerHeight) || 0);
    } catch { }

    root.ambientSound = {
        on: () => turnOn(),
        off: () => turnOff(),
        toggle: toggleSound,
        playUrl: (url) => {
            currentUrl = url;
            if (isOn) crossfadeTo(url);
        },
        playAlt: () => altUrl && (currentUrl = altUrl, isOn && crossfadeTo(altUrl)),
    };

    const destroy = () => {
        cleanupFns.splice(0).forEach((fn) => {
            try { fn(); } catch { }
        });

        desiredOn = false;
        isOn = false;
        setUILabel();

        if (gains) {
            fadeGain(gains[0], 0, 0.1);
            fadeGain(gains[1], 0, 0.1);
        }

        // Delay stop to allow fade out
        setTimeout(() => {
            stopSlotNow(0);
            stopSlotNow(1);
        }, 120);

        if (ctx) {
            try { ctx.close(); } catch { }
        }

        ctx = null;
        gains = null;
        sources = [null, null];
    };

    instance = { destroy };
    return instance;
}

export function init() {
    const root = document.querySelector("[data-audio-url]");
    if (root) initOne(root);
}

export function destroy() {
    instance?.destroy?.();
    instance = null;
}
