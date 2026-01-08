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
    let isOn = false;        // "intended + currently playing/fading"
    let desiredOn = false;   // UI intent (for immediate UI)
    let currentUrl = defaultUrl;

    let primed = false;
    let preloadStarted = false;

    let wasOnBeforeHide = false;
    let wasOnOffscreen = false;

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

        const now = ctx.currentTime;
        const g = gainNode.gain;

        if (typeof g.cancelAndHoldAtTime === "function") {
            g.cancelAndHoldAtTime(now);
        } else {
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
        }

        g.linearRampToValueAtTime(clamp01(to), now + Math.max(0.001, sec));
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

        if (isOn && sources[activeSlot]) return;

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

            playInSlot(activeSlot, buffer);

            fadeGain(gains[activeSlot], effectiveTargetVol, fadeSec);
            fadeGain(gains[1 - activeSlot], 0, 0.05);
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
            isOn = false;
            stopSlotNow(0);
            stopSlotNow(1);
            return;
        }

        // fade first
        fadeGain(gains[0], 0, fadeSec);
        fadeGain(gains[1], 0, fadeSec);

        // then stop after fade (this was your missing piece)
        scheduleStopSlot(0, fadeSec);
        scheduleStopSlot(1, fadeSec);

        isOn = false;
    }

    async function crossfadeTo(url, { sec = CONFIG.crossfadeSec } = {}) {
        currentUrl = url;

        // Triggers must not start playback
        if (!isOn || !ctx || !gains) return;

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

        playInSlot(nextSlot, buffer);

        fadeGain(gains[nextSlot], effectiveTargetVol, sec);
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
        if (isOn) crossfadeTo(targetUrl);
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

    const observer = new IntersectionObserver(
        (entries) => {
            const entry = entries[0];
            if (!entry) return;

            if (entry.isIntersecting) {
                if (wasOnOffscreen) {
                    wasOnOffscreen = false;
                    if (desiredOn) turnOn({ fadeSec: CONFIG.crossfadeSec });
                }
                return;
            }

            if (isOn) {
                wasOnOffscreen = true;
                turnOff({ fadeSec: CONFIG.crossfadeSec, keepDesired: true });
            }
        },
        { threshold: 0.05, rootMargin: "100% 0px 0px 0px" }
    );

    observer.observe(root);
    cleanupFns.push(() => observer.disconnect());

    const triggerEls = Array.from(document.querySelectorAll("[data-audio-trigger]"));
    for (const el of triggerEls) el.addEventListener("click", onTriggerClick);
    cleanupFns.push(() => {
        for (const el of triggerEls) el.removeEventListener("click", onTriggerClick);
    });

    // init
    desiredOn = false;
    isOn = false;
    currentUrl = defaultUrl;
    setUILabel();

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
            fadeGain(gains[0], 0, 0);
            fadeGain(gains[1], 0, 0);
        }

        stopSlotNow(0);
        stopSlotNow(1);

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
