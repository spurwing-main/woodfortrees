import { createLogger } from "../utils/debug.js";

const { log, warn } = createLogger("ambientSound");

const CONFIG = {
    fadeInSec: 1.8,
    fadeOutSec: 1.5,
    crossfadeSec: 1.5,
    targetVol: 1.0,
};
let instance = null;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function initOne(root) {
    if (instance) return instance;

    const toggleInput = root.querySelector("input[type='checkbox']");
    const textOnEls = Array.from(root.querySelectorAll('[data-audio-text="on"]'));
    const textOffEls = Array.from(root.querySelectorAll('[data-audio-text="off"]'));
    const defaultUrl = root.dataset.audioUrl || root.getAttribute("data-audio-url");
    const url2 = root.dataset.audioUrl2 || root.getAttribute("data-audio-url-2");
    const label = root.dataset.audioLabel || root.getAttribute("data-audio-label") || "Toggle sound";

    if (!defaultUrl) return;

    log("init", { defaultUrl, hasAlt: Boolean(url2) });

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

    const ctx = new AudioCtx();
    const slotGain = [ctx.createGain(), ctx.createGain()];
    slotGain.forEach((g) => {
        g.gain.value = 0;
        g.connect(ctx.destination);
    });

    let sources = [null, null];
    const buffers = new Map();
    let activeSlot = 0;
    let isOn = false;
    let desiredOn = false;
    let autoplayFailed = false;
    let triggerPrimedUsed = false;
    let hasPlayed = false;
    let currentUrl = null;
    let pendingAutoplay = false;
    let wasOnBeforeHide = false;
    let wasOnOffscreen = false;
    let cleanupFns = [];
    let timers = new Set();
    let startPromise = null;

    function setUILabel() {
        const soundOn = isOn;
        root.setAttribute("aria-pressed", soundOn ? "true" : "false");
        if (toggleInput) {
            toggleInput.checked = !soundOn;
        }
        const onOpacity = soundOn ? 1 : 0;
        const offOpacity = soundOn ? 0 : 1;
        textOnEls.forEach((el) => {
            el.style.opacity = onOpacity;
            el.style.transition = el.style.transition || "opacity 0.35s ease";
            el.textContent = "SOUND ON";
            el.setAttribute("aria-hidden", soundOn ? "false" : "true");
        });
        textOffEls.forEach((el) => {
            el.style.opacity = offOpacity;
            el.style.transition = el.style.transition || "opacity 0.35s ease";
            el.textContent = "SOUND OFF";
            el.setAttribute("aria-hidden", soundOn ? "true" : "false");
        });
    }

    function fadeGain(gainNode, to, sec) {
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

    async function loadBuffer(url) {
        if (buffers.has(url)) {
            log("buffer:cache-hit", { url });
            return buffers.get(url);
        }
        log("buffer:load-start", { url });
        const p = fetch(url, { mode: "cors" })
            .then((r) => {
                if (!r.ok) throw new Error(`Fetch failed (${r.status}) for ${url}`);
                return r.arrayBuffer();
            })
            .then((ab) => ctx.decodeAudioData(ab))
            .then((decoded) => {
                log("buffer:loaded", { url });
                return decoded;
            });
        buffers.set(url, p);
        return p;
    }

    function stopSlot(slot) {
        const s = sources[slot];
        if (!s) return;
        try {
            s.stop(0);
        } catch { }
        try {
            s.disconnect();
        } catch { }
        sources[slot] = null;
    }

    function clearTimers() {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
    }

    function playInSlot(slot, buffer) {
        clearTimers();
        stopSlot(slot);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(slotGain[slot]);
        src.start(0);
        sources[slot] = src;
        log("play:start", { slot, url: currentUrl });
    }

    async function ensureAudioRunning() {
        if (ctx.state === "running") return true;
        const timeoutMs = 400;
        const resumePromise = ctx.resume().then(
            () => "resumed",
            () => "failed"
        );
        const result = await Promise.race([
            resumePromise,
            new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
        ]);

        if (result !== "resumed" || ctx.state !== "running") {
            log("audio:resume-blocked", { result, state: ctx.state });
            return false;
        }

        log("audio:resume-ok", { state: ctx.state });
        return true;
    }

    async function turnOn({ fadeSec = CONFIG.fadeInSec, intent = true } = {}) {
        if (startPromise) return startPromise;
        if (isOn && sources[activeSlot]) {
            log("turnOn:already-playing", { currentUrl, activeSlot });
            return;
        }
        startPromise = (async () => {
            log("turnOn:start", { currentUrl, fadeSec });
            if (intent) {
                desiredOn = true;
                setUILabel();
            }
            const ok = await ensureAudioRunning();
            if (!ok) {
                log("turnOn:blocked");
                pendingAutoplay = true;
                isOn = false;
                desiredOn = false;
                setUILabel();
                if (!intent) autoplayFailed = true;
                if (intent) {
                    log("turnOn:pending-autoplay", { currentUrl });
                }
                return;
            }

            if (!currentUrl) currentUrl = defaultUrl;

            isOn = true;
            desiredOn = true;
            autoplayFailed = false;
            setUILabel();

            let buffer;
            try {
                buffer = await loadBuffer(currentUrl);
            } catch (err) {
                warn("audio failed to load/decode", err);
                isOn = false;
                setUILabel();
                return;
            }

            pendingAutoplay = false;
            playInSlot(activeSlot, buffer);
            hasPlayed = true;

            fadeGain(slotGain[activeSlot], CONFIG.targetVol, fadeSec);
            fadeGain(slotGain[1 - activeSlot], 0, 0.05);

            log("turnOn:playing", { currentUrl, activeSlot });
        })();

        try {
            await startPromise;
        } finally {
            startPromise = null;
        }
    }

    function turnOff({ fadeSec = CONFIG.fadeOutSec, keepDesired = false } = {}) {
        isOn = false;
        if (!keepDesired) desiredOn = false;
        setUILabel();

        fadeGain(slotGain[0], 0, fadeSec);
        fadeGain(slotGain[1], 0, fadeSec);
        log("turnOff", { fadeSec });

        clearTimers();
        stopSlot(0);
        stopSlot(1);
    }

    async function crossfadeTo(url, { sec = CONFIG.crossfadeSec } = {}) {
        currentUrl = url;
        if (!isOn) {
            turnOn({ intent: true, fadeSec: sec });
            return;
        }
        log("crossfade:start", { url, sec });

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

        clearTimers();
        playInSlot(nextSlot, buffer);
        fadeGain(slotGain[nextSlot], CONFIG.targetVol, sec);
        fadeGain(slotGain[activeSlot], 0, sec);

        activeSlot = nextSlot;
        log("crossfade:done", { activeSlot });
    }

    function toggle() {
        if (isOn) {
            turnOff();
            return;
        }

        if (url2) {
            currentUrl = currentUrl === defaultUrl ? url2 : defaultUrl;
            log("toggle:switch-url", { currentUrl });
        } else {
            currentUrl = defaultUrl;
        }

        turnOn({ intent: true });
    }

    function onTriggerClick(e) {
        const val = String(e.currentTarget?.getAttribute("data-audio-trigger") || "");
        const isTrusted = Boolean(e.isTrusted);
        const targetUrl = val === "2" ? url2 : defaultUrl;
        if (!targetUrl) return;
        log("trigger:click", { trigger: val, targetUrl, isTrusted, isOn, desiredOn });
        currentUrl = targetUrl;
        const canPrime =
            autoplayFailed && !hasPlayed && !triggerPrimedUsed && (!isOn || pendingAutoplay);

        if (canPrime) {
            triggerPrimedUsed = true;
            desiredOn = true;
            setUILabel();
            log("trigger:prime-once", { trigger: val, targetUrl });
            turnOn({ intent: true });
            return;
        }

        if (isOn) {
            crossfadeTo(targetUrl);
        }
    }

    function onVisibilityChange() {
        if (document.hidden) {
            wasOnBeforeHide = isOn;
            if (isOn) turnOff({ fadeSec: CONFIG.crossfadeSec, keepDesired: true });
        } else if (wasOnBeforeHide) {
            turnOn({ fadeSec: CONFIG.crossfadeSec });
        }
    }

    const onToggleChange = () => {
        const checked = Boolean(toggleInput?.checked);
        log("toggle:checkbox", { checked, isOn, pendingAutoplay });
        if (checked) {
            desiredOn = false;
            turnOff();
            return;
        }
        desiredOn = true;
        turnOn({ intent: true });
        if (pendingAutoplay) {
            log("autoplay:retry");
            turnOn();
        }
    };

    if (toggleInput) {
        toggleInput.addEventListener("change", onToggleChange);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    cleanupFns.push(
        () => document.removeEventListener("visibilitychange", onVisibilityChange),
        () => toggleInput?.removeEventListener("change", onToggleChange)
    );

    const observer = new IntersectionObserver(
        (entries) => {
            const entry = entries[0];
            if (!entry) return;
            if (entry.isIntersecting) {
                if (wasOnOffscreen) {
                    wasOnOffscreen = false;
                    turnOn({ fadeSec: CONFIG.crossfadeSec });
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
    triggerEls.forEach((el) => el.addEventListener("click", onTriggerClick));
    cleanupFns.push(() =>
        triggerEls.forEach((el) => el.removeEventListener("click", onTriggerClick))
    );

    setUILabel();

    currentUrl = defaultUrl;
    const preloadUrls = [defaultUrl, url2].filter(Boolean);
    log("preload:start", { urls: preloadUrls });
    Promise.all(preloadUrls.map((url) => loadBuffer(url)))
        .then(() => log("preload:done"))
        .catch((err) => warn("preload:failed", err));

    log("autoplay:attempt", { currentUrl });
    turnOn({ intent: false });

    root.ambientSound = {
        on: turnOn,
        off: turnOff,
        toggle,
        playUrl: (url) => crossfadeTo(url),
        playAlt: () => url2 && crossfadeTo(url2),
    };

    const destroy = () => {
        cleanupFns.splice(0).forEach((fn) => {
            try {
                fn();
            } catch { }
        });
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
        isOn = false;
        setUILabel();
        fadeGain(slotGain[0], 0, 0);
        fadeGain(slotGain[1], 0, 0);
        stopSlot(0);
        stopSlot(1);
        try {
            ctx.close();
        } catch { }
    };

    instance = { destroy };
    return instance;
}

export function init() {
    const root = document.querySelector("[data-audio-url]");
    if (root) initOne(root);
}

export function destroy() {
    if (instance?.destroy) instance.destroy();
    instance = null;
}
