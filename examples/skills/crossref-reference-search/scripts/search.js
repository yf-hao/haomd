function cleanText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (original, entity) {
      if (entity[0] !== '#') return entities[entity.toLowerCase()]
      const hex = entity[1].toLowerCase() === 'x'
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original
    }).replace(/\s+/g, ' ').trim()
}

function field(value) {
  return cleanText(Array.isArray(value) ? value[0] : value)
}

function normalizeDoi(value) {
  return cleanText(value).replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '').toLowerCase()
}

function yearOf(work) {
  for (const key of ['issued', 'published-print', 'published-online', 'published']) {
    const year = work[key]?.['date-parts']?.[0]?.[0]
    if (Number.isInteger(year) && year > 0) return year
  }
  return null
}

function compactRecord(work, query) {
  return {
    doi: normalizeDoi(work.DOI),
    title: field(work.title),
    authors: (Array.isArray(work.author) ? work.author : []).slice(0, 3).map(function (author) {
      return cleanText(author.name || [author.family, author.given].filter(Boolean).join(' '))
    }),
    year: yearOf(work),
    source: field(work['container-title']),
    type: work.type,
    volume: field(work.volume),
    issue: field(work.issue),
    page: field(work.page),
    articleNumber: field(work['article-number']),
    matchedQueries: [query],
  }
}

function run(args) {
  const fail = (message) => ({ ok: false, stdout: '', stderr: message, exitCode: 1 })
  if (!Array.isArray(args?.queries) || args.queries.length < 1 || args.queries.length > 3) {
    return fail('queries must contain one to three English keyword groups.')
  }
  if (args.queries.some((query) => typeof query !== 'string' || !query.trim() || query.length > 200)) {
    return fail('Each query must be a nonempty string of at most 200 characters.')
  }
  const uniqueQueries = new Map()
  for (const input of args.queries) {
    const query = input.trim().replace(/\s+/g, ' ')
    if (!uniqueQueries.has(query.toLowerCase())) uniqueQueries.set(query.toLowerCase(), query)
  }
  const queries = [...uniqueQueries.values()]
  const rows = args.rows === undefined ? 10 : args.rows
  const offset = args.offset === undefined ? 0 : args.offset
  const type = args.type === undefined ? 'journal-article' : args.type
  if (!Number.isInteger(rows) || rows < 1 || rows > 20) return fail('rows must be an integer from 1 to 20.')
  if (!Number.isInteger(offset) || offset < 0 || offset > 100) return fail('offset must be an integer from 0 to 100.')
  if (!['journal-article', 'proceedings-article'].includes(type)) return fail('Unsupported publication type.')
  for (const key of ['fromYear', 'untilYear']) {
    if (args[key] !== undefined && (!Number.isInteger(args[key]) || args[key] < 1000 || args[key] > 9999)) {
      return fail(key + ' must be a four-digit year.')
    }
  }
  if (args.fromYear && args.untilYear && args.fromYear > args.untilYear) return fail('fromYear must not exceed untilYear.')

  const filters = ['type:' + type]
  if (args.fromYear) filters.push('from-pub-date:' + args.fromYear + '-01-01')
  if (args.untilYear) filters.push('until-pub-date:' + args.untilYear + '-12-31')
  const records = new Map()
  const searches = []
  const errors = []
  let succeeded = 0
  for (const query of queries) {
    const parameters = {
      'query.bibliographic': query,
      rows: String(rows),
      offset: String(offset),
      sort: 'relevance',
      order: 'desc',
      filter: filters.join(','),
      select: 'DOI,title,author,container-title,issued,type,volume,issue,page,article-number',
    }
    const url = 'https://api.crossref.org/works?' + Object.keys(parameters)
      .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(parameters[key])).join('&')
    let response
    try {
      response = http.request({ url, method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'HaoMD-Crossref-Skill/1.0' } })
    } catch (error) {
      const detail = typeof error?.message === 'string' ? error.message : String(error)
      errors.push({ query, error: 'Crossref request threw an exception.', detail })
      break
    }
    if (!response.ok || response.truncated) {
      errors.push({ query, status: response.status, error: response.truncated ? 'Response was truncated.' : 'Crossref request failed.' })
      if (response.status === 429) break
      continue
    }
    let payload
    try {
      payload = JSON.parse(response.body)
    } catch (_) {
      errors.push({ query, error: 'Crossref returned invalid JSON.' })
      continue
    }
    if (payload?.status !== 'ok' || !Array.isArray(payload.message?.items)) {
      errors.push({ query, error: 'Crossref returned an unexpected response structure.' })
      continue
    }
    succeeded += 1
    searches.push({ query, totalResults: payload.message['total-results'], returned: payload.message.items.length })
    for (const work of payload.message.items) {
      if (!work || work.type !== type) continue
      const record = compactRecord(work, query)
      if (!record.title || !record.doi || !/^10\.\d{4,9}\/\S+$/i.test(record.doi)) continue
      const existing = records.get(record.doi)
      if (existing) {
        if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query)
      } else {
        records.set(record.doi, record)
      }
    }
  }
  return {
    ok: succeeded > 0,
    stdout: JSON.stringify({ source: 'external_crossref_metadata', count: records.size, records: [...records.values()], searches, errors }),
    stderr: succeeded ? '' : 'No Crossref query succeeded. ' + (errors[0]?.detail || errors[0]?.error || ''),
    exitCode: succeeded ? 0 : 1,
  }
}
