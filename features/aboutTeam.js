import { animate, hover } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

/* -------------------------------
   Motion feel
-------------------------------- */

const SPRING_IN = {
    type: "spring",
    visualDuration: 0.4,
    bounce: 0.3,
};

const SPRING_OUT = {
    type: "spring",
    visualDuration: 0.3,
    bounce: 0.15,
};

const HOVER_DELAY_MS = 80;

// Respect OS-level "reduce motion"
const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
let REDUCE_MOTION = mql.matches;

mql.addEventListener("change", (e) => {
    REDUCE_MOTION = e.matches;
});

/* -------------------------------
   Shared animation control
-------------------------------- */

const activeAnimations = new WeakMap();

function stopAnimation(el) {
    const ctrl = activeAnimations.get(el);
    if (!ctrl) return;
    try {
        ctrl.stop();
    } catch (_) {
        // ignore
    }
    activeAnimations.delete(el);
}

function animateImage(el, keyframes, options) {
    // Reduced motion: jump to end state, no animation
    if (REDUCE_MOTION) {
        const finalOpacity = Array.isArray(keyframes.opacity)
            ? keyframes.opacity[keyframes.opacity.length - 1]
            : keyframes.opacity ?? 1;

        const finalTransform = Array.isArray(keyframes.transform)
            ? keyframes.transform[keyframes.transform.length - 1]
            : keyframes.transform ?? "";

        el.style.opacity = String(finalOpacity);
        if (finalTransform) el.style.transform = finalTransform;
        return Promise.resolve();
    }

    stopAnimation(el);

    el.style.willChange = "transform, opacity";

    const controls = animate(el, keyframes, options);
    activeAnimations.set(el, controls);

    return controls.finished
        .catch(() => { })
        .then(() => {
            // Only clean up if this is still the latest animation
            if (activeAnimations.get(el) === controls) {
                activeAnimations.delete(el);
                el.style.willChange = "auto";
            }
        });
}

/* -------------------------------
   Public init
-------------------------------- */

export function init() {
    const root = document.querySelector(".section_team");
    if (!root) return;

    const items = Array.from(root.querySelectorAll(".team_item"));
    if (!items.length) return;

    items.forEach((item) => {
        const media = item.querySelector(".team_item-media");
        if (!media) return;

        const img1 = media.querySelector(".team_item-media-img.is-1");
        const img2 = media.querySelector(".team_item-media-img.is-2");
        const img3 = media.querySelector(".team_item-media-img.is-3");
        if (!img1 || !img2 || !img3) return;

        setupStack(media, img1, img2, img3);
        wireInteractions(media, img1, img2, img3);
    });
}

/* -------------------------------
   Base transforms
-------------------------------- */

function captureBaseTransform(img) {
    const t = getComputedStyle(img).transform;
    img.dataset.baseTransform = t === "none" ? "" : t;
}

function baseTransform(img) {
    return img.dataset.baseTransform || "";
}

function composeTransform(img, dy, scale) {
    const base = baseTransform(img);
    const extra = ` translateY(${dy}px) scale(${scale})`;
    return (base || "") + extra;
}

/* -------------------------------
   Initial stack layout
-------------------------------- */

function setupStack(media, img1, img2, img3) {
    if (!media.style.position) {
        media.style.position = "relative";
    }
    media.style.overflow = "visible"; // show rotated edges

    [img1, img2, img3].forEach((img, i) => {
        captureBaseTransform(img);

        Object.assign(img.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transformOrigin: "center center",
            willChange: "transform, opacity",
            zIndex: String(1 + i), // 1 = base, 2 = mid, 3 = top
        });
    });

    // is-1 visible on load
    img1.style.opacity = "1";
    img1.style.visibility = "visible";
    img1.style.transform = composeTransform(img1, 0, 1);

    // is-2 and is-3 hidden above, ready to drop
    [img2, img3].forEach((img) => {
        img.style.opacity = "0";
        img.style.visibility = "hidden";
        img.style.transform = composeTransform(img, -24, 0.96);
    });
}

/* -------------------------------
   State + interactions
   state 0: only is-1
   state 1: show is-2
   state 2: show is-2 and is-3
-------------------------------- */

function wireInteractions(media, img1, img2, img3) {
    let state = 0;
    let moveHandler = null;
    let rafId = null;
    let pendingY = null;
    let pendingState = null;
    let stateTimer = null;

    function clearHoverState() {
        if (moveHandler) {
            media.removeEventListener("pointermove", moveHandler);
            moveHandler = null;
        }
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (stateTimer) {
            clearTimeout(stateTimer);
            stateTimer = null;
        }
        pendingState = null;
        pendingY = null;
    }

    function pointerStateForY(clientY) {
        const rect = media.getBoundingClientRect();
        const y = clientY - rect.top;
        if (y < 0 || y > rect.height) return null;
        return y < rect.height / 2 ? 1 : 2;
    }

    function scheduleState(nextState, opts) {
        if (nextState == null) return;
        if (nextState === state && !pendingState) return;

        pendingState = { nextState, opts };

        if (stateTimer) return;

        stateTimer = setTimeout(() => {
            stateTimer = null;
            if (!pendingState) return;

            const { nextState: targetState, opts: targetOpts } = pendingState;
            pendingState = null;
            goToState(targetState, targetOpts);
        }, HOVER_DELAY_MS);
    }

    function processPointerY(y, opts) {
        const s = pointerStateForY(y);
        scheduleState(s, opts);
    }

    function goToState(nextState, { fromEnter = false } = {}) {
        if (nextState === state || nextState == null) return;

        if (nextState === 0) {
            // Reset to base
            hideImage(img3, 0);
            hideImage(img2, 0.05);
        } else if (nextState === 1) {
            // Top half → ensure second in, hide third
            if (state === 0) {
                showImage(img2, 0);
            }
            hideImage(img3, 0);
        } else if (nextState === 2) {
            // Bottom half → show second and third
            if (state === 0 && fromEnter) {
                // Entered directly in bottom half → drop both
                showImage(img2, 0);
                showImage(img3, 0.06);
            } else {
                if (state === 0) showImage(img2, 0);
                showImage(img3, 0);
            }
        }

        state = nextState;
    }

    // Let Motion's hover() manage pointer enter/leave
    hover(media, (element, startEvent) => {
        processPointerY(startEvent.clientY, { fromEnter: true });

        // Track pointer movement while hovering
        moveHandler = (e) => {
            pendingY = e.clientY;
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                rafId = null;
                processPointerY(pendingY);
            });
        };
        media.addEventListener("pointermove", moveHandler);

        // Cleanup when hover ends
        return () => {
            clearHoverState();
            goToState(0);
        };
    });
}

/* -------------------------------
   Show / hide helpers
-------------------------------- */

function showImage(img, delay = 0) {
    img.style.visibility = "visible";

    return animateImage(
        img,
        {
            opacity: [0, 1],
            transform: [
                composeTransform(img, -24, 0.96),
                composeTransform(img, 0, 1),
            ],
        },
        {
            ...SPRING_IN,
            delay,
        }
    );
}

function hideImage(img, delay = 0) {
    if (img.style.visibility === "hidden") return Promise.resolve();

    return animateImage(
        img,
        {
            opacity: [1, 0],
            transform: [
                composeTransform(img, 0, 1),
                composeTransform(img, 12, 0.97),
            ],
        },
        {
            ...SPRING_OUT,
            delay,
        }
    ).then(() => {
        img.style.visibility = "hidden";
        // Reset back up ready for the next "drop"
        img.style.transform = composeTransform(img, -24, 0.96);
    });
}