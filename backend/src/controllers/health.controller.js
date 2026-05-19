export const healthController = {
    async check(_req, res) {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: process.env.APP_VERSION || 'dev',
        });
    },
};
