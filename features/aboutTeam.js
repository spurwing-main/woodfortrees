import { animate, hover, press } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

let cleanupFns = [];

export function destroy() {
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn();
        } catch (err) {
            console.warn("aboutTeam destroy", err);
        }
    });
    cleanupFns = [];
}

/* -------------------------------
   motion config
-------------------------------- */

const springIn = {
    type: "spring",
    visualDuration: 0.4,
    bounce: 0.2,
};

const springOut = {
    type: "spring",
    visualDuration: 0.2,
    bounce: 0.15,
};

const hoverIntentDelayMs = 20;
const stackEnterY = -24;
const stackEnterScale = 1.05;
const stackExitY = 12;
const stackExitScale = 0.97;

/* -------------------------------
   shared animation control
-------------------------------- */

const activeAnimations = new WeakMap();

function isAnimating(element) {
    return activeAnimations.has(element);
}

function stopAnimation(element) {
    const controls = activeAnimations.get(element);
    if (!controls) return;
    try {
        controls.stop();
    } catch { }
    activeAnimations.delete(element);
}

function animateElement(element, keyframes, options) {
    stopAnimation(element);
    element.style.willChange = "transform, opacity";

    const controls = animate(element, keyframes, options);
    activeAnimations.set(element, controls);

    return controls.finished
        .catch(() => { })
        .then(() => {
            // Only clean up if this is still the active animation
            if (activeAnimations.get(element) === controls) {
                activeAnimations.delete(element);
                element.style.willChange = "";
            }
        });
}

/* -------------------------------
   base transforms
-------------------------------- */

function captureBaseTransform(el) {
    const t = getComputedStyle(el).transform;
    el.dataset.baseTransform = t === "none" ? "" : t;
}

function baseTransform(el) {
    return el.dataset.baseTransform || "";
}

function composeTransform(el, dy, scale) {
    return baseTransform(el) + ` translateY(${dy}px) scale(${scale})`;
}

/* -------------------------------
   layer show / hide
-------------------------------- */

function showLayer(element, delayMs = 0) {
    // If it's already fully visible and not animating, skip.
    const isVisible = element.style.visibility === "visible";
    const opacity = element.style.opacity;

    if (
        isVisible &&
        (opacity === "" || opacity === "1") &&
        !isAnimating(element)
    ) {
        return Promise.resolve();
    }

    // Ensure it's marked visible so the animation has somewhere to go
    element.style.visibility = "visible";

    return animateElement(
        element,
        {
            opacity: [0, 1],
            transform: [
                composeTransform(element, stackEnterY, stackEnterScale),
                composeTransform(element, 0, 1),
            ],
        },
        {
            ...springIn,
            delay: delayMs / 1000,
        }
    );
}

function hideLayer(element, delayMs = 0) {
    // If it's already hidden, don't bother.
    if (element.style.visibility === "hidden") {
        return Promise.resolve();
    }

    return animateElement(
        element,
        {
            opacity: [1, 0],
            transform: [
                composeTransform(element, 0, 1),
                composeTransform(element, stackExitY, stackExitScale),
            ],
        },
        {
            ...springOut,
            delay: delayMs / 1000,
        }
    ).then(() => {
        // After hide finishes, hard reset to "stacked, ready to enter" pose
        element.style.visibility = "hidden";
        element.style.transform = composeTransform(
            element,
            stackEnterY,
            stackEnterScale
        );
        element.style.opacity = "0";
    });
}

/* -------------------------------
   state controller (per card)
   0: img1
   1: img1 + img2
   2: img1 + img2 + img3
   3: img1 + img2 + img3 + bio
-------------------------------- */

