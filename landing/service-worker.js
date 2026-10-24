// Retires the service worker that an earlier version of this site installed at /DERIIIV/.
// It cached the old app shell, which hid the landing page. This worker removes itself and its caches.
self.addEventListener('install', function () {
    self.skipWaiting();
});
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches
            .keys()
            .then(function (keys) {
                return Promise.all(
                    keys.map(function (k) {
                        return caches.delete(k);
                    })
                );
            })
            .then(function () {
                return self.registration.unregister();
            })
            .then(function () {
                return self.clients.matchAll({ type: 'window' });
            })
            .then(function (clients) {
                clients.forEach(function (c) {
                    c.navigate(c.url);
                });
            })
    );
});
