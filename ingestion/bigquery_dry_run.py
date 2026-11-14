"""BigQuery dry-run adapter. It has no query-execution code path.

The public dataset still requires an authenticated Google identity and an explicitly
selected execution project. This module never enables billing/APIs or creates resources.
"""
from __future__ import annotations

from datetime import date
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SQL_PATH = Path(__file__).resolve().parents[1] / 'sql' / 'near-signal.sql'
API_ROOT = 'https://bigquery.googleapis.com/bigquery/v2'


def build_dry_run_request(sql: str, *, start_date: str, end_date: str,
                          contract_account_id: str, project_id: str) -> tuple[str, dict]:
    if not project_id or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project_id):
        raise ValueError('Set an explicit valid Google Cloud project ID; no project is inferred.')
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except (TypeError, ValueError):
        raise ValueError('start_date and end_date must be YYYY-MM-DD') from None
    if start >= end:
        raise ValueError('start_date must be earlier than the exclusive end_date')
    if not isinstance(contract_account_id, str) or not contract_account_id.strip():
        raise ValueError('contract_account_id must be explicitly supplied')
    body = {
        'configuration': {
            'dryRun': True,
            'query': {
                'query': sql,
                'useLegacySql': False,
                'parameterMode': 'NAMED',
                'queryParameters': [
                    {'name': 'start_date', 'parameterType': {'type': 'DATE'}, 'parameterValue': {'value': start.isoformat()}},
                    {'name': 'end_date', 'parameterType': {'type': 'DATE'}, 'parameterValue': {'value': end.isoformat()}},
                    {'name': 'contract_account_id', 'parameterType': {'type': 'STRING'}, 'parameterValue': {'value': contract_account_id.strip()}},
                ],
            },
        },
    }
    return f'{API_ROOT}/projects/{project_id}/jobs', body


def _adc_bearer_token() -> str:
    try:
        import google.auth
        from google.auth.transport.requests import Request as GoogleAuthRequest
    except ImportError as exc:
        raise RuntimeError('Google ADC support missing; install ingestion/requirements.txt') from exc
    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    if not credentials.valid or not credentials.token:
        credentials.refresh(GoogleAuthRequest())
    if not credentials.token:
        raise RuntimeError('Google Application Default Credentials did not provide an OAuth token')
    return credentials.token


def run_dry_run(*, start_date: str, end_date: str, contract_account_id: str,
                project_id: str | None = None, timeout: float = 30.0) -> dict:
    """Submit only jobs.insert(configuration.dryRun=True); never submit an executable job."""
    selected_project = project_id or os.environ.get('NEAR_SIGNAL_BIGQUERY_PROJECT')
    if not selected_project:
        raise RuntimeError('Set NEAR_SIGNAL_BIGQUERY_PROJECT to an authorized execution project or sandbox project.')
    query = SQL_PATH.read_text(encoding='utf-8')
    url, payload = build_dry_run_request(query, start_date=start_date, end_date=end_date,
                                         contract_account_id=contract_account_id, project_id=selected_project)
    token = _adc_bearer_token()
    request = Request(url, data=json.dumps(payload).encode('utf-8'),
                      headers={'Accept': 'application/json', 'Content-Type': 'application/json',
                               'Authorization': f'Bearer {token}'}, method='POST')
    try:
        response = urlopen(request, timeout=timeout)
    except HTTPError as exc:
        # Do not include the Authorization header/token in errors or output.
        detail = exc.read(2000).decode('utf-8', 'replace')
        raise RuntimeError(f'BigQuery dry-run request failed with HTTP {exc.code}: {detail[:500]}') from None
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f'BigQuery dry-run request failed: {type(exc).__name__}') from None
    with response:
        result = json.loads(response.read())
    query_stats = (result.get('statistics') or {}).get('query') or {}
    return {
        'http_status': response.status,
        'dry_run': bool((result.get('configuration') or {}).get('dryRun')),
        'job_id': (result.get('jobReference') or {}).get('jobId'),
        'project_id': selected_project,
        'estimated_bytes_processed': query_stats.get('totalBytesProcessed'),
        'location': (result.get('jobReference') or {}).get('location'),
        'query_executed': False,
        'response': result,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description='Submit a no-cost BigQuery dry-run only; never execute a query.')
    parser.add_argument('--start-date', required=True, help='Inclusive YYYY-MM-DD date')
    parser.add_argument('--end-date', required=True, help='Exclusive YYYY-MM-DD date')
    parser.add_argument('--contract-account-id', required=True, help='Exact NEAR account ID to parameterize')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(run_dry_run(start_date=args.start_date, end_date=args.end_date,
                                     contract_account_id=args.contract_account_id), indent=2, sort_keys=True))
        return 0
    except (RuntimeError, ValueError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc), 'query_executed': False}))
        return 1


if __name__ == '__main__':
    import sys
    sys.exit(main())
