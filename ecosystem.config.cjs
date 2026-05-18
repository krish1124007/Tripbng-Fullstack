module.exports = {
  apps: [
    {
      name: 'tripbng-api',
      script: 'pnpm',
      args: '--filter @tripbng/api start',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    },
    {
      name: 'tripbng-web',
      script: 'pnpm',
      args: '--filter @tripbng/web start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
