import {
    scroll,
    motionValue,
    springValue,
    styleEffect,
    transformValue,
} from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const sections = document.querySelectorAll(".hero_pastallax");
    if (!sections.length) return;

    // Extra translateY over full scroll range
    const BACK_DELTA_PX = 125;
    const FRONT_DELTA_PX = 50;

    const SPRING_CONFIG = {
        stiffness: 100,
        damping: 30,
        mass: 1,
        restDelta: 0.001,
    };

    const SCROLL_OFFSET = ["start end", "end start"];

    sections.forEach((section) => {
        const images = section.querySelectorAll("img");
        if (images.length < 3) return;

        const back = images[0];
        const mid = images[1];
        const front = images[2];

        const backComputed = getComputedStyle(back).transform;
        const frontComputed = getComputedStyle(front).transform;

        const backBase =
            backComputed && backComputed !== "none" ? backComputed : "";
        const frontBase =
            frontComputed && frontComputed !== "none" ? frontComputed : "";

        back.style.willChange = "transform";
        front.style.willChange = "transform";

        // Our "relative progress" value
        const progress = motionValue(0);
        const smoothProgress = springValue(progress, SPRING_CONFIG);

        const backTransform = transformValue(() => {
            const p = smoothProgress.get();
            const extra = BACK_DELTA_PX * p;

            return backBase
                ? `${backBase} translate3d(0, ${extra}px, 0)`
                : `translate3d(0, ${extra}px, 0)`;
        });

        const frontTransform = transformValue(() => {
            const p = smoothProgress.get();
            const extra = FRONT_DELTA_PX * p;

            return frontBase
                ? `${frontBase} translate3d(0, ${extra}px, 0)`
                : `translate3d(0, ${extra}px, 0)`;
        });

        styleEffect(back, { transform: backTransform });
        styleEffect(front, { transform: frontTransform });

        // === Scroll → progress mapping with "no move before scroll" ===

        const startScrollY = window.scrollY;
        let hasUserScrolled = false;
        let initialProgress = 0;

        scroll(
            (p) => {
                const currentScrollY = window.scrollY;
                const deltaY = currentScrollY - startScrollY;

                // Ignore Motion's layout noise until actual scroll
                if (!hasUserScrolled) {
                    if (Math.abs(deltaY) < 1) {
                        // Hard lock to CSS position
                        if (progress.get() !== 0) progress.set(0);
                        return;
                    }

                    hasUserScrolled = true;
                    initialProgress = p;
                }

                let relative = p - initialProgress;

                if (relative < 0) relative = 0;
                if (relative > 1) relative = 1;

                progress.set(relative);
            },
            {
                target: section,
                offset: SCROLL_OFFSET,
            }
        );
    });
}