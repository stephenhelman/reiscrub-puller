import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'REIscrub Puller',
    description: 'Collects property addresses from a DealMachine search for REIscrub.',
    permissions: ['storage'],
    host_permissions: ['*://*.dealmachine.com/*'],
  },
});
