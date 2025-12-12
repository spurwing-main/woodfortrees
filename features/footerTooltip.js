import { animate } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

let tooltipEl;
let liveEl;
let repositionBound = false;
let activeEl = null;
let visible = false;

function positionTooltip() {
    if (!tooltipEl || !activeEl) return;
    const rect = activeEl.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    const spacing = 8;

    let x = rect.left + rect.width / 2 - tipRect.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, x));

    let y = rect.top - tipRect.height - spacing;
    if (y < 8) y = rect.bottom + spacing;

    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
}

function ensureRepositionListeners() {
    if (repositionBound) return;
    const reposition = () => {
        if (visible) positionTooltip();
    };
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition, { passive: true });
    repositionBound = true;
}

function ensureTooltip() {
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;

    tooltipEl = document.createElement("div");
    tooltipEl.className = "sitekit-copy-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.setAttribute("aria-hidden", "true");
    tooltipEl.textContent = "Copy";

    tooltipEl.style.cssText = [
        "position:fixed",
        "z-index:9999",
        "pointer-events:none",
        "padding:0.5rem 0.625rem",
        "font-size:0.875rem",
        "line-height:1",
        "border-radius:0.5rem",
        "background:rgba(0,0,0,0.85)",
        "color:#fff",
        "white-space:nowrap",
        "transform-origin:50% 100%",
        "opacity:0",
        "transform:translate3d(0,0.25rem,0) scale(0.98)",
        "box-shadow:0 0.125rem 0.5rem rgba(0,0,0,0.25)"
    ].join(";");

    document.body.appendChild(tooltipEl);
    return tooltipEl;
}

function ensureLiveRegion() {
    if (liveEl && document.body.contains(liveEl)) return liveEl;

    liveEl = document.createElement("div");
    liveEl.setAttribute("role", "status");
    liveEl.setAttribute("aria-live", "polite");
    liveEl.setAttribute("aria-atomic", "true");
    liveEl.style.cssText = [
        "position:absolute",
        "width:1px",
        "height:1px",
        "padding:0",
        "margin:-1px",
        "overflow:hidden",
        "clip:rect(0,0,0,0)",
        "white-space:nowrap",
        "border:0"
    ].join(";");

    document.body.appendChild(liveEl);
    return liveEl;
}

export function init() {
    const nodes = document.querySelectorAll("[data-copy]");
    if (!nodes.length) return;

    const tooltip = ensureTooltip();
    const live = ensureLiveRegion();

    let hideTimer = null;
    let currentAnim = null;

    const baseHiddenTransform = "translate3d(0,0.25rem,0) scale(0.98)";
    const baseVisibleTransform = "translate3d(0,0,0) scale(1)";

    const setHidden = () => {
        tooltip.style.opacity = "0";
        tooltip.style.transform = baseHiddenTransform;
        tooltip.setAttribute("aria-hidden", "true");
        visible = false;
    };

    const show = (target, text = "Copy") => {
        clearTimeout(hideTimer);
        hideTimer = null;

        activeEl = target;
        tooltip.textContent = text;
        tooltip.setAttribute("aria-hidden", "false");
        positionTooltip();

        currentAnim?.stop?.();
        currentAnim = animate(
            tooltip,
            {
                opacity: [parseFloat(tooltip.style.opacity) || 0, 1],
                transform: [tooltip.style.transform || baseHiddenTransform, baseVisibleTransform]
            },
            { duration: 0.18, ease: "easeOut" }
        );
        visible = true;
    };

    const hide = (immediate = false) => {
        if (!visible) return;
        clearTimeout(hideTimer);
        hideTimer = null;

        currentAnim?.stop?.();

        if (immediate) {
            setHidden();
            return;
        }

        const anim = animate(
            tooltip,
            {
                opacity: [1, 0],
                transform: [baseVisibleTransform, baseHiddenTransform]
            },
            { duration: 0.12, ease: "easeInOut" }
        );
        currentAnim = anim;

        anim.finished.finally(() => {
            if (currentAnim === anim) setHidden();
        });
    };

    const flash = (target, text, ms = 1000) => {
        show(target, text);
        live.textContent = text;
        hideTimer = setTimeout(() => {
            tooltip.textContent = "Copy";
            hide();
        }, ms);
    };

    const onEnter = (el) => show(el, "Copy");
    const onLeave = () => {
        if (hideTimer) return;
        hide();
    };

    nodes.forEach((el) => {
        if (el.dataset.sitekitCopyBound) return;
        el.dataset.sitekitCopyBound = "true";

        el.addEventListener("mouseenter", () => onEnter(el), { passive: true });
        el.addEventListener("focus", () => onEnter(el), { passive: true });
        el.addEventListener("mouseleave", onLeave, { passive: true });
        el.addEventListener("blur", onLeave, { passive: true });

        el.addEventListener("click", async (event) => {
            event.preventDefault();

            const text = (el.value ?? el.textContent ?? "").trim();
            if (!text) return flash(el, "Nothing to copy");

            try {
                await navigator.clipboard.writeText(text);
                flash(el, "Copied");
            } catch {
                flash(el, "Copy failed");
            }
        });
    });

    ensureRepositionListeners();
}