function createStateController(img1, img2, img3, bio, countItems = []) {
    let state = 0;

    const config = {
        0: { img2: false, img3: false, bio: false },
        1: { img2: true, img3: false, bio: false },
        2: { img2: true, img3: true, bio: false },
        3: { img2: true, img3: true, bio: true },
    };

    function updateCount(nextState) {
        if (!countItems || !countItems.length) return;

        for (let i = 0; i < countItems.length; i++) {
            const dot = countItems[i];
            if (i <= nextState) {
                dot.classList.add("is-active");
            } else {
                dot.classList.remove("is-active");
            }
        }
    }

    function applyInitialLayout() {
        // base card
        img1.style.opacity = "1";
        img1.style.visibility = "visible";
        img1.style.transform = composeTransform(img1, 0, 1);

        const others = [img2, img3, bio];
        for (let i = 0; i < others.length; i++) {
            const el = others[i];
            el.style.opacity = "0";
            el.style.visibility = "hidden";
            el.style.transform = composeTransform(el, stackEnterY, stackEnterScale);
        }

        // state 0 on load → first dot active
        updateCount(0);
    }

    async function setState(next) {
        if (next === state) return;

        const from = config[state];
        const to = config[next];

        const tasks = [];

        if (from.img2 !== to.img2) {
            tasks.push(to.img2 ? showLayer(img2, 0) : hideLayer(img2, 0));
        }
        if (from.img3 !== to.img3) {
            // tiny stagger on img3 when showing
            tasks.push(to.img3 ? showLayer(img3, 60) : hideLayer(img3, 0));
        }
        if (from.bio !== to.bio) {
            tasks.push(to.bio ? showLayer(bio, 0) : hideLayer(bio, 0));
        }

        state = next;
        updateCount(state);

        await Promise.all(tasks);
    }

    return {
        get state() {
            return state;
        },
        applyInitialLayout,
        setState,
    };
}

/* -------------------------------
   interactions (per card)
-------------------------------- */

function wireInteractions(card, media, img1, img2, img3, bio, options = {}) {
    const { enableHover = true, isCoarsePointer = false } = options;

    const localCleanup = [];

    const countItems = Array.from(
        media.querySelectorAll(".team_item-count-item")
    );

    const controller = createStateController(img1, img2, img3, bio, countItems);
    controller.applyInitialLayout();

    /* ---------- HOVER (DESKTOP ONLY) ---------- */

    let intentZone = 0; // 0 none, 1 top media, 2 bottom media, 3 text/bio area
    let intentTimerId = null;
    let moveHandler = null;
    let rafId = null;
    let pendingEvent = null;

    function clearIntent() {
        if (intentTimerId) {
            clearTimeout(intentTimerId);
            intentTimerId = null;
        }
        intentZone = 0;
    }

    function pointerZoneForPoint(clientX, clientY) {
        const mediaRect = media.getBoundingClientRect();

        const inMedia =
            clientX >= mediaRect.left &&
            clientX <= mediaRect.right &&
            clientY >= mediaRect.top &&
            clientY <= mediaRect.bottom;

        if (!inMedia) {
            const cardRect = card.getBoundingClientRect();
            const inCard =
                clientX >= cardRect.left &&
                clientX <= cardRect.right &&
                clientY >= cardRect.top &&
                clientY <= cardRect.bottom;
            return inCard ? 3 : 0;
        }

        const y = clientY - mediaRect.top;
        return y < mediaRect.height / 2 ? 1 : 2;
    }

    function scheduleZone(zone) {
        if (zone === intentZone) return;

        intentZone = zone;

        if (intentTimerId) {
            clearTimeout(intentTimerId);
            intentTimerId = null;
        }

        if (zone === 0) {
            controller.setState(0);
            return;
        }

        intentTimerId = setTimeout(() => {
            intentTimerId = null;
            applyZone(zone);
        }, hoverIntentDelayMs);
    }

    function applyZone(zone) {
        if (zone === 1) {
            // top half media → state 1
            controller.setState(1);
        } else if (zone === 2) {
            // bottom half media → state 2
            controller.setState(2);
        } else if (zone === 3) {
            // text area → full stack + bio
            controller.setState(3);
        }
    }

    function processPointer(event) {
        const zone = pointerZoneForPoint(event.clientX, event.clientY);
        scheduleZone(zone);
    }

    if (enableHover && !isCoarsePointer) {
        const cancelHover = hover(card, (element, startEvent) => {
            processPointer(startEvent);

            moveHandler = (event) => {
                pendingEvent = event;
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    if (!pendingEvent) return;
                    processPointer(pendingEvent);
                });
            };

            card.addEventListener("pointermove", moveHandler);

            return () => {
                if (moveHandler) {
                    card.removeEventListener("pointermove", moveHandler);
                    moveHandler = null;
                }
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                pendingEvent = null;
                clearIntent();
                controller.setState(0);
            };
        });

        localCleanup.push(cancelHover);
    }

    /* ---------- CLICK / TAP / SWIPE: cycle through states ---------- */

    const cancelPress = press(card, (_element, startEvent) => {
        const startTime = performance.now();
        const startX = typeof startEvent?.clientX === "number" ? startEvent.clientX : null;
        const startY = typeof startEvent?.clientY === "number" ? startEvent.clientY : null;
        const pointerType = startEvent?.pointerType;

        return async (endEvent, info) => {
            if (!info?.success) return;

            const dt = performance.now() - startTime;
            const endX = typeof endEvent?.clientX === "number" ? endEvent.clientX : null;
            const endY = typeof endEvent?.clientY === "number" ? endEvent.clientY : null;

            const isTouch = isCoarsePointer || pointerType === "touch";
            const isMouse = pointerType === "mouse";

            if (isTouch) {
                // touch: simple tap / short swipe = cycle
                if (dt > 800) return;
            } else if (isMouse) {
                // desktop click: quick + small movement only
                if (dt > 500) return;
                if (
                    startX !== null &&
                    startY !== null &&
                    endX !== null &&
                    endY !== null
                ) {
                    const dx = endX - startX;
                    const dy = endY - startY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > 400) return;
                }
            } else {
                // keyboard/unknown pointer type: accept
            }

            const next = (controller.state + 1) % 4;
            await controller.setState(next);
        };
    });

    localCleanup.push(cancelPress);

    return () => {
        localCleanup.splice(0).forEach((fn) => {
            try {
                fn();
            } catch {
                // ignore
            }
        });
    };
}

