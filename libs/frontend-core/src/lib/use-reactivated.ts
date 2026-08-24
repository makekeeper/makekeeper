import { onActivated } from 'vue';

// Run something every time a `<KeepAlive>`d component comes back — but NOT the
// first time, when `onMounted` has already just run it (#266).
//
// A section layout keeps its panes alive, which is what makes a half-filled
// form survive a look at another section. The cost is that a panel's
// `onMounted` fetch happens exactly once for the life of the page, so anything
// that can change elsewhere goes stale while the section is closed. Every
// caller answering that with its own `let first = true` writes the same bug in
// a different place: Vue fires `activated` on the initial mount too.
export function onReactivated(callback: () => void): void {
  let mounted = false;
  onActivated(() => {
    if (!mounted) {
      mounted = true;
      return;
    }
    callback();
  });
}
