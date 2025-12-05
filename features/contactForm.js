function handleFormPage() {
    const form = document.querySelector('#email-form')
    if (!form) return

    form.addEventListener('submit', (event) => {
        event.preventDefault()

        const redirect =
            (form.dataset.redirect || form.getAttribute('redirect') || '').trim()
        const expectedRedirect = '/contact/success'

        if (!redirect) {
            console.warn('[contactForm] missing redirect target')
            return
        }

        if (redirect !== expectedRedirect) {
            console.warn(
                `[contactForm] unexpected redirect target: "${redirect}" (expected "${expectedRedirect}")`
            )
            return
        }

        const data = new FormData(form)
        const params = new URLSearchParams()

        for (const [key, value] of data.entries()) {
            if (typeof value === 'string') {
                params.append(key, value.trim())
            } else if (value?.name) {
                params.append(key, value.name)
            }
        }

        window.location.href = `${redirect}?${params.toString()}`
    })
}

function handleSuccessPage() {
    const params = new URLSearchParams(window.location.search)
    const name = params.get('name')?.trim()
    if (!name) return

    const el = document.querySelector('.section_success .title-m')
    if (!el) return

    el.textContent =
        el.textContent.trim().replace(/\.*$/, '') + ', ' + name + '.'
}

export function init() {
    const path = window.location.pathname

    if (path.includes('/contact/success')) {
        handleSuccessPage()
    } else if (path.includes('/contact')) {
        handleFormPage()
    }
}
