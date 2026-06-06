// Queries the OSD search API directly from the service worker, instead of opening
// and scraping a background dashboard tab. Reuses the logged-in OSD session cookie
// (credentials:'include'); no API key needed. Used for staging SRs (> SR_THRESHOLD)
// in both single-SR and batch ("Search All") mode; legacy SRs stay on the tab flow.

const OSD_SEARCH_URL = 'https://staging.cc.toronto.ca:15601/internal/search/opensearch';
const OSD_INDEX = 'otel-v1-apm-span-*';
const OSD_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

// Painless scripts copied verbatim from the dashboard's search request, so the API
// returns the exact column values the scraped table used to show.
const SCRIPT_FIELDS = {
  Trace: "if (doc.containsKey('traceId') && !doc['traceId'].empty) { return doc['traceId'].value; } return null;",
  HttpStatusCode:
    "if (doc.containsKey('span.attributes.http@response@status_code') && doc['span.attributes.http@response@status_code'].size() > 0) {\n" +
    "  return doc['span.attributes.http@response@status_code'].value;\n" +
    "} else if (doc.containsKey('status.code') && doc['status.code'].size() > 0) {\n" +
    "  def code = doc['status.code'].value;\n" +
    "  if (code == 0) { return 'success'; } else if (code == 2) { return 'error'; } else { return 'unknown'; }\n" +
    "} else { return 'unknown'; }",
  'External Request ID':
    "if (doc.containsKey('span.attributes.http@request@header@externalrequestid') && !doc['span.attributes.http@request@header@externalrequestid'].empty) {\n" +
    "  return doc['span.attributes.http@request@header@externalrequestid'].value;\n" +
    "} return null;",
  'Request Number':
    "if (doc.containsKey('span.attributes.http@request@header@requestnumber') && !doc['span.attributes.http@request@header@requestnumber'].empty) {\n" +
    "  return doc['span.attributes.http@request@header@requestnumber'].value;\n" +
    "} return null;",
  Backend: `Set chameleon = new HashSet();
chameleon.add('TAS'); chameleon.add('Toronto Animal Services');

Set hansen = new HashSet();
hansen.add('District Operations'); hansen.add('Business Operations Management');
hansen.add('Operations & Maintenance'); hansen.add('District Ops - Operations & Maintenance');
hansen.add('District Ops - Central Services'); hansen.add('District Ops - Contact Services');
hansen.add('District Ops - Contract Services'); hansen.add('Water main Uni Directional Flushing');
hansen.add('Operations');

Set ibms = new HashSet();
ibms.add('Waste and Parks Enforcement'); ibms.add('Waste and Park Enforcement');
ibms.add('District Enforcement'); ibms.add('Bylaw Enforcement');
ibms.add('Parks Bylaw Enforcement'); ibms.add('Park Bylaw Enforcement');
ibms.add('Water and Parks Enforcement'); ibms.add('Waste Enforcement');
ibms.add('Investigation Request');

Set tmms = new HashSet();
tmms.add('Collections'); tmms.add('TD&O'); tmms.add('Traffic Plant Installation & Maintenance (TPIM)');
tmms.add('ROW Management'); tmms.add('Toronto Hydro Electric Systems');
tmms.add('Business Licensing Enforcement'); tmms.add('Pick up by Multi-Res Contractor (Miller)');
tmms.add('Right of Way (ROW)'); tmms.add('Sections'); tmms.add('SPMBY'); tmms.add('T11-');
tmms.add('TMC - TPIM'); tmms.add('TPWEY-'); tmms.add('Traffic Safety unit');
tmms.add('Automated Speed Enforcement'); tmms.add('Traffic Systems Operations');
tmms.add('Work Zone Construction Coordination');

Set maximo = new HashSet();
maximo.add('Urban Forestry'); maximo.add('Road Operations');
maximo.add('Tree Protection and Plan Review'); maximo.add('Forestry Operations');
maximo.add('Forestry and Natural Environment Management'); maximo.add('Parks');
maximo.add('Traffic Operations'); maximo.add('Signs & Pavement Markings');
maximo.add('TMC-Signs and Markings'); maximo.add('TMC - Signs & Markings');
maximo.add('Traffic Ops - Traffic Engineering');

String sourceSystem = null;
if (doc.containsKey('span.attributes.http@request@header@sourcesystem') && !doc['span.attributes.http@request@header@sourcesystem'].empty) {
    sourceSystem = doc['span.attributes.http@request@header@sourcesystem'].value;
}

String businessUnit = null;
if (doc.containsKey('span.attributes.http@request@header@businessunit') && !doc['span.attributes.http@request@header@businessunit'].empty) {
    businessUnit = doc['span.attributes.http@request@header@businessunit'].value;
}

if (sourceSystem != null) {
    if (sourceSystem == 'Salesforce_311' || sourceSystem == 'UF_Intake_portal') {
        if (businessUnit != null) {
            if (chameleon.contains(businessUnit)) return 'Chameleon';
            if (hansen.contains(businessUnit)) return 'HANSEN';
            if (tmms.contains(businessUnit)) return 'TMMS';
            if (ibms.contains(businessUnit)) return 'IBMS';
            if (maximo.contains(businessUnit)) return 'MAXIMO';
        }
        return null;
    } else if (sourceSystem == 'Lookup' || sourceSystem == 'MyTorontoPay') {
        return 'RSD';
    } else {
        return sourceSystem;
    }
}
return null;`
};

