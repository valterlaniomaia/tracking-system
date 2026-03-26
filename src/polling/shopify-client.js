import { config } from '../../config.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('shopify');

let cachedAccessToken = null;

/**
 * Get access token via client_credentials grant.
 * Same pattern as shopify-mcp/index.js.
 */
async function getAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;

  const { storeDomain, clientId, clientSecret } = config.shopify;

  return withRetry(async () => {
    const url = `https://${storeDomain}/admin/oauth/access_token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Shopify token exchange failed: ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    cachedAccessToken = data.access_token;
    log.info('Shopify access token obtained');
    return cachedAccessToken;
  }, 'shopify-token');
}

/**
 * Execute a GraphQL query against Shopify Admin API.
 */
async function graphql(query, variables = {}) {
  const { storeDomain, apiVersion } = config.shopify;
  const token = await getAccessToken();
  const url = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;

  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // If 401, invalidate cached token
      if (res.status === 401) {
        cachedAccessToken = null;
        log.warn('Access token expired, will re-authenticate on next call');
      }
      const err = new Error(`Shopify GraphQL error: ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    if (json.errors?.length) {
      log.warn('GraphQL partial errors', { errors: json.errors });
    }
    return json.data;
  }, 'shopify-graphql');
}

/**
 * Fetch fulfilled orders from the last N days.
 */
export async function getFulfilledOrders(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    query FulfilledOrders($query: String!, $first: Int!, $after: String) {
      orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        edges {
          cursor
          node {
            id
            legacyResourceId
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            customer {
              email
            }
            fulfillments {
              createdAt
              status
              trackingInfo {
                number
                url
                company
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

  const allOrders = [];
  let cursor = null;
  let page = 0;
  const maxPages = 10;

  while (page < maxPages) {
    const variables = {
      query: `fulfillment_status:shipped created_at:>='${since}' financial_status:paid`,
      first: 50,
      after: cursor,
    };

    const data = await graphql(query, variables);
    const edges = data?.orders?.edges || [];

    for (const edge of edges) {
      const node = edge.node;
      const fulfillment = node.fulfillments?.[0];
      const tracking = fulfillment?.trackingInfo?.[0];

      allOrders.push({
        orderId: node.legacyResourceId,
        orderGid: node.id,
        orderNumber: node.name,
        email: node.customer?.email || '',
        createdAt: node.createdAt,
        fulfillmentDate: fulfillment?.createdAt || '',
        fulfillmentStatus: fulfillment?.status || '',
        trackingNumber: tracking?.number || '',
        trackingUrl: tracking?.url || '',
        trackingCompany: tracking?.company || '',
      });
      cursor = edge.cursor;
    }

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    page++;
  }

  log.info(`Fetched ${allOrders.length} fulfilled orders from Shopify`);
  return allOrders;
}
