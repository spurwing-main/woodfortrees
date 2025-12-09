import {
    scroll,
    motionValue,
    springValue,
    styleEffect,
    resize
} from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const layout = document.querySelector(".slider_layout");
    const list = document.querySelector(".slider_list");

    if (!layout || !list) return;

    const items = Array.from(list.children);
    if (!items.length) return;

    const section = layout.closest(".section_slider") || layout;

    // Target driven directly by scroll
    const targetX = motionValue(0);

    // Very light smoothing: just enough to hide wheel tearing
    const smoothX = springValue(targetX, {
        stiffness: 240, // quick to respond
        damping: 24,    // enough to avoid jitter/overshoot
        mass: 0.5       // light, so it doesn’t feel heavy/laggy
    });

    styleEffect(list, { x: smoothX });

    let totalDistance = 0;
    let stopAt = 1; // scroll progress where horizontal motion finishes

    function computeDistances() {
        const listStyles = getComputedStyle(list);
        const layoutStyles = getComputedStyle(layout);
        const firstItem = items[0];
        const itemRect = firstItem.getBoundingClientRect();

        const itemWidth = itemRect.width;
        const itemHeight = itemRect.height;
        const gap = parseFloat(listStyles.columnGap || listStyles.gap || "0");
        const count = items.length;
        const viewportWidth = window.innerWidth;

        // Read how many columns/cards the layout shows
        const colsRaw = layoutStyles.getPropertyValue("--slider--cols");
        const cols = parseFloat(colsRaw) || 0;

        // Your requested formula, with a safety clamp
        let extraCards = cols;
        
        console.log('extraCards:', extraCards);

        const fullWidth = (itemWidth + gap) * (count + extraCards) - gap;
        totalDistance = Math.max(0, fullWidth - viewportWidth);

        // Scroll distance driving the animation
        const layoutHeight = totalDistance + window.innerHeight;
        layout.style.height = `${layoutHeight}px`;

        // Section height used by scroll progress 0–1
        const sectionRect = section.getBoundingClientRect();
        const sectionHeight = sectionRect.height || layoutHeight;

        // End horizontal motion one card-height before the end
        const padFraction = itemHeight / sectionHeight;
        stopAt = 1 - padFraction;

        if (!isFinite(stopAt) || stopAt <= 0.1) {
            stopAt = 1;
        }
    }

    computeDistances();
    resize(() => {
        computeDistances();
    });

    scroll((progress) => {
        // progress: 0 → 1 over ["start center", "end center"]
        // Only animate over 0..stopAt, then freeze.
        let clamped = progress;
        if (clamped > stopAt) clamped = stopAt;

        const activeProgress = clamped / stopAt;
        targetX.set(-activeProgress * totalDistance);
    }, {
        target: section,
        axis: "y",
        offset: ["start center", "end center"]
    });
}