function buildSearchBody(srNumber, fromISO, toISO) {
  const scriptFields = {};
  for (const name of Object.keys(SCRIPT_FIELDS)) {
    scriptFields[name] = { script: { source: SCRIPT_FIELDS[name], lang: 'painless' } };
  }
  return {
    params: {
      index: OSD_INDEX,
      body: {
        size: 500,
        sort: [{ startTime: { order: 'desc', numeric_type: 'date_nanos', unmapped_type: 'boolean' } }],
        stored_fields: ['*'],
        script_fields: scriptFields,
        _source: ['name', 'startTime', 'traceId'],
        query: {
          bool: {
            filter: [
              { bool: { should: [{ match_phrase: { 'span.attributes.http@request@header@requestnumber': srNumber } }], minimum_should_match: 1 } },
              { match_phrase: { parentSpanId: '' } },
              { range: { startTime: { gte: fromISO, lte: toISO, format: 'strict_date_optional_time' } } }
            ]
          }
        }
      }
    }
  };
}

async function osdSearchBySR(srNumber) {
  const to = new Date();
  const from = new Date(to.getTime() - OSD_LOOKBACK_MS);
  const body = buildSearchBody(srNumber, from.toISOString(), to.toISOString());

  const resp = await fetch(OSD_SEARCH_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'osd-version': '2.19.0',
      'osd-xsrf': 'osd-fetch'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error('OSD search HTTP ' + resp.status + ' ' + resp.statusText);
  }
  return resp.json();
}

function firstField(hit, name) {
  const v = hit.fields && hit.fields[name];
  return Array.isArray(v) ? v[0] : v;
}

function parseIntOrNull(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function buildTraceBody(traceId, fromISO, toISO) {
  return {
    params: {
      index: OSD_INDEX,
      body: {
        size: 200,
        sort: [{ startTime: { order: 'asc', unmapped_type: 'boolean' } }],
        _source: ['name', 'startTime', 'traceId', 'parentSpanId', 'serviceName', 'events', 'span.attributes.http@response@status_code'],
        query: {
          bool: {
            filter: [
              { match_phrase: { traceId: traceId } },
              { range: { startTime: { gte: fromISO, lte: toISO, format: 'strict_date_optional_time' } } }
            ]
          }
        }
      }
    }
  };
}

async function osdSearchByTrace(traceId) {
  const to = new Date();
  const from = new Date(to.getTime() - OSD_LOOKBACK_MS);
  const body = buildTraceBody(traceId, from.toISOString(), to.toISOString());
  const resp = await fetch(OSD_SEARCH_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'osd-version': '2.19.0', 'osd-xsrf': 'osd-fetch' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('OSD trace search HTTP ' + resp.status + ' ' + resp.statusText);
  return resp.json();
}

// Recursively find the first non-empty "errorMessage" string (DFS).
// Mirrors findErrorMessageDeep in jaeger-expand.js.
function findErrorMessageDeep(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.errorMessage === 'string' && obj.errorMessage) return obj.errorMessage;
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (const v of values) {
    const found = findErrorMessageDeep(v);
    if (found) return found;
  }
  return null;
}

// Extract the error message from a span's events array. Mirrors
// extractPayloadFromByteStream in jaeger-expand.js: find the response.payload
// event; if its payload is JSON with a nested errorMessage, return that, else
// return the raw payload string.
function extractErrorFromEvents(events) {
  const flat = Array.isArray(events) ? events.flat(Infinity) : [];
  for (const event of flat) {
    if (!event || event.name !== 'response.payload') continue;
    const payload = event.attributes && event.attributes.payload;
    if (!payload) continue;
    try {
      const errorMsg = findErrorMessageDeep(JSON.parse(payload));
      if (errorMsg) return errorMsg;
    } catch (e) { /* payload is a plain string */ }
    return payload;
  }
  return null;
}

async function extractErrorForTrace(traceId) {
  if (!traceId) return null;
  let json;
  try {
    json = await osdSearchByTrace(traceId);
  } catch (e) {
    return null;
  }
  const es = json.rawResponse || json;
  const spans = (es.hits && es.hits.hits) || [];
  for (const s of spans) {
    const msg = extractErrorFromEvents(s._source && s._source.events);
    if (msg) return msg;
  }
  return null;
}

// Look up one SR and return a structured result. The row-selection decision is
// shared with error-trace-click.js via classifyStatusRows (row-classify.js).
//   { kind: 'noRecords' }
//   { kind: 'success', statusCode: 200|202, backend, extReqId }
//   { kind: 'error',   statusCode, backend, responseBody }
async function osdLookupSR(srNumber) {
  const json = await osdSearchBySR(srNumber);
  const es = json.rawResponse || json;
  const hits = (es.hits && es.hits.hits) || [];
  if (hits.length === 0) return { kind: 'noRecords' };

  // Normalize hits (newest-first) into the shape classifyStatusRows expects.
  const rows = hits.map(h => ({
    statusCode: parseIntOrNull(firstField(h, 'HttpStatusCode')),
    backend: firstField(h, 'Backend') || '',
    extReqId: firstField(h, 'External Request ID') || '',
    trace: firstField(h, 'Trace') || '',
    ref: h
  }));

  const cls = classifyStatusRows(rows);
  if (cls.kind === 'noRecords') return { kind: 'noRecords' };

  if (cls.kind === 'success') {
    return {
      kind: 'success',
      statusCode: cls.statusCode,
      backend: cls.row ? cls.row.backend : '',
      extReqId: cls.row ? cls.row.extReqId : ''
    };
  }

  // error: fetch the chosen error row's trace and pull the payload message.
  const responseBody = await extractErrorForTrace(cls.row.trace);
  return {
    kind: 'error',
    statusCode: cls.statusCode,
    backend: cls.row.backend,
    responseBody: responseBody || '(no response payload in log)'
  };
}

self.osdLookupSR = osdLookupSR;
