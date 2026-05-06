(() => {
  const DEBUG_UI_ENABLED = window.GHOSTDROP_DEBUG_UI === true;
  const DEBUG_ENTRY_LIMIT = 220;
  const DEBUG_TEXT_LIMIT = 1400;
  const SENSITIVE_KEY_PATTERN = /(authorization|password|token|secret|cookie|api[-_]?key)/i;
  const TEXT_RESPONSE_PATTERN = /json|text|javascript|xml|html|x-www-form-urlencoded/i;
  let requestCounter = 0;

  const state = {
    mounted: false,
    root: null,
    stream: null,
    entries: [],
    renderQueued: false,
  };

  function noop() {}

  window.__ghostDebug = {
    enabled: DEBUG_UI_ENABLED,
    log(channel, ...args) {
      if (!DEBUG_UI_ENABLED) {
        return;
      }

      appendEntry(channel, args.map((arg) => formatValue(arg)).join(' '));
    },
  };

  if (!DEBUG_UI_ENABLED) {
    return;
  }

  function truncateText(text) {
    if (typeof text !== 'string') {
      return String(text);
    }

    if (text.length <= DEBUG_TEXT_LIMIT) {
      return text;
    }

    return text.slice(0, DEBUG_TEXT_LIMIT) + '... [truncated]';
  }

  function getTimestamp() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return hh + ':' + mm + ':' + ss + '.' + ms;
  }

  function mountOverlay() {
    if (state.mounted || !document.body) {
      return;
    }

    const root = document.createElement('section');
    root.id = 'debugOverlay';
    root.className = 'debug-overlay';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = ''
      + '<div class="debug-overlay__title">GhostDrop Debug</div>'
      + '<pre class="debug-overlay__stream" id="debugOverlayStream"></pre>';

    document.body.appendChild(root);
    state.root = root;
    state.stream = root.querySelector('#debugOverlayStream');
    state.mounted = true;
    renderEntries();
  }

  function ensureOverlay() {
    if (state.mounted) {
      return;
    }

    if (document.body) {
      mountOverlay();
      return;
    }

    document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
  }

  function scheduleRender() {
    if (state.renderQueued) {
      return;
    }

    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      renderEntries();
    });
  }

  function renderEntries() {
    if (!state.stream) {
      return;
    }

    state.stream.textContent = state.entries.join('\n');
    state.stream.scrollTop = state.stream.scrollHeight;
  }

  function appendEntry(channel, message) {
    ensureOverlay();

    const line = '[' + getTimestamp() + '] [' + channel + '] ' + truncateText(message);
    state.entries.push(line);

    if (state.entries.length > DEBUG_ENTRY_LIMIT) {
      state.entries.splice(0, state.entries.length - DEBUG_ENTRY_LIMIT);
    }

    scheduleRender();
  }

  function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERN.test(String(key));
  }

  function describeElement(element) {
    if (!(element instanceof Element)) {
      return String(element);
    }

    const id = element.id ? '#' + element.id : '';
    const className = typeof element.className === 'string'
      ? '.' + element.className.trim().replace(/\s+/g, '.')
      : '';
    return '<' + element.tagName.toLowerCase() + id + className + '>';
  }

  function formatFormData(formData) {
    const entries = [];
    formData.forEach((value, key) => {
      if (value instanceof File) {
        entries.push(key + '=File{name="' + value.name + '", size=' + value.size + ', type="' + (value.type || 'unknown') + '"}');
        return;
      }

      entries.push(key + '=' + (isSensitiveKey(key) ? '[redacted]' : truncateText(String(value))));
    });
    return 'FormData{' + entries.join(', ') + '}';
  }

  function normalizeHeaders(headers) {
    if (!headers) {
      return null;
    }

    const result = {};

    try {
      const headerEntries = headers instanceof Headers
        ? Array.from(headers.entries())
        : Array.isArray(headers)
          ? headers
          : Object.entries(headers);

      headerEntries.forEach(([key, value]) => {
        result[key] = isSensitiveKey(key) ? '[redacted]' : String(value);
      });
    } catch (error) {
      return { unreadable: String(error) };
    }

    return result;
  }

  function formatObject(value, depth, seen) {
    if (depth > 2) {
      return '[Object]';
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return '[' + value.map((item) => formatValue(item, depth + 1, seen)).join(', ') + ']';
    }

    const output = {};
    Object.keys(value).slice(0, 16).forEach((key) => {
      output[key] = isSensitiveKey(key)
        ? '[redacted]'
        : formatValue(value[key], depth + 1, seen);
    });

    return JSON.stringify(output);
  }

  function formatValue(value, depth = 0, seen = new WeakSet()) {
    if (value === null) {
      return 'null';
    }

    if (value === undefined) {
      return 'undefined';
    }

    if (typeof value === 'string') {
      return truncateText(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }

    if (typeof value === 'function') {
      return '[Function ' + (value.name || 'anonymous') + ']';
    }

    if (value instanceof Error) {
      return truncateText(value.stack || (value.name + ': ' + value.message));
    }

    if (typeof File !== 'undefined' && value instanceof File) {
      return 'File{name="' + value.name + '", size=' + value.size + ', type="' + (value.type || 'unknown') + '"}';
    }

    if (typeof FormData !== 'undefined' && value instanceof FormData) {
      return formatFormData(value);
    }

    if (typeof Headers !== 'undefined' && value instanceof Headers) {
      return JSON.stringify(normalizeHeaders(value));
    }

    if (typeof Request !== 'undefined' && value instanceof Request) {
      return 'Request{method=' + value.method + ', url=' + value.url + '}';
    }

    if (typeof Response !== 'undefined' && value instanceof Response) {
      return 'Response{status=' + value.status + ', url=' + value.url + '}';
    }

    if (typeof Event !== 'undefined' && value instanceof Event) {
      return 'Event{type=' + value.type + ', target=' + describeElement(value.target) + '}';
    }

    if (typeof Element !== 'undefined' && value instanceof Element) {
      return describeElement(value);
    }

    if (typeof value === 'object') {
      return truncateText(formatObject(value, depth, seen));
    }

    return truncateText(String(value));
  }

  function summarizeBody(body) {
    if (!body) {
      return null;
    }

    if (typeof body === 'string') {
      return truncateText(body);
    }

    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return truncateText(body.toString());
    }

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return formatFormData(body);
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return 'Blob{size=' + body.size + ', type="' + (body.type || 'unknown') + '"}';
    }

    return formatValue(body);
  }

  function summarizeFetchRequest(input, init = {}) {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const method = (init.method || request?.method || 'GET').toUpperCase();
    const url = request?.url || String(input);
    const headers = normalizeHeaders(init.headers || request?.headers);
    const body = init.body ? summarizeBody(init.body) : null;
    return { method, url, headers, body };
  }

  async function logResponseBody(id, response) {
    const contentType = response.headers.get('content-type') || '';
    if (!TEXT_RESPONSE_PATTERN.test(contentType)) {
      return;
    }

    try {
      const text = await response.text();
      appendEntry('network', '#' + id + ' body ' + truncateText(text));
    } catch (error) {
      appendEntry('network', '#' + id + ' body unreadable: ' + formatValue(error));
    }
  }

  function installConsoleBridge() {
    ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
      const original = console[method]?.bind(console) || noop;

      console[method] = (...args) => {
        appendEntry('console.' + method, args.map((arg) => formatValue(arg)).join(' '));
        return original(...args);
      };
    });
  }

  function installFetchBridge() {
    if (typeof window.fetch !== 'function') {
      return;
    }

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const id = ++requestCounter;
      const startedAt = performance.now();
      const requestSummary = summarizeFetchRequest(input, init);
      appendEntry('network', '#' + id + ' -> ' + requestSummary.method + ' ' + requestSummary.url);

      if (requestSummary.headers) {
        appendEntry('network', '#' + id + ' headers ' + JSON.stringify(requestSummary.headers));
      }

      if (requestSummary.body) {
        appendEntry('network', '#' + id + ' request ' + requestSummary.body);
      }

      try {
        const response = await originalFetch(input, init);
        const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
        appendEntry(
          'network',
          '#' + id + ' <- ' + response.status + ' ' + response.statusText + ' (' + durationMs + 'ms) ' + (response.url || requestSummary.url),
        );
        appendEntry('network', '#' + id + ' response-headers ' + JSON.stringify(normalizeHeaders(response.headers)));
        void logResponseBody(id, response.clone());
        return response;
      } catch (error) {
        appendEntry('network', '#' + id + ' failed ' + formatValue(error));
        throw error;
      }
    };
  }

  function installXhrBridge() {
    if (typeof XMLHttpRequest === 'undefined') {
      return;
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__ghostDebugRequest = {
        id: ++requestCounter,
        method: String(method || 'GET').toUpperCase(),
        url: String(url),
      };
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const meta = this.__ghostDebugRequest || {
        id: ++requestCounter,
        method: 'GET',
        url: 'unknown',
      };
      const startedAt = performance.now();

      appendEntry('network', '#' + meta.id + ' -> ' + meta.method + ' ' + meta.url + ' [xhr]');

      const bodySummary = summarizeBody(body);
      if (bodySummary) {
        appendEntry('network', '#' + meta.id + ' request ' + bodySummary);
      }

      this.addEventListener('loadend', () => {
        const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
        appendEntry(
          'network',
          '#' + meta.id + ' <- ' + this.status + ' (' + durationMs + 'ms) ' + meta.url + ' [xhr]',
        );
      }, { once: true });

      return originalSend.apply(this, arguments);
    };
  }

  function installGlobalErrorBridge() {
    window.addEventListener('error', (event) => {
      appendEntry('window.error', formatValue(event.error || event.message || event));
    });

    window.addEventListener('unhandledrejection', (event) => {
      appendEntry('window.reject', formatValue(event.reason));
    });
  }

  ensureOverlay();
  installConsoleBridge();
  installFetchBridge();
  installXhrBridge();
  installGlobalErrorBridge();
  appendEntry('debug', 'overlay enabled');
})();
