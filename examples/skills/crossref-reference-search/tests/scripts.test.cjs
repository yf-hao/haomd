const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function work(overrides = {}) {
  return {
    DOI: '10.1234/paper', type: 'journal-article',
    title: ['Academic support &amp; growth'],
    author: [{ family: 'Smith', given: 'John Paul' }],
    'container-title': ['Higher Education Systems'],
    issued: { 'date-parts': [[2024, 3]] }, volume: '12', issue: '2', page: '45-52',
    ...overrides,
  }
}

function response(message, status = 200) {
  return { ok: status === 200, status, body: JSON.stringify({ status: 'ok', message }) }
}

function invoke(script, args, responses) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', script + '.js'), 'utf8')
  const calls = []
  const http = { request(options) {
    calls.push(options)
    const result = responses[calls.length - 1]
    if (result instanceof Error) throw result
    assert.ok(result, 'Unexpected additional HTTP call')
    return result
  } }
  const serialized = vm.runInNewContext(source + '\nJSON.stringify(run(' + JSON.stringify(args) + '));', { http }, { timeout: 2000 })
  const result = JSON.parse(serialized)
  return { result, output: result.stdout ? JSON.parse(result.stdout) : null, calls }
}

test('search encodes independent queries, applies filters, and merges duplicate DOI provenance', () => {
  const { result, output, calls } = invoke('search', {
    queries: ['Spring Boot academic support', 'university academic platform', 'Spring Boot student service'],
    rows: 10, offset: 10, fromYear: 2020, untilYear: 2025,
  }, [
    response({ items: [work(), work({ DOI: '10.1234/book', type: 'book-chapter' })], 'total-results': 4000 }),
    response({ items: [work({ DOI: '10.1234/PAPER' }), work({ DOI: '' })] }),
    response({ items: [work({ DOI: '10.1234/second' })] }),
  ])
  assert.equal(result.ok, true)
  assert.equal(output.count, 2)
  assert.equal(output.records[0].title, 'Academic support & growth')
  assert.deepEqual(output.records[0].matchedQueries, ['Spring Boot academic support', 'university academic platform'])
  assert.equal(calls.length, 3)
  const url = new URL(calls[0].url)
  assert.equal(url.origin, 'https://api.crossref.org')
  assert.equal(url.searchParams.get('query.bibliographic'), 'Spring Boot academic support')
  assert.equal(url.searchParams.get('filter'), 'type:journal-article,from-pub-date:2020-01-01,until-pub-date:2025-12-31')
  assert.equal(url.searchParams.get('offset'), '10')
  assert.equal(calls[0].headers.Cookie, undefined)
})

test('duplicate keyword groups ignore whitespace and case without losing technical capitalization', () => {
  const { calls } = invoke('search', { queries: [' Spring  Boot ', 'spring boot'] }, [response({ items: [] })])
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0].url).searchParams.get('query.bibliographic'), 'Spring Boot')
})

test('invalid search arguments never send requests', () => {
  for (const args of [null, { queries: [] }, { queries: ['a', 'b', 'c', 'd'] }, { queries: ['a'], rows: 0 },
    { queries: ['a'], type: 'book-chapter' }, { queries: ['a'], fromYear: 2025, untilYear: 2024 }]) {
    const { result, calls } = invoke('search', args, [])
    assert.equal(result.ok, false)
    assert.equal(calls.length, 0)
  }
})

test('rate limits stop subsequent requests and preserve successful partial metadata', () => {
  const { result, output, calls } = invoke('search', { queries: ['a', 'b', 'c'] }, [
    response({ items: [work()] }), response({}, 429),
  ])
  assert.equal(result.ok, true)
  assert.equal(output.count, 1)
  assert.equal(output.errors[0].status, 429)
  assert.equal(calls.length, 2)
})

test('malformed JSON, wrong API structure, and network failure do not masquerade as metadata', () => {
  const malformed = invoke('search', { queries: ['a'] }, [{ ok: true, status: 200, body: '{' }])
  assert.equal(malformed.result.ok, false)
  assert.equal(malformed.output.count, 0)
  const unexpected = invoke('search', { queries: ['a'] }, [response({ items: null })])
  assert.equal(unexpected.result.ok, false)
  const network = invoke('search', { queries: ['a', 'b'] }, [new Error('network')])
  assert.equal(network.result.ok, false)
  assert.equal(network.calls.length, 1)
  assert.equal(network.output.errors[0].detail, 'network')
  assert.ok(network.result.stderr.includes('network'))
})

test('journal citations use verified metadata, author initials and et al without appended DOI links', () => {
  const record = work({ author: [
    { family: 'Smith', given: 'John Paul' }, { family: 'Brown', given: 'Ann-Marie' },
    { family: 'Lee', given: 'K.' }, { family: 'Jones', given: 'T' },
  ] })
  const { result, output, calls } = invoke('export-reference', { doi: 'https://doi.org/10.1234/PAPER', index: 3 }, [response(record)])
  assert.equal(result.ok, true)
  assert.equal(output.citation, '[3] SMITH J P, BROWN A M, LEE K, et al. Academic support & growth[J]. Higher Education Systems, 2024, 12(2): 45-52.')
  assert.equal(decodeURIComponent(new URL(calls[0].url).pathname), '/works/10.1234/paper')
  assert.equal(output.citation.includes('https://'), false)
})

test('Chinese authors, missing volume and article numbers are formatted without invented fields', () => {
  const record = work({ author: [{ family: '张', given: '三' }], title: ['学术成长&#x5e73;台'], volume: undefined, issue: undefined,
    page: undefined, 'article-number': 'e123' })
  const { output } = invoke('export-reference', { doi: record.DOI, index: 1 }, [response(record)])
  assert.equal(output.citation, '[1] 张三. 学术成长平台[J]. Higher Education Systems, 2024: e123.')
})

test('conference citation uses real proceedings and publisher metadata', () => {
  const record = work({ type: 'proceedings-article', 'container-title': ['Proceedings of Academic Systems'],
    'publisher-location': 'London', publisher: 'Academic Publisher' })
  const { output } = invoke('export-reference', { doi: record.DOI, index: 1 }, [response(record)])
  assert.equal(output.citation, '[1] SMITH J P. Academic support & growth[C]//Proceedings of Academic Systems. London: Academic Publisher, 2024: 45-52.')
})

test('DOI mismatch, unidentifiable authors, missing publication year and unsupported types fail export', () => {
  for (const record of [work({ DOI: '10.1234/other' }), work({ author: [] }), work({ issued: {} }), work({ type: 'book-chapter' })]) {
    const { result } = invoke('export-reference', { doi: '10.1234/paper', index: 1 }, [response(record)])
    assert.equal(result.ok, false)
    assert.equal(result.stdout, '')
  }
})

test('export refuses arbitrary URLs and handles failed, truncated or invalid responses', () => {
  const invalid = invoke('export-reference', { doi: 'https://example.com/secret', index: 1 }, [])
  assert.equal(invalid.result.ok, false)
  assert.equal(invalid.calls.length, 0)
  for (const bad of [response({}, 404), { ...response(work()), truncated: true }, { ok: true, body: 'not json' }]) {
    const { result } = invoke('export-reference', { doi: '10.1234/paper', index: 1 }, [bad])
    assert.equal(result.ok, false)
  }
})
