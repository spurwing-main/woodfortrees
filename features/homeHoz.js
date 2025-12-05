import { scroll, motionValue, springValue, styleEffect, resize }
    from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const layout = document.querySelector(".slider_layout");
    const list = document.querySelector(".slider_list");
    const items = [...list.children];

    const targetX = motionValue(0);
    const smoothX = springValue(targetX, {
        stiffness: 120,
        damping: 20,
        mass: 0.25
    });

    styleEffect(list, { x: smoothX });

    function computeDistance() {
        const styles = getComputedStyle(list);

        const itemWidth = items[0].getBoundingClientRect().width;
        const gap = parseFloat(styles.columnGap || styles.gap || 0);
        const count = items.length;

        // *** NEW: Add one extra card-width worth of scroll ***
        const fullWidth =
            (itemWidth + gap) * (count + 1) - gap;

        const viewportWidth = window.innerWidth;

        const distance = Math.max(0, fullWidth - viewportWidth);

        layout.style.height = `${distance}px`;

        return distance;
    }

    let totalDistance = computeDistance();

    resize(() => {
        totalDistance = computeDistance();
    });

    scroll((progress, info) => {
        const yProgress = info.y.progress;
        targetX.set(-yProgress * totalDistance);
    }, {
        target: layout,
        offset: ["start start", "end end"]
    });
}