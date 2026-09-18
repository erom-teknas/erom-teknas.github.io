// Native <dialog> helpers: the menu sheet, close buttons, and closing on a
// click outside the dialog's box.

export function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  document.documentElement.style.overflow = 'hidden';
  dialog.addEventListener(
    'close',
    () => {
      document.documentElement.style.overflow = '';
    },
    { once: true }
  );
}

export function initDialogs() {
  const menu = document.getElementById('menu-sheet');
  document.querySelectorAll('[data-open-menu]').forEach((button) => {
    button.addEventListener('click', () => openDialog(menu));
  });

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) {
      close.closest('dialog')?.close();
      return;
    }
    // A click on the backdrop lands on the <dialog> element itself.
    if (event.target instanceof HTMLDialogElement) {
      const box = event.target.getBoundingClientRect();
      const inside =
        event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) event.target.close();
    }
  });

  // Following a link inside the menu should not leave the sheet open when the
  // browser restores the page from the back/forward cache.
  window.addEventListener('pageshow', () => menu?.open && menu.close());
}
