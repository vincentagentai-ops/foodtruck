// Configuration pm2 : `pm2 start ecosystem.config.js` puis `pm2 save`.
module.exports = {
    apps: [{
        name: 'foodtruck',
        script: 'server.js',
        cwd: __dirname,
        instances: 1, // une seule instance : les écritures CSV sont sérialisées dans le processus
        autorestart: true,
        max_memory_restart: '200M',
        time: true,
    }],
};
