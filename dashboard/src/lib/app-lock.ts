// Shared by the layout (server) and the lock screen (client): a "use client"
// module can't hand plain values to a server component.

export const LOCK_KEY = "dashboard.appLock";
export const LOCK_CLASS = "app-locked";

/** Runs before the page paints (layout.tsx): hides the page while a lock is set on this device. */
export const LOCK_BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem("${LOCK_KEY}")||"null");if(s&&s.credId&&location.pathname.indexOf("/login")!==0)document.documentElement.classList.add("${LOCK_CLASS}")}catch(e){}`;
