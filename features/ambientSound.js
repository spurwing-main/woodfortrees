import { createLogger } from "../utils/debug.js";

const { log, warn } = createLogger("ambientSound");

const CONFIG = {
    fadeInSec: 1.2,
    fadeOutSec: 0.9,
    crossfadeSec: 1.0,
    targetVol: 1.0,
};

const LOTTIE_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js";

const STYLE_ID = "sitekit-ambient-sound";

let instance = null;
let lottieReady = null;

function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
        ".about_sound:focus-visible{outline:2px solid currentColor;outline-offset:4px;}",
        ".about_sound:focus-within{outline:2px solid currentColor;outline-offset:4px;}"
    ].join("");
    document.head.appendChild(style);
}

function loadLottie() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (lottieReady) return lottieReady;

    lottieReady = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${LOTTIE_SRC}"]`);
        if (existing) {
            existing.addEventListener("load", () => resolve(window.lottie), { once: true });
            existing.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = LOTTIE_SRC;
        script.async = true;
        script.addEventListener("load", () => resolve(window.lottie), { once: true });
        script.addEventListener("error", reject, { once: true });
        document.head.appendChild(script);
    });

    return lottieReady;
}

function initOne(root) {
    if (instance) return instance;

    const animEl = root.querySelector("[data-audio-target]");
    const textEl = root.querySelector("[data-audio-text]");
    const lottieUrl = root.getAttribute("data-lottie-url");
    const defaultUrl = root.getAttribute("data-audio-url");
    const url2 = root.getAttribute("data-audio-url-2");
    const label = root.getAttribute("data-audio-label") || "Toggle sound";

    if (!defaultUrl) return;

    log("init", { defaultUrl, hasAlt: Boolean(url2), hasLottie: Boolean(lottieUrl) });

    ensureStyles();

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
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    const slotGain = [ctx.createGain(), ctx.createGain()];
    slotGain[0].gain.value = 0;
    slotGain[1].gain.value = 0;
    slotGain[0].connect(master);
    slotGain[1].connect(master);

    let lottieAnim = null;
    let sources = [null, null];
    let buffers = new Map();
    let activeSlot = 0;
    let isOn = false;
    let desiredOn = false;
    let autoplayFailed = false;
    let triggerPrimedUsed = false;
    let currentUrl = null;
    let nextUrl = url2 || defaultUrl;
    let pendingAutoplay = false;
    let wasOnBeforeHide = false;
    let cleanupFns = [];
    let timers = new Set();
    let startPromise = null;

    if (animEl && lottieUrl) {
        loadLottie()
            .then((lottie) => {
                if (!lottie) return;
                lottieAnim = lottie.loadAnimation({
                    container: animEl,
                    renderer: "svg",
                    loop: true,
                    autoplay: false,
                    path: lottieUrl,
                });
            })
            .catch((err) => warn("lottie failed to load", err));
    }

    function setUILabel() {
        root.setAttribute("aria-pressed", desiredOn ? "true" : "false");
        if (!textEl) return;
        textEl.textContent = desiredOn ? "SOUND ON" : "SOUND OFF";
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

    function playInSlot(slot, buffer) {
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

    function lottieOn() {
        if (!lottieAnim) return;
        lottieAnim.play();
    }

    function lottieOff() {
        if (!lottieAnim) return;
        lottieAnim.pause();
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
                if (!intent) autoplayFailed = true;
                if (intent) {
                    log("turnOn:pending-autoplay", { currentUrl });
                }
                return;
            }

            if (!currentUrl) currentUrl = defaultUrl;

            isOn = true;
            desiredOn = true;
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

            fadeGain(slotGain[activeSlot], CONFIG.targetVol, fadeSec);
            fadeGain(slotGain[1 - activeSlot], 0, 0.05);

            lottieOn();
            log("turnOn:playing", { currentUrl, activeSlot });
        })();

        try {
            await startPromise;
        } finally {
            startPromise = null;
        }
    }

    function turnOff({ fadeSec = CONFIG.fadeOutSec } = {}) {
        isOn = false;
        desiredOn = false;
        setUILabel();

        fadeGain(slotGain[0], 0, fadeSec);
        fadeGain(slotGain[1], 0, fadeSec);
        lottieOff();
        log("turnOff", { fadeSec });

        const stopAfterMs = Math.ceil(fadeSec * 1000) + 50;
        const timer = setTimeout(() => {
            timers.delete(timer);
            stopSlot(0);
            stopSlot(1);
        }, stopAfterMs);
        timers.add(timer);
    }

    async function crossfadeTo(url, { sec = CONFIG.crossfadeSec } = {}) {
        currentUrl = url;
        if (!isOn) return;
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

        playInSlot(nextSlot, buffer);
        fadeGain(slotGain[nextSlot], CONFIG.targetVol, sec);
        fadeGain(slotGain[activeSlot], 0, sec);

        const stopAfterMs = Math.ceil(sec * 1000) + 50;
        const oldSlot = activeSlot;
        const timer = setTimeout(() => {
            timers.delete(timer);
            stopSlot(oldSlot);
        }, stopAfterMs);
        timers.add(timer);

        activeSlot = nextSlot;
        log("crossfade:done", { activeSlot });
    }

    function toggle() {
        if (isOn) {
            turnOff();
            return;
        }

        if (url2) {
            currentUrl = nextUrl || defaultUrl;
            nextUrl = currentUrl === defaultUrl ? url2 : defaultUrl;
            log("toggle:switch-url", { currentUrl, nextUrl });
        } else {
            currentUrl = defaultUrl;
        }

        turnOn({ intent: true });
    }

    function onClick() {
        log("click", { isOn, pendingAutoplay, desiredOn });
        toggle();
        if (pendingAutoplay) {
            log("autoplay:retry");
            turnOn();
        }
    }

    function onTriggerClick(e) {
        const val = String(e.currentTarget?.getAttribute("data-audio-trigger") || "");
        const isTrusted = Boolean(e.isTrusted);
        const targetUrl = val === "2" ? url2 : defaultUrl;
        if (!targetUrl) return;
        log("trigger:click", { trigger: val, targetUrl, isTrusted, isOn, desiredOn });
        currentUrl = targetUrl;
        nextUrl = targetUrl === defaultUrl ? url2 || defaultUrl : defaultUrl;

        if (autoplayFailed && !triggerPrimedUsed) {
            triggerPrimedUsed = true;
            desiredOn = true;
            setUILabel();
            log("trigger:prime-once", { trigger: val, targetUrl });
            if (!isOn) {
                turnOn({ intent: true });
                return;
            }
        }

        if (isOn) {
            crossfadeTo(targetUrl);
        }
    }

    function onKeydown(e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
    }

    function onVisibilityChange() {
        if (document.hidden) {
            wasOnBeforeHide = isOn;
            if (isOn) turnOff({ fadeSec: 0.35 });
        } else if (wasOnBeforeHide) {
            turnOn({ fadeSec: 0.5 });
        }
    }

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeydown);
    document.addEventListener("visibilitychange", onVisibilityChange);

    cleanupFns.push(() => root.removeEventListener("click", onClick));
    cleanupFns.push(() => root.removeEventListener("keydown", onKeydown));
    cleanupFns.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

    const triggerEls = Array.from(document.querySelectorAll("[data-audio-trigger]"));
    triggerEls.forEach((el) => el.addEventListener("click", onTriggerClick));
    cleanupFns.push(() =>
        triggerEls.forEach((el) => el.removeEventListener("click", onTriggerClick))
    );

    setUILabel();
    lottieOff();

    currentUrl = defaultUrl;
    nextUrl = url2 || defaultUrl;
    log("preload:start", { urls: [defaultUrl, url2].filter(Boolean) });
    Promise.all([defaultUrl, url2].filter(Boolean).map((url) => loadBuffer(url)))
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
        lottieOff();
        try {
            ctx.close();
        } catch { }
        if (lottieAnim) {
            try {
                lottieAnim.destroy();
            } catch { }
        }
    };

    instance = { destroy };
    return instance;
}

export function init() {
    const root = document.querySelector(".about_sound");
    if (root) initOne(root);
}

export function destroy() {
    if (instance?.destroy) instance.destroy();
    instance = null;
}
