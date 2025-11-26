import { animate } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

const SPRING_IN = {
    type: "spring",
    stiffness: 900,
    damping: 36,
    mass: 1,
};

const SPRING_OUT = {
    type: "spring",
    stiffness: 900,
    damping: 32,
    mass: 0.9,
};

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

/* ----------------------------------------
   BASE SETUP
---------------------------------------- */

function captureBaseTransform(img) {
    const cs = getComputedStyle(img);
    const t = cs.transform === "none" ? "" : cs.transform;
    img.dataset.baseTransform = t;
}

function baseTransform(img) {
    return img.dataset.baseTransform || "";
}

function composeTransform(img, dy, scale) {
    const base = baseTransform(img);
    const extra = ` translateY(${dy}px) scale(${scale})`;
    return (base ? base : "") + extra;
}

function setupStack(media, img1, img2, img3) {
    media.style.position = media.style.position || "relative";
    // show rotated edges
    media.style.overflow = "visible";

    [img1, img2, img3].forEach((img, i) => {
        captureBaseTransform(img);

        Object.assign(img.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            willChange: "transform, opacity",
            transformOrigin: "center center",
            zIndex: String(1 + i), // 1 = base, 2 = mid, 3 = top
        });
    });

    // is-1 visible on load, keep its rotation
    img1.style.opacity = "1";
    img1.style.visibility = "visible";
    img1.style.transform = composeTransform(img1, 0, 1);

    // is-2 and is-3 hidden just above, ready to drop, keep their rotations
    [img2, img3].forEach((img) => {
        img.style.opacity = "0";
        img.style.visibility = "hidden";
        img.style.transform = composeTransform(img, -24, 0.96);
    });
}

/* ----------------------------------------
   INTERACTION + STATE
   state 0: only is-1
   state 1: is-1 + is-2
   state 2: is-1 + is-2 + is-3
---------------------------------------- */

function wireInteractions(media, img1, img2, img3) {
    let state = 0;

    function goTo(nextState, { fromEnter = false } = {}) {
        if (nextState === state) return;

        if (nextState === 0) {
            // Reset to just base image
            hideImage(img3, 0);
            hideImage(img2, 0.05);
        } else if (nextState === 1) {
            // Top half: show second, hide third
            showImage(img2, 0);
            hideImage(img3, 0);
        } else if (nextState === 2) {
            // Bottom half: show second and third
            if (state === 0 && fromEnter) {
                // Started directly in bottom half → drop both together (tiny stagger)
                showImage(img2, 0);
                showImage(img3, 0.06);
            } else {
                if (state === 0) showImage(img2, 0);
                showImage(img3, 0);
            }
        }

        state = nextState;
    }

    function pointerStateForEvent(e) {
        const rect = media.getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (y < 0 || y > rect.height) return null;

        const halfway = rect.height / 2;
        return y < halfway ? 1 : 2;
    }

    media.addEventListener("pointerenter", (e) => {
        const s = pointerStateForEvent(e);
        if (s == null) return;
        goTo(s, { fromEnter: true });
    });

    media.addEventListener("pointermove", (e) => {
        const s = pointerStateForEvent(e);
        if (s == null) return;
        goTo(s);
    });

    media.addEventListener("pointerleave", () => {
        goTo(0);
    });
}

/* ----------------------------------------
   ANIMATION HELPERS
   (keep base rotation, animate offset+scale)
---------------------------------------- */

function showImage(img, delay = 0) {
    img.style.visibility = "visible";

    animate(
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
    if (img.style.visibility === "hidden") return;

    const controls = animate(
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
    );

    controls.finished.then(() => {
        img.style.visibility = "hidden";
        // Reset back up ready for the next "drop"
        img.style.transform = composeTransform(img, -24, 0.96);
    });
}