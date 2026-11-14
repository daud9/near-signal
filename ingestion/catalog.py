"""Audited source catalog. Values distinguish verified tests from documented/unknown fields."""
from __future__ import annotations

SOURCE_CATALOG = {
    'nearblocks-api': {
        'source_id': 'nearblocks-api', 'provider': 'NearBlocks',
        'endpoint': 'https://api.nearblocks.io', 'docs_url': 'https://api.nearblocks.io/api-docs',
        'terms_url': 'https://nearblocks.io/terms', 'auth_mode': 'bearer_api_key_after_plan',
        'access_status': 'blocked_pending_written_consent', 'enabled': False,
        'rate_limit_note': 'Official plan limits: Free 10/min, 420/day, 12,500/month; paid plans have higher limits. Not load-tested. per_page increases may consume multiple credits.',
        'historical_coverage': 'Docs support block/date filters and cursor pagination but state no earliest historical floor or completeness guarantee. No data API call was made due Terms.',
        'notes': 'Terms prohibit automated extraction and third-party apps without prior written consent; do not probe or ingest until consent and authorized plan/key are available.',
    },
    'pikespeak-api': {
        'source_id': 'pikespeak-api', 'provider': 'Pikespeak',
        'endpoint': 'https://api.pikespeak.ai', 'docs_url': 'https://api.pikespeak.ai/docs',
        'terms_url': None, 'auth_mode': 'x-api-key',
        'access_status': 'not_connected_key_required', 'enabled': False,
        'rate_limit_note': 'Plans: Free 10 calls/minute, 10,000/month; Alpha 5/second, 150,000/month; On-demand numeric rate not stated. Not load-tested.',
        'historical_coverage': 'Docs describe network, account, event and selected historical analytics, with cursor support for some endpoints; no general earliest floor or completeness SLA documented.',
        'notes': 'Documentation/OpenAPI reachable. Protected data endpoint not called because no API key was available.',
    },
    'fastnear-indexed-api': {
        'source_id': 'fastnear-indexed-api', 'provider': 'FastNEAR indexed API',
        'endpoint': 'https://api.fastnear.com', 'docs_url': 'https://docs.fastnear.com/api',
        'terms_url': None, 'auth_mode': 'bearer_api_key',
        'access_status': 'not_connected_key_required', 'enabled': False,
        'rate_limit_note': 'No numeric limit found in the opened official docs; page limit 1–200 is not a request quota.',
        'historical_coverage': 'Account transactions support block-height ranges and opaque resume-token pagination; no guaranteed global retention floor/completeness documented.',
        'notes': 'The separate /status endpoint returned HTTP 200, but indexed account/asset data was not called. An authorized FastNEAR API key is required for those data surfaces. Distinct from Neardata public cursors and existing public RPC.',
    },
    'neardata-mainnet': {
        'source_id': 'neardata-mainnet', 'provider': 'FastNEAR Neardata',
        'endpoint': 'https://mainnet.neardata.xyz/v0/last_block/final', 'docs_url': 'https://docs.fastnear.com/neardata',
        'terms_url': None, 'auth_mode': 'none_on_tested_public_block_cursors',
        'access_status': 'verified_read_only_public_endpoint', 'enabled': True,
        'rate_limit_note': 'No numeric request-rate limit was published in the official docs reviewed. Adapter exposes one-request-at-a-time calls; production polling cadence requires provider confirmation.',
        'historical_coverage': 'First-block cursor resolved to block 9,820,210; latest cursor resolved to block 224,536,570 during testing. This does not prove gapless archival completeness or retention.',
        'notes': 'Latest response was HTTP 200 after redirect, with 10/10 matching chunk hashes/inclusion heights and 15 transaction rows. One block payload was also inspected; transaction records omit signatures, public keys, and opaque action arguments.',
    },
    'fastnear-public-rpc': {
        'source_id': 'fastnear-public-rpc', 'provider': 'FastNEAR public mainnet RPC',
        'endpoint': 'https://free.rpc.fastnear.com', 'docs_url': 'https://docs.near.org/api/rpc/block-chunk',
        'terms_url': None, 'auth_mode': 'none_on_existing_public_rpc',
        'access_status': 'verified_read_only_public_rpc', 'enabled': True,
        'rate_limit_note': 'The free-tier numeric request limit is unpublished. Existing app uses conservative polling; no historical backfill is enabled.',
        'historical_coverage': 'A finalized current block at height 224,536,358 returned HTTP 200 in testing. The fallback adapter stores one block only and does not claim daily transaction/account history.',
        'notes': 'Fallback for a block observation only. The existing app separately samples every shard, but fallback does not use that sampler or create historical records.',
    },
    'intear-events-api': {
        'source_id': 'intear-events-api', 'provider': 'Intear Events API',
        'endpoint': 'wss://ws-events-v3.intear.tech/events/', 'docs_url': 'https://docs.intear.tech/docs/events-api/',
        'terms_url': None, 'auth_mode': 'not_documented_for_events_host',
        'access_status': 'unreachable_dns_in_test_environment', 'enabled': False,
        'rate_limit_note': 'Dedicated Events API numeric quota not stated in its docs. Separate api.intea.rs limits must not be assumed to apply.',
        'historical_coverage': 'Events docs describe realtime WebSocket messages only; no history floor, replay, cursor or retention behavior documented.',
        'notes': 'Mainnet WebSocket hostname failed DNS before handshake; no HTTP status, CORS, auth or provider-outage conclusion is available. Separate api.intea.rs /schema returned 200 but is not the Events host.',
    },
    'near-intents-explorer-api': {
        'source_id': 'near-intents-explorer-api', 'provider': 'NEAR Intents Explorer',
        'endpoint': 'https://explorer.near-intents.org/api/v0/transactions',
        'docs_url': 'https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction',
        'terms_url': None, 'auth_mode': 'partner_bearer_jwt',
        'access_status': 'reachable_but_not_authorized_without_partner_jwt', 'enabled': False,
        'rate_limit_note': 'One request per 5 seconds per partner ID. Requests may contain up to 1,000 swap records. Not load-tested.',
        'historical_coverage': 'Cursor pagination documents older/newer directions and timestamp filters; only historical 1Click swaps, no documented earliest floor/retention/completeness guarantee.',
        'notes': 'Unauthenticated endpoint returned HTTP 400 with an empty body. This demonstrates endpoint reachability but not authenticated data access; partner JWT is unavailable.',
    },
}


def get_source_definition(source_id: str) -> dict:
    return dict(SOURCE_CATALOG[source_id])


def list_sources() -> list[dict]:
    return [dict(source) for source in SOURCE_CATALOG.values()]