/* -------------------------------
   setup per item
-------------------------------- */

function setupStack(media, img1, img2, img3, bio) {
    if (!media.style.position) {
        media.style.position = "relative";
    }
    media.style.overflow = "visible";

    const imgs = [img1, img2, img3];
    for (let i = 0; i < imgs.length; i++) {
        const image = imgs[i];
        captureBaseTransform(image);
        Object.assign(image.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transformOrigin: "center center",
            zIndex: String(1 + i),
        });
    }

    captureBaseTransform(bio);
    if (!bio.style.position) {
        bio.style.position = "absolute";
    }
    if (!bio.style.bottom) {
        bio.style.bottom = "0";
    }
    bio.style.left = "0";
    bio.style.right = "0";
}

/* -------------------------------
   util: Fisher–Yates shuffle
-------------------------------- */

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

/* -------------------------------
   public init
-------------------------------- */

export function init() {
    const root = document.querySelector(".section_team");
    if (!root) return;

    // Clean up previous mount if called twice
    destroy();

    /* ---- 1. Randomise card order, keep .team_cta last in each .team_list ---- */

    const lists = Array.from(root.querySelectorAll(".team_list"));

    for (let i = 0; i < lists.length; i++) {
        const list = lists[i];
        const children = Array.from(list.children);
        const ctas = [];
        const others = [];

        for (let j = 0; j < children.length; j++) {
            const el = children[j];
            if (el.classList.contains("team_cta")) {
                ctas.push(el);
            } else {
                others.push(el);
            }
        }

        shuffleInPlace(others);

        for (let j = 0; j < others.length; j++) {
            list.appendChild(others[j]);
        }
        for (let j = 0; j < ctas.length; j++) {
            list.appendChild(ctas[j]);
        }
    }

    /* ---- 2. Wire Motion for all non-CTA team cards ---- */

    const items = Array.from(
        root.querySelectorAll(".team_item")
    );
    if (!items.length) return;

    const coarseQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const isCoarsePointer = coarseQuery.matches;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const media = item.querySelector(".team_item-media");
        if (!media) continue;

        const img1 = media.querySelector(".team_item-media-img.is-1");
        const img2 = media.querySelector(".team_item-media-img.is-2");
        const img3 = media.querySelector(".team_item-media-img.is-3");
        const bio = media.querySelector(".team_item-bio");

        if (!img1 || !img2 || !img3 || !bio) continue;

        setupStack(media, img1, img2, img3, bio);

        const cleanup = wireInteractions(
            item,
            media,
            img1,
            img2,
            img3,
            bio,
            {
                enableHover: !isCoarsePointer,
                isCoarsePointer,
            }
        );

        if (typeof cleanup === "function") cleanupFns.push(cleanup);
    }
}
