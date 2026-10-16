import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// All API routes are dynamic; no R2/KV cache is required for this deployment.
export default defineCloudflareConfig();
