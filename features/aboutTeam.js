import { animate, hover } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

/* -------------------------------
   motion config
-------------------------------- */

const springIn = {
    type: "spring",
    visualDuration: 0.4,
    bounce: 0.3,
};

const springOut = {
    type: "spring",
    visualDuration: 0.3,
    bounce: 0.15,
};

const hoverIntentDelayMs = 250;
const stackEnterY = -24;
const stackEnterScale = 0.96;
const stackExitY = 12;
const stackExitScale = 0.97;

/* -------------------------------
   reduced motion
-------------------------------- */

const reduceMotionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduceMotion = reduceMotionMediaQuery.matches;

reduceMotionMediaQuery.addEventListener("change", (event) => {
    reduceMotion = event.matches;
});

/* -------------------------------
   shared animation control
-------------------------------- */

const activeAnimations = new WeakMap();

function stopAnimation(element) {
    const controls = activeAnimations.get(element);
    if (!controls) return;

    try {
        controls.stop();
    } catch {
        // ignore already-stopped animations
    }

    activeAnimations.delete(element);
}

function animateImage(element, keyframes, options) {
    if (reduceMotion) {
        const finalOpacity = Array.isArray(keyframes.opacity)
            ? keyframes.opacity[keyframes.opacity.length - 1]
            : keyframes.opacity ?? 1;

        const finalTransform = Array.isArray(keyframes.transform)
            ? keyframes.transform[keyframes.transform.length - 1]
            : keyframes.transform ?? "";

        element.style.opacity = String(finalOpacity);
        if (finalTransform) element.style.transform = finalTransform;
        return Promise.resolve();
    }

    stopAnimation(element);

    element.style.willChange = "transform, opacity";

    const controls = animate(element, keyframes, options);
    activeAnimations.set(element, controls);

    return Promise.resolve(controls)
        .catch(() => { })
        .then(() => {
            if (activeAnimations.get(element) === controls) {
                activeAnimations.delete(element);
                element.style.willChange = "auto";
            }
        });
}

/* -------------------------------
   public init
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
   base transforms
-------------------------------- */

function captureBaseTransform(image) {
    const transform = getComputedStyle(image).transform;
    image.dataset.baseTransform = transform === "none" ? "" : transform;
}

function baseTransform(image) {
    return image.dataset.baseTransform || "";
}

function composeTransform(image, dy, scale) {
    const base = baseTransform(image);
    const extra = ` translateY(${dy}px) scale(${scale})`;
    return base + extra;
}

/* -------------------------------
   initial stack layout
-------------------------------- */

function setupStack(media, img1, img2, img3) {
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
            willChange: "transform, opacity",
            zIndex: String(1 + index),
        });
    });

    // top card visible on load
    img1.style.opacity = "1";
    img1.style.visibility = "visible";
    img1.style.transform = composeTransform(img1, 0, 1);

    // others hidden above, ready to drop
    [img2, img3].forEach((image) => {
        image.style.opacity = "0";
        image.style.visibility = "hidden";
        image.style.transform = composeTransform(image, stackEnterY, stackEnterScale);
    });
}

/* -------------------------------
   state + interactions
   state 0: only img1
   state 1: img1 + img2
   state 2: img1 + img2 + img3
-------------------------------- */

function wireInteractions(media, img1, img2, img3) {
    let state = 0;
    let moveHandler = null;
    let rafId = null;
    let pendingY = null;
    let intentZone = 0; // 0 = base, 1 = top half, 2 = bottom half
    let intentTimerId = null;

    function clearIntent() {
        if (intentTimerId) {
            clearTimeout(intentTimerId);
            intentTimerId = null;
        }
        intentZone = 0;
    }

    function clearHoverState() {
        if (moveHandler) {
            media.removeEventListener("pointermove", moveHandler);
            moveHandler = null;
        }
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingY = null;
        clearIntent();
    }

    function pointerZoneForY(clientY) {
        const rect = media.getBoundingClientRect();
        const y = clientY - rect.top;

        if (y < 0 || y > rect.height) return 0;
        return y < rect.height / 2 ? 1 : 2;
    }

    function setIntentZone(zone) {
        if (zone === intentZone) return;

        intentZone = zone;

        if (intentTimerId) {
            clearTimeout(intentTimerId);
            intentTimerId = null;
        }

        if (zone === 0) return;

        intentTimerId = setTimeout(() => {
            intentTimerId = null;
            goToState(zone);
        }, hoverIntentDelayMs);
    }

    function processPointerY(clientY) {
        const zone = pointerZoneForY(clientY);
        setIntentZone(zone);
    }

    function goToState(nextState) {
        if (nextState === state) return;

        switch (nextState) {
            case 0: {
                hideImage(img3, 0);
                hideImage(img2, 0.05);
                break;
            }
            case 1: {
                if (state === 0) {
                    showImage(img2, 0);
                } else if (state === 2) {
                    hideImage(img3, 0);
                }
                break;
            }
            case 2: {
                if (state === 0) {
                    showImage(img2, 0);
                    showImage(img3, 0.06);
                } else if (state === 1) {
                    showImage(img3, 0);
                }
                break;
            }
            default:
                return;
        }

        state = nextState;
    }

    hover(media, (element, startEvent) => {
        processPointerY(startEvent.clientY);

        moveHandler = (event) => {
            pendingY = event.clientY;
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (pendingY == null) return;
                processPointerY(pendingY);
            });
        };

        media.addEventListener("pointermove", moveHandler);

        return () => {
            clearHoverState();
            goToState(0);
        };
    });
}

/* -------------------------------
   show / hide helpers
-------------------------------- */

function showImage(image, delay = 0) {
    image.style.visibility = "visible";

    return animateImage(
        image,
        {
            opacity: [0, 1],
            transform: [
                composeTransform(image, stackEnterY, stackEnterScale),
                composeTransform(image, 0, 1),
            ],
        },
        {
            ...springIn,
            delay,
        }
    );
}

function hideImage(image, delay = 0) {
    if (image.style.visibility === "hidden") return Promise.resolve();

    return animateImage(
        image,
        {
            opacity: [1, 0],
            transform: [
                composeTransform(image, 0, 1),
                composeTransform(image, stackExitY, stackExitScale),
            ],
        },
        {
            ...springOut,
            delay,
        }
    ).then(() => {
        image.style.visibility = "hidden";
        image.style.transform = composeTransform(image, stackEnterY, stackEnterScale);
    });
}