const port = process.argv[2] || '9224';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((candidate) => !candidate.title.startsWith('Service Worker'));
if (!page) throw new Error('App WebView was not found');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

const expression = `(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('daye-rss-local');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const state = await new Promise((resolve, reject) => {
    const request = db.transaction('state', 'readonly').objectStore('state').get('main');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    sources: state.sources.length,
    enabledSources: state.sources.filter((source) => source.enabled).length,
    articles: state.articles.length,
    translated: state.articles.filter((article) => article.translationZh).length,
    saved: state.articles.filter((article) => article.status === 'saved').length,
    seedVersion: state.builtInSourceSeedVersion,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    visibleView: document.querySelector('.settings-view') ? 'settings' : document.querySelector('.detail-wrap.mobile-visible') ? 'article' : 'home'
  };
})()`;

socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebView inspection timed out')), 10_000);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text));
    else resolve(message.result.result.value);
  };
});
socket.close();
console.log(JSON.stringify(result, null, 2));
