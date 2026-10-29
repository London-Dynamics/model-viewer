/**
 * Loads ld-ui.css into a preceding <style type="text/tailwindcss"> block so the
 * Tailwind Play CDN can process @apply rules. Must run before @tailwindcss/browser.
 */
(function () {
  const style = document.currentScript?.previousElementSibling;
  if (!style || style.getAttribute('type') !== 'text/tailwindcss') {
    console.error('[ld-ui-loader] expected a preceding style[type="text/tailwindcss"]');
    return;
  }

  const href =
    document.currentScript?.getAttribute('data-href') ||
    '../../styles/ld-ui.css';
  const xhr = new XMLHttpRequest();
  xhr.open('GET', href, false);
  xhr.send();

  if (xhr.status === 200 || xhr.status === 0) {
    style.textContent = xhr.responseText;
  } else {
    console.error('[ld-ui-loader] failed to load', href, xhr.status);
  }
})();
