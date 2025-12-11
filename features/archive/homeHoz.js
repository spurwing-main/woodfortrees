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

    const items = Array.from(list.children).filter((el) => el.nodeType === 1);
    if (!items.length) return;

    const root = document.documentElement;

    const targetX = motionValue(0);
    const smoothX = springValue(targetX, {
        stiffness: 600,
        damping: 45,
        mass: 0.3
    });

    list.style.willChange = "transform";
    styleEffect(list, { x: smoothX });

    let totalDistance = 0;
    let scrollStart = 0;
    let scrollEnd = 0;
    let lastViewportWidth = 0;
    let lastViewportHeight = 0;

    function toPx(raw, viewportHeight, rootFontSize) {
        if (!raw) return 0;
        raw = raw.trim();
        if (raw.endsWith("vh")) {
            const v = parseFloat(raw) || 0;
            return (v / 100) * viewportHeight;
        }
        if (raw.endsWith("rem")) {
            const v = parseFloat(raw) || 0;
            return v * (rootFontSize || 16);
        }
        return parseFloat(raw) || 0;
    }

    function measure() {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

        if (viewportWidth === lastViewportWidth && viewportHeight === lastViewportHeight) {
            return;
        }
        lastViewportWidth = viewportWidth;
        lastViewportHeight = viewportHeight;

        const firstRect = items[0].getBoundingClientRect();
        const itemWidth = firstRect.width || items[0].offsetWidth;
        const cardHeight = firstRect.height || items[0].offsetHeight;
        if (!itemWidth || !cardHeight) return;

        const listStyles = getComputedStyle(list);
        const layoutStyles = getComputedStyle(layout);
        const rootStyles = getComputedStyle(root);

        const gap = parseFloat(listStyles.columnGap || listStyles.gap || "0") || 0;
        const count = items.length;

        const cols = parseFloat(layoutStyles.getPropertyValue("--slider--cols")) || 0;

        const layoutRect = layout.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();

        const padL = parseFloat(layoutStyles.paddingLeft || "0") || 0;
        const padR = parseFloat(layoutStyles.paddingRight || "0") || 0;
        const padT = parseFloat(layoutStyles.paddingTop || "0") || 0;

        // Center card between nav and bottom
        const navHeightPx = toPx(
            rootStyles.getPropertyValue("--nav--height"),
            viewportHeight,
            parseFloat(rootStyles.fontSize) || 16
        );
        const usableHeight = viewportHeight - navHeightPx;
        const stickyTopPx = navHeightPx + usableHeight / 2 - cardHeight / 2;
        list.style.top = `${stickyTopPx}px`;

        // Horizontal distance: match CSS calc
        const innerWidth = layoutRect.width - padL - padR;
        const containerWidth =
            cols > 0
                ? cols * itemWidth + Math.max(0, cols - 1) * gap
                : innerWidth || viewportWidth;

        const step = itemWidth + gap;
        const maxShift = (count - 1) * step + itemWidth - containerWidth;
        totalDistance = Math.max(0, maxShift);

        const scrollY = window.scrollY || window.pageYOffset || 0;
        const layoutTopAbs = scrollY + layoutRect.top;
        const listOffsetInLayout = (listRect.top - layoutRect.top) - padT;
        const listHeight = listRect.height || list.offsetHeight || 0;

        // When scrollY === scrollStart, list just hits stickyTopPx
        scrollStart = layoutTopAbs + padT + listOffsetInLayout - stickyTopPx;

        // Make sticky span == totalDistance
        const layoutHeight =
            totalDistance > 0 && listHeight > 0
                ? totalDistance + listHeight + padT + listOffsetInLayout
                : layoutRect.height || viewportHeight;

        layout.style.height = `${layoutHeight}px`;

        const stickySpan = layoutHeight - listHeight - (padT + listOffsetInLayout);
        scrollEnd = scrollStart + stickySpan;
    }

    measure();
    resize(measure);
    window.addEventListener("load", measure, { once: true });

    scroll(
        (_, info) => {
            if (!totalDistance) {
                targetX.set(0);
                return;
            }

            const y = info.y.current;
            const span = scrollEnd - scrollStart || 1;

            let progress = (y - scrollStart) / span;
            if (progress < 0) progress = 0;
            else if (progress > 1) progress = 1;

            targetX.set(-progress * totalDistance);
        },
        { axis: "y" }
    );
}