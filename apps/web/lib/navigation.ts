'use client'

// Going somewhere, from code rather than from a link.
//
// The panel used to own a hash router, so `navigate('/tasks')` meant setting
// `location.hash`. Next owns routing now, and a component inside a page should
// use `useRouter()` — a client-side transition that keeps the query cache, the
// scroll position and the open dialog.
//
// This is for the handful of places that navigate outside a component's render
// (a menu action, a keyboard handler in a module). It is a real navigation, not
// a transition; the pages that use it come back in the phases that port them,
// and each will take the router directly.

export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(path)
}
