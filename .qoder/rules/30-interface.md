---
trigger: glob
glob: ["apps/officine/web/**", "apps/officine/desktop/**"]
---
# Web UI rules

French text, externalized in a messages file. No resource loaded from the internet: fonts, icons and scripts are bundled.

The cashier screen must be fully usable with keyboard and barcode scanner: the scan field always has focus after each action; F2 search, F4 quantity, F8 customer was asking for, F9 payment, Escape removes the current line. Show recalled, expired and prescription alerts directly in the cart, with blocking alerts that cannot be dismissed by a cashier.

Never trust the UI for authorization: hide what a role cannot do, but the server decides. Never use dangerouslySetInnerHTML. Send the CSRF token header on every mutating request. Keep the cart in memory when the server answers 503 or 409 so the cashier can retry.

Design system: Tailwind CSS v4 with shadcn/ui components generated in web/src/components/ui and design tokens as CSS variables in web/src/styles/tokens.css; never hard-code colours in screens. Dark theme by default with a light theme available, one accent colour only; red means blocking, orange means warning, green means success. Thin icon sidebar with Lucide icons, resizable panels, a cmdk command palette on Ctrl+K (Cmd+K on macOS) that only offers actions allowed for the current role, sonner toasts bottom-right for non-blocking feedback, motion transitions of 150 to 200 ms that respect reduced-motion, virtualized lists above 100 rows, and explicit loading, empty, error and offline states on every screen.

Desktop app (Tauri 2, Rust): load only the paired server origin; verify the server certificate against the paired local CA in Rust before opening the window and on every reconnection; expose exactly three commands to that origin through remote capabilities: print_receipt, open_cash_drawer, device_info; validate their arguments in Rust; block navigation to any other origin; enable only the updater, single-instance and window-state plugins; never enable shell, fs or http plugins; updates are Ed25519-signed and served by the local server.

Meet WCAG 2.2 AA contrast; the sale total is displayed in very large type. Display times in Africa/Douala; amounts as integer XAF with a thin space as thousands separator.
