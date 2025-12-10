import { animate, hover } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

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

const hoverIntentDelayMs = 200;
const stackEnterY = -24;
const stackEnterScale = 1.05;
const stackExitY = 12;
const stackExitScale = 0.97;

/* -------------------------------
   shared animation control
-------------------------------- */

const activeAnimations = new WeakMap();

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
    if (
        element.style.visibility === "visible" &&
        (element.style.opacity === "" || element.style.opacity === "1")
    ) {
        return Promise.resolve();
    }

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
        element.style.visibility = "hidden";
        element.style.transform = composeTransform(
            element,
            stackEnterY,
            stackEnterScale
        );
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

        countItems.forEach((dot, index) => {
            if (index <= nextState) {
                dot.classList.add("is-active");
            } else {
                dot.classList.remove("is-active");
            }
        });
    }

    function applyInitialLayout() {
        // base card
        img1.style.opacity = "1";
        img1.style.visibility = "visible";
        img1.style.transform = composeTransform(img1, 0, 1);

        [img2, img3, bio].forEach((el) => {
            el.style.opacity = "0";
            el.style.visibility = "hidden";
            el.style.transform = composeTransform(el, stackEnterY, stackEnterScale);
        });

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
        hover(card, (element, startEvent) => {
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
    }

    /* ---------- CLICK / TAP / SWIPE: cycle through states ---------- */

    let downPos = null;
    let downTime = 0;

    card.addEventListener("pointerdown", (event) => {
        if (!isCoarsePointer && event.pointerType === "mouse" && event.button !== 0) {
            return;
        }
        downPos = { x: event.clientX, y: event.clientY };
        downTime = performance.now();
    });

    card.addEventListener("pointerup", async (event) => {
        if (!downPos) return;

        const dt = performance.now() - downTime;
        const dx = event.clientX - downPos.x;
        const dy = event.clientY - downPos.y;
        const distSq = dx * dx + dy * dy;
        downPos = null;

        if (isCoarsePointer) {
            // touch: simple tap / short swipe = cycle
            if (dt > 800) return;
            const next = (controller.state + 1) % 4;
            await controller.setState(next);
            return;
        }

        // desktop click: quick + small movement only
        if (dt > 500 || distSq > 400) return;

        const next = (controller.state + 1) % 4;
        await controller.setState(next);
    });
}

/* -------------------------------
   setup per item
-------------------------------- */

function setupStack(media, img1, img2, img3, bio) {
    if (!media.style.position) {
        media.style.position = "relative";
    }
    media.style.overflow = "visible";

    [img1, img2, img3].forEach((image, index) => {
        captureBaseTransform(image);
        Object.assign(image.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transformOrigin: "center center",
            zIndex: String(1 + index),
        });
    });

    captureBaseTransform(bio);
    bio.style.position = bio.style.position || "absolute";
    bio.style.left = "0";
    bio.style.right = "0";
    bio.style.bottom = bio.style.bottom || "0";
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

    /* ---- 1. Randomise card order, keep .team_cta last in each .team_list ---- */

    const lists = Array.from(root.querySelectorAll(".team_list"));

    lists.forEach((list) => {
        const children = Array.from(list.children);
        const ctas = children.filter((el) => el.classList.contains("team_cta"));
        const others = children.filter((el) => !el.classList.contains("team_cta"));

        shuffleInPlace(others);

        // Re-append shuffled others first, CTA(s) last
        others.forEach((el) => list.appendChild(el));
        ctas.forEach((el) => list.appendChild(el));
    });

    /* ---- 2. Wire Motion for all non-CTA team cards ---- */

    const items = Array.from(
        root.querySelectorAll(".team_item") // CTA is .team_cta, so excluded
    );
    if (!items.length) return;

    const coarseQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const isCoarsePointer = coarseQuery.matches;

    items.forEach((item) => {
        const media = item.querySelector(".team_item-media");
        if (!media) return;

        const img1 = media.querySelector(".team_item-media-img.is-1");
        const img2 = media.querySelector(".team_item-media-img.is-2");
        const img3 = media.querySelector(".team_item-media-img.is-3");
        const bio = media.querySelector(".team_item-bio");

        if (!img1 || !img2 || !img3 || !bio) return;

        setupStack(media, img1, img2, img3, bio);

        wireInteractions(
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
    });
}