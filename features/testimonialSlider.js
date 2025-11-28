let cleanupFns = []

export function init() {
    const scope = document.querySelector('.section_test')
    if (!scope) return

    destroy()

    const emblaNode = scope.querySelector('.embla')
    if (!emblaNode || typeof EmblaCarousel !== 'function') return

    const options = {
        loop: false,
        dragFree: false,
        skipSnaps: true,
        duration: 35,
        breakpoints: {
            '(max-width: 767px)': { skipSnaps: false, duration: 25 },
            '(pointer: coarse)': { skipSnaps: false, duration: 25 }
        }
    }

    const emblaApi = EmblaCarousel(emblaNode, options)

    const setGrabbing = (on) => emblaNode.classList.toggle('is-grabbing', on)

    const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        setGrabbing(true)
    }

    const onPointerUpOrCancel = () => setGrabbing(false)

    emblaNode.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUpOrCancel, { passive: true })
    emblaNode.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true })
    emblaNode.addEventListener('mouseleave', onPointerUpOrCancel, { passive: true })

    cleanupFns.push(() => emblaApi.destroy?.())
    cleanupFns.push(() => emblaNode.removeEventListener('pointerdown', onPointerDown))
    cleanupFns.push(() => window.removeEventListener('pointerup', onPointerUpOrCancel))
    cleanupFns.push(() => emblaNode.removeEventListener('pointercancel', onPointerUpOrCancel))
    cleanupFns.push(() => emblaNode.removeEventListener('mouseleave', onPointerUpOrCancel))
}

export function destroy() {
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn()
        } catch (err) {
            console.warn('testimonialSlider destroy', err)
        }
    })
    cleanupFns = []
}
