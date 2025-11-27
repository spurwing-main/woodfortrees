import { animate } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm"

let cleanupFns = []

export function init() {
    const root = document.querySelector(".section_expert")
    if (!root) return

    // Clean up previous mount if called twice
    destroy()

    const tabs = Array.from(
        root.querySelectorAll(".expert_text-list .expert_text-item")
    )
    const panels = Array.from(
        root.querySelectorAll(".expert_content-list .expert_content-item")
    )

    if (!tabs.length || !panels.length) return

    const total = Math.min(tabs.length, panels.length)

    // Initial active index from DOM, fallback to 0
    let activeIndex = tabs.findIndex((tab) => tab.classList.contains("is-active"))
    if (activeIndex < 0 || activeIndex >= total) activeIndex = 0

    // Base state
    tabs.forEach((tab, index) => {
        const isActive = index === activeIndex
        tab.classList.toggle("is-active", isActive)
        tab.setAttribute("aria-selected", isActive ? "true" : "false")
        tab.style.cursor = "pointer"
    })

    panels.forEach((panel, index) => {
        const isActive = index === activeIndex
        panel.setAttribute("aria-hidden", isActive ? "false" : "true")
        panel.style.opacity = isActive ? "1" : "0"
        panel.style.pointerEvents = isActive ? "auto" : "none"
        panel.style.transform = isActive ? "translateY(0px)" : "translateY(12px)"
        panel.style.filter = isActive ? "blur(0px)" : "blur(8px)"
    })

    function showPanel(index) {
        const panel = panels[index]
        if (!panel) return

        panel.setAttribute("aria-hidden", "false")
        panel.style.pointerEvents = "auto"

        // start low, blurred, transparent
        panel.style.opacity = "0"
        panel.style.transform = "translateY(12px)"
        panel.style.filter = "blur(8px)"

        animate(
            panel,
            {
                opacity: 1,
                transform: "translateY(0px)",
                filter: "blur(0px)"
            },
            {
                type: "spring",
                visualDuration: 0.45,
                bounce: 0.3
            }
        )
    }

    function hidePanel(index) {
        const panel = panels[index]
        if (!panel) return

        panel.setAttribute("aria-hidden", "true")
        panel.style.pointerEvents = "none"

        animate(
            panel,
            {
                opacity: 0,
                transform: "translateY(-12px)",
                filter: "blur(18px)"
            },
            {
                type: "spring",
                visualDuration: 0.35,
                bounce: 0.18
            }
        )
    }

    function setActive(nextIndex) {
        if (nextIndex === activeIndex) return
        if (nextIndex < 0 || nextIndex >= total) return

        hidePanel(activeIndex)
        showPanel(nextIndex)

        tabs.forEach((tab, index) => {
            const isActive = index === nextIndex
            tab.classList.toggle("is-active", isActive)
            tab.setAttribute("aria-selected", isActive ? "true" : "false")
        })

        activeIndex = nextIndex
    }

    // Click-only interaction
    tabs.forEach((tab, index) => {
        const onClick = (event) => {
            event.preventDefault()
            setActive(index)
        }

        tab.addEventListener("click", onClick)
        cleanupFns.push(() => tab.removeEventListener("click", onClick))
    })
}

export function destroy() {
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn()
        } catch (err) {
            console.warn("expertTabs destroy", err)
        }
    })
    cleanupFns = []
}