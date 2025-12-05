import { maxWidthQuery } from '../utils/breakpoints.js'

let cleanupFns = []
let emblaApi = null

export function init() {
    const scope = document.querySelector('.how_list-wrap.embla')
    if (!scope || typeof EmblaCarousel !== 'function') return

    destroy()

    const container = scope.querySelector('.embla__container')
    if (!container) return

    const query = maxWidthQuery('tablet') || '(max-width: 991px)'
    const mql = window.matchMedia(query)

    const options = {
        loop: false,
        align: 'start',
        dragFree: false,
        skipSnaps: false,
        duration: 24,
        breakpoints: {
            '(min-width: 768px)': { skipSnaps: true, duration: 32 }
        }
    }

    const setGrabbing = (on) => scope.classList.toggle('is-grabbing', on)

    const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        setGrabbing(true)
    }

    const onPointerUpOrCancel = () => setGrabbing(false)

    const attachPointerHandlers = () => {
        scope.addEventListener('pointerdown', onPointerDown, { passive: true })
        window.addEventListener('pointerup', onPointerUpOrCancel, { passive: true })
        scope.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true })
        scope.addEventListener('mouseleave', onPointerUpOrCancel, { passive: true })

        cleanupFns.push(() => scope.removeEventListener('pointerdown', onPointerDown))
        cleanupFns.push(() => window.removeEventListener('pointerup', onPointerUpOrCancel))
        cleanupFns.push(() => scope.removeEventListener('pointercancel', onPointerUpOrCancel))
        cleanupFns.push(() => scope.removeEventListener('mouseleave', onPointerUpOrCancel))
    }

    const disable = () => {
        if (emblaApi) {
            emblaApi.destroy?.()
            emblaApi = null
        }
        setGrabbing(false)
        scope.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('pointerup', onPointerUpOrCancel)
        scope.removeEventListener('pointercancel', onPointerUpOrCancel)
        scope.removeEventListener('mouseleave', onPointerUpOrCancel)
    }

    const enable = () => {
        if (emblaApi) return
        emblaApi = EmblaCarousel(scope, options)
        attachPointerHandlers()
    }

    const sync = () => {
        if (mql.matches) {
            enable()
        } else {
            disable()
        }
    }

    mql.addEventListener('change', sync)
    cleanupFns.push(() => mql.removeEventListener('change', sync))
    cleanupFns.push(() => disable())

    sync()
}

export function destroy() {
    if (emblaApi) {
        emblaApi.destroy?.()
        emblaApi = null
    }
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn()
        } catch (err) {
            console.warn('howSlider destroy', err)
        }
    })
    cleanupFns = []
}
