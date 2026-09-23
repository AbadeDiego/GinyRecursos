const origin = process.env.APP_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !/^https?:\/\//.test(origin)) throw new Error('APP_ORIGIN deve ser a origem pública exata, sem caminho nem barra final.');
if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('Configure HTTPS no Coolify.');
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD deve ter 12 ou mais caracteres.');
