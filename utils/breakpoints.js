// breakpoints: mobilePortrait < mobileLandscape < tablet < desktop
export const breakpoints = [
    { name: 'mobilePortrait', max: 478 },
    { name: 'mobileLandscape', max: 767 },
    { name: 'tablet', max: 991 },
    { name: 'desktop', max: Infinity }
]

const settleDelay = 140

export function maxWidthQuery(name) {
    const bp = breakpoints.find((it) => it.name === name)
    if (!bp || !Number.isFinite(bp.max)) return null
    return `(max-width: ${bp.max}px)`
}

function widthToBreakpoint(width) {
    return breakpoints.find((bp) => width <= bp.max)?.name ?? 'desktop'
}

let stop

export function init() {
    if (stop) return stop
    if (typeof ResizeObserver !== 'function') return () => {}

    let last = widthToBreakpoint(window.innerWidth)
    let timeoutId = null

    const observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect.width || window.innerWidth)

        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            const next = widthToBreakpoint(width)
            if (next !== last) {
                last = next
                window.dispatchEvent(
                    new CustomEvent('webflow:breakpoint-change', {
                        detail: { breakpoint: next, width }
                    })
                )
            }
        }, settleDelay)
    })

    observer.observe(document.documentElement)

    stop = () => {
        clearTimeout(timeoutId)
        observer.disconnect()
        stop = undefined
    }

    return stop
}
