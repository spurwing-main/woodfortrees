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

    const targetX = motionValue(0);

    // Light smoothing: hides wheel steps but stays snappy
    const smoothX = springValue(targetX, {
        stiffness: 600,
        damping: 50,
        mass: 0.25
    });

    // Hint GPU transform
    list.style.willChange = "transform";
    styleEffect(list, { x: smoothX });

    let totalDistance = 0;
    let scrollStart = 0;
    let scrollEnd = 0;

    function computeDistances() {
        const listStyles = getComputedStyle(list);
        const layoutStyles = getComputedStyle(layout);

        const firstItem = items[0];
        const rect = firstItem.getBoundingClientRect();

        const itemWidth = rect.width;
        const itemHeight = rect.height;
        if (!itemWidth || !itemHeight) return;

        const gap =
            parseFloat(listStyles.columnGap || listStyles.gap || "0") || 0;
        const count = items.length;
        const viewportWidth = window.innerWidth;

        // How many cards are visible (from CSS var)
        const colsRaw = layoutStyles.getPropertyValue("--slider--cols");
        const cols = parseFloat(colsRaw) || 0;

        // Scroll past the visible set by this many extra cards
        const extraCards = cols > 0 ? cols : 0;

        const fullWidth = (itemWidth + gap) * (count + extraCards) - gap;
        totalDistance = Math.max(0, fullWidth - viewportWidth);

        // Layout scroll span: pinned duration = totalDistance
        const layoutHeight = totalDistance + window.innerHeight;
        layout.style.height = `${layoutHeight}px`;

        const scrollY =
            window.scrollY || window.pageYOffset || 0;

        const layoutRect = layout.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();

        // Convert sticky top (33vh etc) to px
        const rawTop = listStyles.top || "0";
        let stickyTopPx = 0;

        if (rawTop.endsWith("vh")) {
            const vh = parseFloat(rawTop) || 0;
            stickyTopPx = (vh / 100) * window.innerHeight;
        } else {
            stickyTopPx = parseFloat(rawTop) || 0;
        }

        // Absolute Y of layout top
        const layoutTopY = scrollY + layoutRect.top;

        // Offset of list inside layout (in px)
        const listOffsetInLayout = listRect.top - layoutRect.top;

        // When scrollY === scrollStart, list's top === stickyTopPx
        scrollStart = layoutTopY + listOffsetInLayout - stickyTopPx;
        if (!isFinite(scrollStart)) scrollStart = layoutTopY;

        // Vertical scroll span is exactly totalDistance
        scrollEnd = scrollStart + totalDistance;
    }

    computeDistances();
    resize(computeDistances);

    scroll((_, info) => {
        const y = info.y.current;

        const span = scrollEnd - scrollStart;
        let progress = 0;

        if (span > 0) {
            progress = (y - scrollStart) / span;
            // clamp 0–1
            if (progress < 0) progress = 0;
            else if (progress > 1) progress = 1;
        }

        // 0 -> no movement, 1 -> fullDistance
        targetX.set(-progress * totalDistance);
    }, {
        axis: "y"
    });
}