import {
    scroll,
    motionValue,
    springValue,
    styleEffect,
    transformValue,
} from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    console.log("pastaLlax init");

    const sections = document.querySelectorAll(".hero_pastallax");
    if (!sections.length) return;

    // ===== EXACT VARIANT 1 @ 25% STRENGTH =====
    // Back:  -25px → 100px   (delta +125px)
    // Front:  0px  → 50px    (delta +50px)
    // Mid:   stays on its CSS transform
    const BACK_DELTA_PX = 125;
    const FRONT_DELTA_PX = 50;

    // Same spring feel as React:
    // useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })
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

        // Read CSS starting transforms once
        const backComputed = getComputedStyle(back).transform;
        const frontComputed = getComputedStyle(front).transform;

        const backBase =
            backComputed && backComputed !== "none" ? backComputed : "";
        const frontBase =
            frontComputed && frontComputed !== "none" ? frontComputed : "";

        back.style.willChange = "transform";
        front.style.willChange = "transform";

        // Raw scroll progress 0–1
        const progress = motionValue(0);

        // Smoothed / inertial progress (same feel as useSpring)
        const smoothProgress = springValue(progress, SPRING_CONFIG);

        // Back layer: add 0 → +125px on top of CSS transform
        const backTransform = transformValue(() => {
            const p = smoothProgress.get(); // 0–1
            const extra = BACK_DELTA_PX * p;

            if (backBase) {
                return `${backBase} translate3d(0, ${extra}px, 0)`;
            }
            return `translate3d(0, ${extra}px, 0)`;
        });

        // Front layer: add 0 → +50px on top of CSS transform
        const frontTransform = transformValue(() => {
            const p = smoothProgress.get(); // 0–1
            const extra = FRONT_DELTA_PX * p;

            if (frontBase) {
                return `${frontBase} translate3d(0, ${extra}px, 0)`;
            }
            return `translate3d(0, ${extra}px, 0)`;
        });

        // Bind transforms
        styleEffect(back, { transform: backTransform });
        styleEffect(front, { transform: frontTransform });
        // mid is left alone — pure CSS

        // Link scroll → progress
        scroll(
            (p) => {
                progress.set(p);
            },
            {
                target: section,
                offset: SCROLL_OFFSET,
            }
        );
    });
}