// Utility: sanitize untrusted HTML fragments for UI and content scripts.
(function(global) {
  const ALLOWED_TAGS = [
    'b', 'i', 'em', 'strong', 'u', 's',
    'p', 'br', 'blockquote',
    'div', 'span', 'section', 'article',
    'ul', 'ol', 'li',
    'code', 'pre', 'kbd', 'samp',
    'a',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'hr',
    'img'
  ];
  const ALLOWED_ATTR = ['href', 'class', 'style', 'colspan', 'rowspan', 'scope', 'src', 'alt', 'width', 'height', 'start'];
  const ALLOWED_URI_REGEXP = /^(https?:|mailto:|tel:|#)/i;
  // The only image form allowed: a diagram saved as an inline SVG data URL (it runs no
  // script as an <img>). Remote or any other image sources are dropped below.
  const SVG_DATA_IMG_RE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
  // Plain numbers are allowed too (start, width, height, colspan, rowspan): DOMPurify checks every
  // attribute value that is not on its own safe list against this expression. A bare number can
  // not be a link target worth keeping: anchors are re-checked below, images by SVG_DATA_IMG_RE.
  const PURIFY_URI_REGEXP = /^(?:(?:https?|mailto|tel):|#|data:image\/svg\+xml;base64,|\d+$)/i;

  const keepOnlySvgDataImages = (container) => {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('img').forEach((img) => {
      if (!SVG_DATA_IMG_RE.test(img.getAttribute('src') || '')) img.remove();
    });
  };

  const ensureAnchorAttributes = (container) => {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('a').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && ALLOWED_URI_REGEXP.test(href)) {
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.setAttribute('target', '_blank');
      } else {
        anchor.removeAttribute('href');
      }
    });
  };

  const parseHtml = (value) => {
    if (typeof DOMParser === 'undefined') return null;
    try {
      const parser = new DOMParser();
      return parser.parseFromString(String(value || ''), 'text/html');
    } catch (_) {
      return null;
    }
  };

  const fallbackSanitize = (dirty) => {
    if (!dirty) return '';
    const doc = global.document;
    if (!doc) return String(dirty);
    const temp = doc.createElement('div');
    temp.textContent = String(dirty);
    return temp.innerHTML;
  };

  function sanitizeHTML(dirty) {
    const raw = typeof dirty === 'string' ? dirty : '';
    if (!raw) return '';

    if (global.DOMPurify && typeof global.DOMPurify.sanitize === 'function') {
      const sanitized = global.DOMPurify.sanitize(raw, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP: PURIFY_URI_REGEXP
      });
      const parsed = parseHtml(sanitized);
      if (!parsed) return sanitized;
      ensureAnchorAttributes(parsed);
      keepOnlySvgDataImages(parsed);
      return parsed.body ? parsed.body.innerHTML : sanitized;
    }

    return fallbackSanitize(raw);
  }

  global.sanitizeHTML = sanitizeHTML;
})(typeof self !== 'undefined' ? self : this);
