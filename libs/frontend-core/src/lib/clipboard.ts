// One clipboard write for the whole app. The async clipboard API is absent on
// insecure origins and old browsers — the textarea trick is the only fallback
// that still works there, and every call site needs it, not just the first one
// that remembered.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}
