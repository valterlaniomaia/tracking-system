import { config } from '../../config.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('shopify');

// Token cache per store domain
const tokenCache = new Map();

/**
 * Get access token via client_credentials grant.
 * @param {object} [creds] - { storeDomain, clientId, clientSecret }. Falls back to config.
 */
async function getAccessToken(creds) {
  const storeDomain = creds?.storeDomain || config.shopify.storeDomain;
  const clientId = creds?.clientId || config.shopify.clientId;
  const clientSecret = creds?.clientSecret || config.shopify.clientSecret;

  if (tokenCache.has(storeDomain)) return tokenCache.get(storeDomain);

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
    tokenCache.set(storeDomain, data.access_token);
    log.info('Shopify access token obtained', { storeDomain });
    return data.access_token;
  }, 'shopify-token');
}

/**
 * Execute a GraphQL query against Shopify Admin API.
 * @param {string} query - GraphQL query
 * @param {object} [variables] - Query variables
 * @param {object} [creds] - { storeDomain, clientId, clientSecret }. Falls back to config.
 */
async function graphql(query, variables = {}, creds) {
  const storeDomain = creds?.storeDomain || config.shopify.storeDomain;
  const apiVersion = config.shopify.apiVersion;
  const token = await getAccessToken(creds);
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
      if (res.status === 401) {
        tokenCache.delete(storeDomain);
        log.warn('Access token expired, will re-authenticate on next call', { storeDomain });
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
 * @param {number} [days] - How many days back to fetch
 * @param {object} [creds] - { storeDomain, clientId, clientSecret }. Falls back to config.
 */
export async function getFulfilledOrders(days = 30, creds) {
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

    const data = await graphql(query, variables, creds);
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

  log.info(`Fetched ${allOrders.length} fulfilled orders from Shopify`, {
    storeDomain: creds?.storeDomain || config.shopify.storeDomain,
  });
  return allOrders;
}
